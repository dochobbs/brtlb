import type { ReactNode } from 'react';
import { useAppStore } from '../store';

interface SetupChecklistProps {
  /** Whether the user has at least one persisted recording. Drives the
   * "make a test recording" step's completion state. */
  hasAnyRecording: boolean;
  /** Called when the user clicks "Go record" in the checklist. Should run
   * the same flow as the main Record CTA — start the recorder *then* nav,
   * so the user doesn't land on a blank Record screen. */
  onStartTestRecording: () => void;
}

/**
 * Persistent setup checklist for new users. Lives on the Home screen and
 * disappears once every step is complete (or the user explicitly dismisses
 * it). Designed to be glance-able and resumable — not a forced modal.
 */
export function SetupChecklist({ hasAnyRecording, onStartTestRecording }: SetupChecklistProps) {
  const { settings, saveSettings, setView } = useAppStore();

  if (settings.setupChecklistDismissed) return null;

  // Derive completion from existing settings — no separate flag per step,
  // so the checklist reflects truth even if the user changes things outside
  // the wizard.
  const aaiKeyDone = settings.assemblyAiKey.trim().length > 0;
  const noteProviderKeyDone =
    settings.provider === 'gemini-api-key'
      ? settings.geminiApiKey.trim().length > 0
      : settings.provider === 'openai-compatible'
        ? settings.openaiApiKey.trim().length > 0
        : settings.anthropicApiKey.trim().length > 0;
  const firstRecordingDone = hasAnyRecording;
  const allDone = aaiKeyDone && noteProviderKeyDone && firstRecordingDone;
  if (allDone) return null;

  const steps: Step[] = [
    {
      id: 'docs',
      label: 'Skim how brtlb works',
      hint: 'Two minutes. Covers BYO keys, BAAs, customization.',
      // No "done" state — informational. We just give them a quick exit
      // by linking out.
      done: false,
      action: {
        label: 'Read docs',
        href: '/docs/',
        external: false,
      },
    },
    {
      id: 'aai',
      label: 'Sign the AssemblyAI BAA + create a key',
      hint: '5-minute DocuSign. Generate a key from your AAI account.',
      done: aaiKeyDone,
      action: {
        label: aaiKeyDone ? 'Update key' : 'Open BAA + setup',
        href: '/docs/why.html#baa',
        external: false,
      },
    },
    {
      id: 'gemini',
      label: 'Confirm Google HIPAA BAA + paste Gemini key',
      hint:
        settings.provider === 'gemini-api-key'
          ? 'Workspace admins typically have this already. Create the API key in a billing-enabled Cloud project.'
          : `You're using ${settings.provider}. Paste your key in Settings.`,
      done: noteProviderKeyDone,
      action: {
        label: noteProviderKeyDone ? 'Open Settings' : 'Paste in Settings',
        onClick: () => setView('settings'),
      },
    },
    {
      id: 'record',
      label: 'Make a test recording',
      hint:
        aaiKeyDone && noteProviderKeyDone
          ? 'Hit Record on Home, talk for 30 seconds, stop. Confirm a note appears.'
          : 'Finish the keys above first — Record needs both to run end-to-end.',
      done: firstRecordingDone,
      action:
        aaiKeyDone && noteProviderKeyDone && !firstRecordingDone
          ? {
              label: 'Go record',
              onClick: onStartTestRecording,
            }
          : undefined,
    },
  ];

  function handleDismiss(): void {
    saveSettings({ setupChecklistDismissed: true });
  }

  const remaining = steps.filter((s) => !s.done && s.id !== 'docs').length;

  return (
    <section
      aria-label="Setup checklist"
      className="mb-6 rounded-xl border border-seafoam/40 bg-seafoam-pale/40 p-4 sm:p-5"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-graphite">Getting set up</h2>
          <p className="text-xs text-graphite-soft">
            {remaining === 0
              ? 'One last thing.'
              : `${remaining} step${remaining === 1 ? '' : 's'} to go.`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-xs text-graphite-soft hover:text-graphite"
          aria-label="Dismiss setup checklist"
          title="Hide this checklist"
        >
          Hide
        </button>
      </header>
      <ol className="space-y-2">
        {steps.map((step) => (
          <ChecklistRow key={step.id} step={step} />
        ))}
      </ol>
    </section>
  );
}

interface Step {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  action?: ChecklistAction;
}

type ChecklistAction =
  | { label: string; href: string; external: boolean; onClick?: never }
  | { label: string; onClick: () => void; href?: never; external?: never };

function ChecklistRow({ step }: { step: Step }) {
  const indicator: ReactNode = step.done ? (
    <span
      aria-hidden="true"
      className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-seafoam text-graphite"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M3 8.5l3 3 7-7" />
      </svg>
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-graphite-soft/40 bg-white"
    />
  );

  return (
    <li className="flex items-start gap-3 rounded-lg border border-transparent bg-white/60 p-2.5">
      {indicator}
      <div className="flex-1">
        <p className={step.done ? 'text-sm text-graphite-soft line-through' : 'text-sm font-medium text-graphite'}>
          {step.label}
        </p>
        <p className="mt-0.5 text-xs text-graphite-soft">{step.hint}</p>
      </div>
      {step.action ? <ActionButton action={step.action} /> : null}
    </li>
  );
}

function ActionButton({ action }: { action: ChecklistAction }) {
  const classes =
    'self-start whitespace-nowrap rounded-md border border-graphite-soft/25 bg-white px-2.5 py-1 text-xs font-medium text-graphite hover:bg-mist';
  if ('href' in action && action.href) {
    return (
      <a
        href={action.href}
        target={action.external ? '_blank' : undefined}
        rel={action.external ? 'noopener noreferrer' : undefined}
        className={`${classes} no-underline`}
      >
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={classes}>
      {action.label}
    </button>
  );
}
