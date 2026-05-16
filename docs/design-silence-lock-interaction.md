# Design: idle-lock + silence-autostop interaction

> Status: in progress. Last updated 2026-05-16.

## Problem

User report (Chrome on Mac): recording has stopped on its own a few times,
typically right as the visit is wrapping up. In the most recent instance,
the user reported that the stop happened "right after a 'I'm here' click"
and that the resulting transcript captured the full visit.

The "I'm here" button is the idle-lock unlock control
(`apps/web-mvp/src/screens/LockScreen.tsx:13`) — distinct from the
silence-banner's "Keep recording" control
(`apps/web-mvp/src/screens/Record.tsx:327`).

## Root cause

Two independent overlays can be active simultaneously:

1. **Idle lock** — full-screen overlay (`z-50`) shown when the user has
   not produced a mouse/keyboard/touch event for `idleLockMinutes`. Hides
   the entire UI behind a "tap to continue" wall.
2. **Silence banner** — inline element inside the Record screen, shown
   when no smoothed-RMS-above-threshold voice activity has been detected
   for `IDLE_WARNING_AFTER_MS = 30 min`. After
   `IDLE_AUTOSTOP_GRACE_MS = 60 s` more silence the recorder sets
   `silenceAutoStopRequested = true` and `Record.tsx` runs handleStop.

The bug:

- Silence-detection runs unconditionally via `setInterval` and
  `requestAnimationFrame` (`apps/web-mvp/src/lib/recorder-store.ts`).
  It does not know or care whether the app shell is locked.
- When the lock screen is rendered, it visually covers the silence
  banner. The user cannot see it appear and cannot tap
  "Keep recording".
- During a long visit where the laptop is left on a counter while the
  doctor is across the room, cumulative quiet (low RMS) plus an
  idle-lock trigger can produce the sequence:
  1. User stops touching the laptop → idle lock fires.
  2. Mic input stays below voice-activity threshold long enough to
     cross the 30-min silence line (laptop far away, ambient
     conversation, exam quiet).
  3. Silence banner renders behind the lock screen.
  4. 60 s grace elapses without dismissal.
  5. `Record.tsx` auto-saves and routes to Review.
  6. User taps "I'm here" → unlock → lands in Review with the full
     transcript intact, which presents as "it stopped by itself."

The audio is preserved because chunks were captured continuously up to
the auto-stop. Only the recording-still-running expectation is
violated.

## Fix options considered

| # | Approach | Pros | Cons |
|---|---|---|---|
| A | Render silence-banner controls on the lock screen | Lets locked user dismiss without unlocking | Couples two unrelated overlays; still doesn't address the semantic mismatch (a locked screen means the user IS at the device) |
| B | Pause silence countdown while `locked === true` | Smallest behavioral change; matches the semantic intent of silence-detection ("user walked away and forgot to stop"); single chokepoint | Requires the recorder-store to learn about a single piece of app-state |
| C | Stop-reason telemetry only | Cheapest; confirms hypothesis | Doesn't fix anything on its own |

## Chosen approach

**Ship B and C together.**

- **B** is the actual fix and is semantically clean: locking the screen
  is the user's explicit signal "I am still at the device but want PHI
  hidden." Silence-detection is meant to catch "user forgot to stop and
  walked away." These intents are mutually exclusive.
- **C** instruments the stop path so future "it stopped on its own"
  reports are diagnosable instead of speculative. Cheap and high
  value.

A is rejected as more code than the fix is worth and only solves a
narrow slice of the problem.

## Implementation plan

### B. Pause silence countdown while locked

The recorder-store needs to observe `locked` from the app-store
without taking a direct dependency on it (the recorder-store is a
plain Zustand store; the app-store is the React-level state). The
cleanest move is to expose a setter on the recorder-store that the
app-store toggles when `locked` changes, and have the silence tick
short-circuit when that flag is true.

Touch points:

- `apps/web-mvp/src/lib/recorder-store.ts`
  - Add `silenceCheckPaused: boolean` to internals (default false).
  - Add `setSilenceCheckPaused(paused: boolean)` action.
  - In the ticker, early-return before silence math when
    `silenceCheckPaused === true`.
  - On unpause, refresh `lastVoiceActivityAt = Date.now()` and clear
    any pending `silenceWarningStartedAt` so the user gets a fresh
    grace window on resume.

- `apps/web-mvp/src/store.ts`
  - In the `lock` action: call
    `useRecorderStore.getState().setSilenceCheckPaused(true)`.
  - In the `unlock` action: call
    `useRecorderStore.getState().setSilenceCheckPaused(false)`.

### C. Stop-reason telemetry

Tag each completed recording with the reason it stopped. The set is
small and finite:

- `user` — user pressed Stop
- `silence_autostop` — silence grace expired
- `error` — recorder errored out (mic lost, etc.)

Touch points:

- `apps/web-mvp/src/lib/recorder-store.ts`
  - Add `stopReason: StopReason | null` to store state.
  - Set to `silence_autostop` when the grace expires.
  - Reset to null on `start()`.
  - Set to `user` inside the manual `stop()` action.

- `apps/web-mvp/src/screens/Record.tsx`
  - On handleStop, include `stopReason` in the persisted recording
    metadata (existing `RecordingMeta` blob).

- Recording metadata type
  - Add optional `stopReason?: StopReason` to the metadata type so
    Review can show it (low-priority; nice for debugging).

## Validation plan

1. **Unit tests** (`apps/web-mvp/src/lib/recorder-store.test.ts` or
   equivalent):
   - Silence ticker does not flag auto-stop while
     `silenceCheckPaused` is true, even if `lastVoiceActivityAt` is
     far in the past.
   - Toggling pause → unpause resets `lastVoiceActivityAt` and clears
     `silenceWarningStartedAt`.
   - `stopReason` is `user` after manual stop and
     `silence_autostop` after auto-stop.
2. **Manual smoke test**:
   - Start a recording. Manually fire `lock()` from devtools. Confirm
     silence-detection paused (no banner after 30 min of fake silence
     via stubbed timer or shorter constant). Unlock. Confirm a fresh
     30-min window starts.
3. **Real-world**: deploy and watch the next few visit recordings in
   the doctor's own data — `stopReason` should match expectations.

## Out of scope

- Smarter VAD threshold or adaptive silence detection.
- Detecting visit end semantically from the transcript.
- Background-tab handling. (`requestAnimationFrame` is throttled or
  paused in hidden tabs; addressed elsewhere.)
- BlueTooth / mic-track-ended handling. Separate failure mode, already
  partially handled via the `track.ended` listener.
