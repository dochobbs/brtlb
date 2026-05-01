# brtlb failure modes — catalog + remediation plan

> Status: analysis. Not all of these are bugs to fix; some are inherent
> limitations to document. The point is to know which is which and choose
> deliberately.

Each item is rated:
- **Severity**: 🔴 critical (data loss, PHI leak, clinical safety) / 🟡 medium (UX/frustration) / 🟢 low (rare, recoverable)
- **Status**: ✅ handled / 🟨 partial / ❌ unhandled
- **Action**: what we'd ship if we tackled it

---

## Device-level failures

### 🔴 Battery dies during recording
**Status:** 🟨 partial. Audio chunks are persisted to IDB as they arrive (chunk-save resilience), so audio captured before the cutoff survives. **But:** the final assembled blob never gets written, the recording stays in `recording` state in IDB.
**Real risk:** post-recovery on next launch, `recoverOrphanedRecordings` reassembles the chunks — but only if it runs. If chunks exist but stage = recording (not orphaned), the recovery scan may skip them.
**Action:** verify that `recoverOrphanedRecordings` and `recoverInterruptedRecordings` both handle the "stage=recording, no recordings entry, only chunks" case. If they don't, add a third recovery path.

### 🔴 iOS Safari suspends tab when screen locks mid-recording
**Status:** 🟨 partial. Documented in privacy panel. Chunk-save retains audio captured before suspension. Audio after suspension is lost.
**Real risk:** user records 60-min visit, screen locks 10 min in, brtlb captures 10 min then silently stops. They get back to a 10-min recording.
**Action:** (1) add a wake-lock attempt at recording start (`navigator.wakeLock`); (2) detect background event and warn the user when they return; (3) the only real fix is native shell — already on roadmap. Document the current behavior more prominently in the recording UI.

### 🔴 Storage fills up during recording (IDB QuotaExceededError)
**Status:** ❌ unhandled. `appendAudioChunk` errors are caught and warned to console; user sees no UI signal. Recording continues in memory but chunks aren't persisting → tab crash = lost audio.
**Real risk:** user with 50+ recordings on device, quota exceeded silently, next visit's chunks don't save, tab crashes, audio gone.
**Action:** detect QuotaExceededError on chunk persist, surface a "Device storage full" warning in the recording UI, suggest deleting old recordings before continuing.

### 🟡 Mic source disconnects mid-recording (AirPods, USB mic, Bluetooth headset)
**Status:** ❌ unhandled. MediaRecorder may continue but produce silence, or fire `onerror`.
**Real risk:** physician using AirPods, one falls out / disconnects, recording continues silently, transcript ends abruptly with no warning.
**Action:** listen to `mediaStream.oninactive` and `track.onmute`/`onended`. On detection, flash a red "Mic disconnected" warning in the recording UI; pause the recorder so the user can decide.

### 🟡 Mic permission revoked mid-session (browser settings change)
**Status:** ❌ unhandled. Next start would prompt again, but in-session degradation is silent.
**Real risk:** rare but possible if user denies permission accidentally then doesn't re-grant.
**Action:** subscribe to `navigator.permissions.query({name: 'microphone'})` change events, surface immediate warning.

### 🟡 Network drops during transcription poll
**Status:** 🟨 partial. The poll has timeouts per request but no retry — first failure throws, recording fails, user gets an error.
**Real risk:** clinic WiFi flakes for 10 seconds during a long visit's poll, transcription marked failed even though AssemblyAI completed it on their side.
**Action:** add retry with exponential backoff on poll requests (already retry on upload). 3 attempts before giving up.

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
**Status:** ❌ unhandled. A render error → blank screen, console error.
**Real risk:** rare in tested code, real for unexpected data shapes (corrupt IDB record, mid-flight schema change).
**Action:** add a top-level `<ErrorBoundary>` with a "something broke — reload or wipe" fallback. ~30 min ship.

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
**Status:** ❌ unhandled. App tries and fails opaquely.
**Real risk:** mostly fine. Modern Safari / Chrome / Edge support everything.
**Action:** add a one-line capability check at app boot, show "your browser is too old, please update" if missing core APIs. Trivial.

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
**Status:** ❌ unhandled. No confirm dialog before destructive Regenerate.
**Real risk:** common. Especially after spending 30 seconds tweaking a Plan section.
**Action:** if the note has been manually edited since generation (track a `dirty` flag on edit), Regenerate shows a confirmation: "Your manual edits will be lost. Continue?"

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
**Status:** ❌ unhandled. They get a generic 4xx error after upload.
**Real risk:** moderate. Trial credit exhaustion is the most common case.
**Action:** detect 402/billing-related errors specifically, route the user to AssemblyAI's billing dashboard.

### 🟡 User pastes wrong key into wrong field (Gemini key into AssemblyAI field)
**Status:** ✅ handled. Wizard verifies each key live against its respective endpoint before letting the user advance.
**Action:** none.

### 🟡 User selects wrong template, regenerates without realizing
**Status:** 🟨 partial. Template dropdown is visible, regenerate works. But wrong template → silent wrong-shape note.
**Real risk:** moderate. Especially auto-detect when transcript is ambiguous.
**Action:** on regenerate, show a small toast "Generated as [Template Name]" so the user notices the choice that was applied. Easy ship.

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

## What I'd actually recommend doing right now

**Bundle 1.** Eight items, two hours of focused work, every one of them eliminates a real-world failure mode that's either silent today or recoverable with effort. Most have shipped patterns we already use (ConfirmDialog, status banners, audit log entries). After Bundle 1 ships, brtlb's failure-mode story goes from "good but with sharp edges" to "actively defensive."

Bundles 2-4 then in priority order, but Bundle 1 alone closes the highest-likelihood gaps.

**Decision needed:** do Bundle 1 now? Bundle 1+2? Hold for now and table this for a focused sprint later?
