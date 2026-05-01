/**
 * Static changelog for the Settings → What's new section.
 * Newest entries on top. Keep items terse — one user-visible change per
 * bullet, no engineering jargon. Skip patch-level changes; capture features
 * users would notice or care about.
 */
export interface ChangelogEntry {
  date: string; // ISO date (YYYY-MM-DD)
  title: string;
  items: string[];
}

export const CHANGELOG: ReadonlyArray<ChangelogEntry> = [
  {
    date: '2026-05-01',
    title: 'Bundle 1 hardening',
    items: [
      'Top-level error boundary — if React ever throws, you get a "Something broke" card with Reload and "Wipe local data and reload" buttons instead of a blank screen.',
      'Browser capability check at boot — if your browser is missing IndexedDB, MediaRecorder, microphone access, or WebCrypto, brtlb explains exactly what is missing instead of failing opaquely later.',
      "Device storage full warning — if your browser's storage quota is exhausted during recording (rare, but possible with 50+ stored recordings), you now get an amber banner instead of a silent failure.",
      'Template-applied toast — after Regenerate, a quick "Generated as [Template Name]" toast confirms which template was actually used. Catches dropdown mis-picks before paste.',
      'Dead-battery recovery — verified and locked in with a regression test. If your device dies mid-recording, the chunks reassemble into a recoverable recording on next launch.',
    ],
  },
  {
    date: '2026-05-01',
    title: 'Failure-mode hardening',
    items: [
      'Regenerate now confirms before discarding manual edits. If you tweaked the note in Edit mode and hit Regenerate, you get a "discard your edits?" dialog instead of silently losing them.',
      'AssemblyAI errors are now classified with actionable next steps instead of a raw status code dump:',
      '— 402/credit: "account out of credit, top up at [link]"',
      '— 429: "rate limit hit, wait a minute"',
      '— 401/403: "authentication failed, check your key" (or BAA scope mismatch when relevant)',
      '— 400/audio rejected: surfaces the specific reason',
    ],
  },
  {
    date: '2026-05-01',
    title: 'Long-visit upload hardening',
    items: [
      'Upload timeout now scales with file size (~30 sec/MB) so a 90-minute autism eval on a slow connection has up to ~11 minutes to upload instead of getting cut at 5 min.',
      'Single auto-retry on transient upload errors (network blip, 5xx, timeout). Permanent errors (4xx auth/format) fail immediately as before.',
      'No 4MB body limit anywhere in the current path — audio uploads go browser → AssemblyAI directly. The 4MB cap only applies to Vercel Edge Functions, which brtlb does not use.',
    ],
  },
  {
    date: '2026-04-30',
    title: 'Dark mode',
    items: [
      'Theme toggle in Settings: Auto / Light / Dark. Auto follows your OS preference and switches automatically when the OS does.',
      'Calibrated for low-light exam rooms — slightly muted seafoam accents to avoid glare. Status banners (red, amber, emerald) keep their bright tones for visibility.',
    ],
  },
  {
    date: '2026-04-30',
    title: 'Search recordings + AssemblyAI auto-delete',
    items: [
      'Search bar on Home (appears once you have 4+ recordings) — finds recordings by label, transcript content, or note content. Local-only; never leaves the device.',
      'Status filters: All / Ready / In progress / Failed. Counts shown live so you can see at a glance how many are stuck.',
      'New Settings toggle (Privacy & Security): "Delete AssemblyAI transcripts after pulling" — when on, brtlb tells AssemblyAI to delete the transcript and audio from their side right after we receive it. Cuts vendor retention from days to seconds. Default ON.',
    ],
  },
  {
    date: '2026-04-30',
    title: 'Subtle recording UI + faster delete',
    items: [
      'Recording screen no longer dominates with a giant timer and bouncy 24-bar VU meter. Ambient mode (patient watching) defaults to a small status dot, modest timer, and a calm single-line breathing indicator. The full meter shows briefly at the start so you can confirm mic levels, then collapses.',
      'Tap "Mic check" any time to bring the full meter back. Dictation mode (no patient) keeps the meter on by default since there is no audience.',
      'Per-recording delete on the home screen — small × button on each row, tap to confirm. No need to dive into Review just to delete.',
      'Replaced the stock browser confirm dialog with a polished modal — Escape to cancel, focus on Cancel by default so dangerous actions are not one-tap-Enter mistakes.',
    ],
  },
  {
    date: '2026-04-30',
    title: 'Friction-free note export',
    items: [
      'Per-section copy chips: tap "HPI" or "Plan" or "Assessment" to copy just that section into the matching EHR field, instead of copying the whole note and highlighting by hand.',
      'Copy now preserves bold formatting (abnormal exam findings, sensitive flags) when the destination supports rich text — Elation, Word, most rich-text-aware fields. Plain-text fallback for everything else.',
      '"Email this note" button — pre-filled subject and body, your mail app opens, send to yourself to bridge devices without a backend.',
      'New "Move this note to another device" tip with the specific recipes for Apple-to-Apple Universal Clipboard, AirDrop, email, and iCloud Drive.',
      'Fixed dictation transcripts being silently dropped — AssemblyAI returns dictation in `text` (not `utterances`) and we were only mapping the latter.',
    ],
  },
  {
    date: '2026-04-30',
    title: 'Privacy & security panel + audit log',
    items: [
      'New "Privacy & security" section in Settings: what stays on this device, what leaves and to where, your responsibilities, and a runbook for if you lose this device.',
      'Local audit log (last 200 actions) — timestamps and action types only, no PHI. Hidden inside the privacy panel; cleared by Wipe All.',
      "Clear-clipboard button so PHI isn't left in the clipboard after pasting into the EHR.",
      'Granular retry: "Retry note only" reuses the existing transcript when generation fails, so you don\'t re-pay transcription cost.',
      'Fixed: AssemblyAI now requires speech_models on every request — was breaking transcription post-deploy.',
    ],
  },
  {
    date: '2026-04-30',
    title: 'Easier onboarding',
    items: [
      'Guided setup wizard for AssemblyAI + Gemini keys with live verification.',
      'Detects "API keys are disallowed" Workspace org-policy block and inlines the admin override steps.',
      'Calls out the Google Cloud billing-link step explicitly — a key without billing auths fine but fails on first generation.',
      'Custom templates: clone from any built-in, or "Polish with AI" to rewrite a rough description in the brtlb house style.',
      'Tighter built-in prompts: anatomic-laterality discipline, diagnostic specificity guardrails, consistency check before finalizing.',
    ],
  },
  {
    date: '2026-04-28',
    title: 'Pediatric depth + long-visit resilience',
    items: [
      'Multi-patient splitting — one recording, one note per child detected.',
      'Behavioral-health and developmental/autism-eval templates added.',
      'Long-visit chapter markers and verbatim quote capture.',
      'Auto-suggested visit label after each recording.',
      'Sensitive-content flag during QA review (suicidality, abuse, substance use).',
      'Chunk-save resilience: each MediaRecorder chunk is persisted as it arrives, so a tab crash mid-visit no longer loses everything before that point.',
      'AssemblyAI poll budget bumped to 90 minutes for autism evals and similar long visits.',
    ],
  },
  {
    date: '2026-04-26',
    title: 'iOS polish + Vercel deploy',
    items: [
      'Audio waveform animates on iOS Safari (was frozen due to a WebKit AudioContext bug).',
      'PWA app icon renders correctly on iOS home screen (was squashed banner).',
      'Live at brtlb.vercel.app — auto-deploys on every push to main.',
      'Settings shows a clear error if localStorage rejects the write (Private Browsing, "Block All Cookies", PWA-vs-Safari isolation).',
    ],
  },
];
