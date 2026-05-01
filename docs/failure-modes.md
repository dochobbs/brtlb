# brtlb failure modes — catalog + remediation plan

> Status: analysis + active remediation. Last updated 2026-05-01.
> Many items marked 🟨 partial in the original draft have moved to ✅
> handled. Bundle 1 is roughly half-shipped — see "Recently shipped"
> at bottom.

Each item is rated:

- **Severity**: 🔴 critical (data loss, PHI leak, clinical safety) / 🟡 medium (UX/frustration) / 🟢 low (rare, recoverable)
- **Status**: ✅ handled / 🟨 partial / ❌ unhandled
- **Action**: what we'd ship if we tackled it

---

## Device-level failures

### 🔴 Battery dies during recording

**Status:** ✅ **handled** (verified 2026-05-01). `putRecording` is only called after `recorder.stop()` resolves, so a tab that dies mid-capture leaves audio_chunks with no `recordings` entry — exactly the orphan case `recoverOrphanedRecordings` handles. App.tsx fires `recoverOrphanedRecordings` at boot; the chunks are reassembled into a blob, persisted as audio, and a new RecordingMeta is created with stage='recorded' so the user can process the partial audio. Locked in by a regression test in `db.test.ts` ("recovers a recording that died mid-capture").

### 🔴 iOS Safari suspends tab when screen locks mid-recording

**Status:** ✅ **handled** (as of 2026-05-01). Three layers shipped: (1) `navigator.wakeLock.request('screen')` acquired at recording start to prevent accidental auto-lock; (2) seafoam pre-record advisory in ambient mode reminds user to keep screen on; (3) deterministic chunk-count check on visibility return — banner only fires when MediaRecorder actually stopped, with definitive copy: "Recording was interrupted — Xs of audio lost." Native shell still required for true background recording (Capacitor on roadmap), but the failure mode is no longer silent.

### 🔴 Storage fills up during recording (IDB QuotaExceededError)

**Status:** ✅ **handled** (as of 2026-05-01). `appendAudioChunk`'s rejection is now classified — DOMException name `QuotaExceededError` (or `/quota/i` in the message as a fallback for non-DOMException variants) sets `storageError` on the recorder store. Record.tsx surfaces an amber banner: "Device storage is full — chunk backup paused. The current recording still works in memory, but a tab crash from here on could lose audio. Stop and delete old recordings to free space." The in-memory blob continues unaffected, so finishing the visit and stopping cleanly still saves the audio normally.

### 🟡 Mic source disconnects mid-recording (AirPods, USB mic, Bluetooth headset)

**Status:** ✅ **handled** (as of 2026-05-01). `track.onmute` / `track.onunmute` / `track.onended` listeners attached to every audio track. Brief mute (incoming call) → counted into interruption gap warning. Permanent loss (track ended) → clear error message: "The microphone became unavailable. Another app may have taken it, the device was unplugged, or permission was revoked. Stop and re-record when the mic is available again."

### 🟡 Mic permission revoked mid-session (browser settings change)

**Status:** ✅ **handled** (as of 2026-05-01). `track.onended` covers this case — surfaces same error UI as mic disconnect. User can stop, re-grant permission, and re-record.

### 🟡 Incoming call interrupting focus

**Status:** ✅ **handled** (as of 2026-05-01). `track.onmute` fires when OS takes the mic for an accepted call (CallKit on iOS, telephony on Android). For ignored calls in modern banner mode (iOS 14+ default), no interruption fires — recording continues uninterrupted. For legacy fullscreen call mode, the chunk-count check correctly identifies whether audio was actually lost.

### 🟡 Network drops during transcription poll

**Status:** ✅ **handled** (as of 2026-05-01). Poll-loop now classifies fetch rejections via `isRetriableNetworkError`; on a transient blip it sleeps the poll interval and continues instead of failing the whole transcription. AssemblyAI keeps the job; we just couldn't reach them this tick. Sustained outages still surface after the 90-min poll budget. The narrower exponential-backoff retry plan from Bundle 2 is no longer needed.

### 🟡 iOS Safari fetch rejection surfaces as opaque "Load failed"

**Status:** ✅ **handled** (as of 2026-05-01). When fetch() rejects at the network layer (iOS suspends the page mid-upload, Wi-Fi drops, vendor briefly unavailable), iOS Safari throws TypeError "Load failed" — useless to the user. Now classified by `packages/pipeline/src/errors.ts::classifyFetchError` at every fetch call site in both AssemblyAI and Gemini adapters. User sees: "connection was interrupted. This usually means your Wi-Fi/cellular dropped, the brtlb tab was suspended (common on iOS when you switch apps mid-upload), or [vendor] is briefly unavailable. Reopen brtlb on a stable connection and tap Retry from audio." Same for Chrome ("Failed to fetch") and Firefox ("NetworkError").

### 🟢 Phone overheats / throttles

**Status:** ❌ unhandled. MediaRecorder may slow or skip frames.
**Real risk:** very rare in normal exam-room temperature.
**Action:** none. Document as known limitation.

### 🟢 Cell signal swap (Wi-Fi ↔ cellular) mid-upload

**Status:** ✅ handled by upload retry. Single auto-retry catches the transient drop.
**Action:** none.

---

## App-level failures

### 🔴 Multiple brtlb tabs open with mismatched DB versions

**Status:** ✅ handled (just shipped). `blocked` callback shows alert, `blocking` callback closes own connection so the other tab can upgrade.
**Action:** none. Existing test of this on next deploy.

### 🔴 AssemblyAI rolls a breaking API change (e.g., the speech_models requirement)

**Status:** 🟨 partial. We have to react after the fact. Today's `speech_models` fix locked in via test assertion to prevent regression.
**Real risk:** another silent breaking change happens, brtlb breaks for everyone post-deploy.
**Action:** add a daily/weekly canary check (manual or CI) that runs a tiny test transcription; alerts if the response shape changes. Bigger lift; defer until launch.

### 🔴 Gemini API silently changes response format (thinking-model empty reply was an example)

**Status:** ✅ handled for the specific case. Probe is now tolerant of empty visible text from thinking models.
**Action:** keep the verify probe + the budget bump as the primary defense. Add a fallback: if generation returns empty reply with finishReason=MAX_TOKENS or similar, retry once with a higher budget.

### 🟡 React component throws and there's no error boundary

**Status:** ✅ **handled** (as of 2026-05-01). Top-level `<ErrorBoundary>` in `apps/web-mvp/src/components/ErrorBoundary.tsx`, wrapping `<App>` in `main.tsx`. Fallback shows the error message + two buttons: Reload, and "Wipe local data and reload" (calls `clearAll()` and `localStorage.clear()`).

### 🟡 IDB write succeeds but read returns inconsistent state (rare race)

**Status:** ❌ unhandled.
**Real risk:** very rare. Could happen with rapid back-to-back writes during recovery flows.
**Action:** none right now. Document as observed-if-observed.

### 🟡 LocalStorage silently fails (iOS Private Browsing, Block All Cookies)

**Status:** ✅ handled. `persistSettings` returns error, surfaced in Settings UI with explanation.

### 🟡 IDB upgrade fails partway (rare browser bug)

**Status:** ❌ unhandled. Upgrade transaction errors propagate but the catchable error path may leave the DB in inconsistent state.
**Real risk:** very rare. Has happened on iOS Safari historically.
**Action:** detect upgrade failure, offer "reset local DB" recovery action — wipes all and reloads.

### 🟡 JS bundle fails to load (CDN flake / network)

**Status:** ❌ unhandled. Page shows blank.
**Real risk:** rare on Vercel + global CDN.
**Action:** add a `<noscript>` fallback message so blank-page becomes "JS failed to load — check your connection and reload."

### 🟢 Browser version too old for required APIs (MediaRecorder, IDB v3)

**Status:** ✅ **handled** (as of 2026-05-01). `<CapabilityGate>` in `apps/web-mvp/src/components/CapabilityGate.tsx` runs synchronously at boot — checks for IndexedDB, MediaRecorder, navigator.mediaDevices.getUserMedia, and crypto.subtle. If any are missing it renders a clear "your browser is missing X" page with per-capability detail (HTTPS hint, Private Browsing hint, etc.) instead of letting the app render and fail opaquely.

### 🟢 Service worker conflict (we don't ship one, but third-party browser extensions might)

**Status:** ❌ unhandled.
**Action:** none right now; investigate only if reports come in.

---

## User-level failures

### 🔴 User records real PHI without signing AssemblyAI BAA

**Status:** 🟨 partial. Wizard mentions BAA after key verifies. Privacy panel reminds them. But there's no enforcement — once keys are entered, recording proceeds.
**Real risk:** physician in a hurry skips the BAA DocuSign step; PHI flows to AssemblyAI uncovered. Compliance risk.
**Action:** add an explicit BAA-attestation checkbox in Settings ("I have signed the AssemblyAI BAA — date: [auto-fills]"). First recording prompts the user to confirm if they haven't yet. Doesn't legally enforce but provides a documented chokepoint + audit trail. Already on the backlog.

### 🔴 User pastes note into the wrong patient chart in their EHR

**Status:** ❌ unhandled. brtlb has no visibility into the EHR.
**Real risk:** real workflow risk. Mitigated partly by per-patient tabs (proposed) where the section paste is patient-scoped.
**Action:** patient name in the per-section copy chip ("Tommy · HPI") instead of just "HPI." Forces a moment of "is this Tommy's HPI?" before paste. Already in the proposed multi-patient design.

### 🔴 User shares note via Web Share with wrong recipient

**Status:** ✅ handled (Web Share title is generic, not visit label). PHI is in body, but the user-facing chooser is just text.
**Action:** none beyond what's done.

### 🔴 User edits note manually then accidentally hits Regenerate, losing all edits

**Status:** ✅ **handled** (as of 2026-05-01). Tracks whether `editedNote !== meta.noteMarkdown` (manual edits since last generation). If so, Regenerate shows ConfirmDialog: "Discard your manual edits? The note has manual edits since it was generated. Regenerating will replace the note with a fresh LLM output and lose your edits. There's no undo." Defaults focus on Cancel; danger-toned red Confirm.

### 🟡 User deletes a recording then realizes they wanted it

**Status:** 🟨 partial. ConfirmDialog gates delete. No undo after confirm.
**Real risk:** moderate. Once gone, gone.
**Action:** soft-delete: move to "Trash" with a 24-hour or 7-day undo window. Ranked low priority — confirmation dialog is probably enough.

### 🟡 User wipes all data accidentally

**Status:** ✅ handled. `window.confirm` + explicit warning text.
**Action:** none.

### 🟡 User hands phone to colleague who sees other patient PHI

**Status:** 🟨 partial. Idle auto-lock (default 5 min) hides PHI. But within the timeout, everything visible.
**Real risk:** real but not unique to brtlb — applies to any phone-based workflow.
**Action:** none beyond the existing idle lock. Could ship a manual "lock now" button (currently only via idle).

### 🟡 User records without obtaining patient consent

**Status:** ❌ unhandled. brtlb provides no consent gate.
**Real risk:** legal in some states without explicit consent (varies by state for healthcare encounters); ethical gap regardless.
**Action:** before-recording prompt, once per session: "Have you obtained patient consent to record per your practice policy?" Single checkbox, one-time. Documented as audit log entry. Already mentioned in the security review.

### 🟡 User keeps recording "live" by accident in the next room (mic still on)

**Status:** 🟨 partial. Visible via the small recording indicator if the user looks at the phone. Idle auto-lock won't fire while recording.
**Real risk:** moderate. Long-tail "stuck record" event captures unrelated audio.
**Action:** add a max-recording-duration soft cap warning — at 60 min, show a banner "Still recording — confirm to continue another 30 min, or stop now." Also useful as a spend-control nudge for AssemblyAI cost.

### 🟡 User runs out of AssemblyAI credit / billing fails

**Status:** ✅ **handled** (as of 2026-05-01). Errors classified at the API boundary by HTTP status + body content. 402 / "credit" / "balance" → "account out of credit or payment failed. Top up at https://www.assemblyai.com/dashboard/account to continue." 429 → rate limit message. 401/403 → auth failure (with BAA-scope-mismatch variant when relevant). 400 → audio-rejection details. Generic fallback otherwise.

### 🟡 User pastes wrong key into wrong field (Gemini key into AssemblyAI field)

**Status:** ✅ handled. Wizard verifies each key live against its respective endpoint before letting the user advance.
**Action:** none.

### 🟡 User selects wrong template, regenerates without realizing

**Status:** ✅ **handled** (as of 2026-05-01). After a successful Regenerate, Review.tsx shows a 2.5s bottom toast: "Generated as [Template Name]" — looks up the name from BUILTIN_TEMPLATES first, then settings.customTemplates. Forces a moment of "wait, that's not what I wanted" before paste.

### 🟢 User records nothing meaningful, gets empty transcript

**Status:** ✅ handled. New empty-state messaging explains "no speech detected" with retry.
**Action:** none.

### 🟢 User uses brtlb in browser on a shared family device

**Status:** 🟨 partial. Idle auto-lock hides PHI. No multi-user identity.
**Real risk:** rare. Most physicians have a dedicated device.
**Action:** PIN/passphrase requirement on launch (different from idle lock). On the backlog.

---

## Cross-cutting hardening (not specific to one mode)

### Add a top-level error boundary

Catches React render errors so they show "something broke" instead of blank. Trivial, high value.

### Add a capability check at boot

"Your browser is missing X" if MediaRecorder / IDB v3 / WebCrypto are unavailable. Prevents opaque downstream failures.

### Add a manual "Lock now" button

Visible in the header. Lets the user lock without waiting for idle.

### Add a "dirty edit" flag + Regenerate confirmation

Prevents accidental edit loss.

---

## Priority bundles (if/when we tackle these)

### Bundle 1 — high-leverage, low-effort (~2 hours total)

1. **Top-level error boundary** with reload + wipe fallback
2. **Capability check at boot**
3. **Mic disconnect detection** + warning during recording
4. **Quota-exceeded detection** during chunk save → "Device storage full" warning
5. **Regenerate confirmation if edits exist**
6. **Template-applied toast** after regenerate
7. **AssemblyAI 402 / billing error detection** with dashboard link
8. **Storage full / IDB upgrade failed → reset path**

### Bundle 2 — recording resilience (~3 hours)

9. **Wake-lock attempt** at recording start (best-effort)
10. **Background detection + warning** when tab regains focus mid-recording
11. **Verify recoverOrphanedRecordings** handles stage=recording case
12. **Max-recording-duration warning** at 60 min
13. **Poll-loop retry with backoff**
14. **Manual Lock Now button**

### Bundle 3 — consent + compliance (~2 hours)

15. **Pre-record consent prompt** (once per session)
16. **BAA attestation in Settings** (audit-trail checkbox)
17. **Patient-name on section paste chips** (covered by multi-patient redesign)

### Bundle 4 — soft-delete recoverability (~1 day)

18. **Trash bin with 7-day undo** for deleted recordings
19. **Trash bin in Privacy & Security panel**

### Defer indefinitely (not worth the effort right now)

- Per-tab single-instance lock (less common at this scale)
- IDB version downgrade recovery
- Service worker conflict detection
- Native shell for true background audio (already roadmapped under Capacitor)

---

---

## Recently shipped (2026-05-01 batch)

This batch addressed eight failure modes from the catalog in one focused
day of work. All shipped to brtlb.vercel.app and verified building +
testing clean (40 pipeline tests, 15 web-mvp tests).

### Resolved this batch

| Failure mode                                      | Severity | Commit               |
| ------------------------------------------------- | -------- | -------------------- |
| iOS screen lock during recording (silent failure) | 🔴 → ✅  | `3a31515`, `af0129d` |
| Mic disconnects mid-recording (AirPods, USB)      | 🟡 → ✅  | `7fe81ee`            |
| Mic permission revoked mid-session                | 🟡 → ✅  | `7fe81ee`            |
| Incoming call interrupts recording                | 🟡 → ✅  | `7fe81ee`            |
| Long-visit upload timeout on slow connections     | 🟡 → ✅  | `63d8f04` (earlier)  |
| User loses manual edits hitting Regenerate        | 🔴 → ✅  | `ade80fb`            |
| AssemblyAI billing/quota errors opaque            | 🟡 → ✅  | `ade80fb`            |
| Interruption banner false positives               | 🟡 → ✅  | `af0129d`            |

### Still in Bundle 1 (not yet shipped)

Bundle 1 is now **fully shipped** (2026-05-01 evening batch):

- ✅ Top-level error boundary (`components/ErrorBoundary.tsx`)
- ✅ Capability check at boot (`components/CapabilityGate.tsx`)
- ✅ Storage full / IDB QuotaExceededError detection during chunk save (recorder store + Record banner)
- ✅ Template-applied toast after Regenerate (Review.tsx)
- ✅ Dead-battery recovery verified — orphan path handles it; locked in by db.test.ts

### Bundle 2 work

- Wake-lock at recording start ✅ shipped (was Bundle 2 originally, pulled into the screen-lock fix)
- ❌ Background-detection toast (covered by interruption banner; lower priority)
- ❌ Verify recoverOrphanedRecordings for stage=recording case
- ❌ Max-recording-duration warning at 60 min
- ❌ Poll-loop retry with backoff
- ❌ Manual Lock Now button

### Bundle 3 (consent + compliance) — unchanged

- ❌ Pre-record consent prompt
- ❌ BAA attestation in Settings
- ❌ Patient-name on section paste chips (covered by multi-patient design proposal)

### Bundle 4 (soft-delete) — unchanged

- ❌ Trash bin with 7-day undo

---

## What I'd actually recommend doing right now

**Bundle 1.** Eight items, two hours of focused work, every one of them eliminates a real-world failure mode that's either silent today or recoverable with effort. Most have shipped patterns we already use (ConfirmDialog, status banners, audit log entries). After Bundle 1 ships, brtlb's failure-mode story goes from "good but with sharp edges" to "actively defensive."

Bundles 2-4 then in priority order, but Bundle 1 alone closes the highest-likelihood gaps.

**Decision needed:** do Bundle 1 now? Bundle 1+2? Hold for now and table this for a focused sprint later?
