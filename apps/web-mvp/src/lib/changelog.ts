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
    date: '2026-04-30',
    title: 'Privacy & security panel + audit log',
    items: [
      'New "Privacy & security" section in Settings: what stays on this device, what leaves and to where, your responsibilities, and a runbook for if you lose this device.',
      'Local audit log (last 200 actions) — timestamps and action types only, no PHI. Hidden inside the privacy panel; cleared by Wipe All.',
      'Clear-clipboard button so PHI isn\'t left in the clipboard after pasting into the EHR.',
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
