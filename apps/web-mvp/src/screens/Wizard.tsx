import { useState } from 'react';
import { Button, Lockup } from '@brtlb/ui';
import { useAppStore } from '../store';
import { redactKeysInText } from '../lib/redact';

type Step = 'welcome' | 'assembly' | 'gemini' | 'done';

interface VerifyResult {
  ok: boolean;
  message: string;
  /** Set when the Gemini call hit a Workspace org policy block. */
  adminBlock?: boolean;
}

/**
 * Hits AssemblyAI's account endpoint with the key. Returns 200 if the key is
 * valid, 401/403 otherwise. Cheap, no PHI, no cost.
 */
async function verifyAssemblyAi(key: string): Promise<VerifyResult> {
  if (!key.trim()) return { ok: false, message: 'Paste a key first.' };
  try {
    const res = await fetch('https://api.assemblyai.com/v2/account', {
      headers: { Authorization: key.trim() },
    });
    if (res.ok) return { ok: true, message: 'Key works. Practice covered by your AssemblyAI BAA.' };
    if (res.status === 401)
      return { ok: false, message: 'Key rejected (401). Double-check you copied the full key.' };
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      message: redactKeysInText(`${res.status}: ${body.slice(0, 200) || 'unexpected response'}`),
    };
  } catch (err) {
    return {
      ok: false,
      message:
        'Network error reaching AssemblyAI. Check your connection and try again. ' +
        redactKeysInText(err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Hits Gemini's models list. 200 = key works. The "API Keys are Disallowed"
 * org-policy error is surfaced separately so we can show the inline admin fix.
 */
async function verifyGemini(key: string): Promise<VerifyResult> {
  if (!key.trim()) return { ok: false, message: 'Paste a key first.' };
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key.trim() },
    });
    if (res.ok) return { ok: true, message: 'Key works.' };
    const body = await res.text().catch(() => '');
    const adminBlocked =
      /API[_ ]Keys?[_ ](are[_ ])?Disallowed/i.test(body) ||
      /iam\.managed\.disableServiceAccountApiKeyCreation/i.test(body) ||
      /policy.*disable.*api.?key/i.test(body);
    return {
      ok: false,
      adminBlock: adminBlocked,
      message: adminBlocked
        ? "Your Google Workspace blocks API key creation by org policy. As an admin you can override it — see the steps below."
        : redactKeysInText(`${res.status}: ${body.slice(0, 300) || 'unexpected response'}`),
    };
  } catch (err) {
    return {
      ok: false,
      message:
        'Network error reaching Google. Check your connection and try again. ' +
        redactKeysInText(err instanceof Error ? err.message : String(err)),
    };
  }
}

export function Wizard() {
  const { settings, saveSettings, setView } = useAppStore();
  const [step, setStep] = useState<Step>(() =>
    settings.assemblyAiKey && settings.geminiApiKey ? 'done' : 'welcome',
  );
  const [assemblyKey, setAssemblyKey] = useState(settings.assemblyAiKey);
  const [assemblyVerify, setAssemblyVerify] = useState<VerifyResult | null>(
    settings.assemblyAiKey ? { ok: true, message: 'Saved earlier — re-verify if needed.' } : null,
  );
  const [assemblyChecking, setAssemblyChecking] = useState(false);
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey);
  const [geminiVerify, setGeminiVerify] = useState<VerifyResult | null>(
    settings.geminiApiKey ? { ok: true, message: 'Saved earlier — re-verify if needed.' } : null,
  );
  const [geminiChecking, setGeminiChecking] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);

  function persist(partial: Parameters<typeof saveSettings>[0]): boolean {
    const err = saveSettings(partial);
    if (err) {
      setPersistError(err);
      return false;
    }
    setPersistError(null);
    return true;
  }

  async function handleVerifyAssembly(): Promise<void> {
    setAssemblyChecking(true);
    try {
      const result = await verifyAssemblyAi(assemblyKey);
      setAssemblyVerify(result);
      if (result.ok) persist({ assemblyAiKey: assemblyKey.trim() });
    } finally {
      setAssemblyChecking(false);
    }
  }

  async function handleVerifyGemini(): Promise<void> {
    setGeminiChecking(true);
    try {
      const result = await verifyGemini(geminiKey);
      setGeminiVerify(result);
      if (result.ok) persist({ geminiApiKey: geminiKey.trim(), provider: 'gemini-api-key' });
    } finally {
      setGeminiChecking(false);
    }
  }

  function finishWizard(): void {
    if (!persist({ wizardCompletedV1: true })) return;
    setView('home');
  }

  function exitWizard(): void {
    // User can always re-run from Settings. Don't mark complete.
    setView('home');
  }

  return (
    <main className="mx-auto max-w-2xl px-3 py-6 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-center justify-between">
        <Lockup size="md" />
        <button
          type="button"
          onClick={exitWizard}
          className="text-sm text-graphite-soft hover:text-graphite"
        >
          Skip for now
        </button>
      </header>

      <ProgressDots step={step} />

      {step === 'welcome' ? (
        <WelcomeStep onNext={() => setStep('assembly')} />
      ) : step === 'assembly' ? (
        <AssemblyStep
          value={assemblyKey}
          onChange={setAssemblyKey}
          verify={assemblyVerify}
          checking={assemblyChecking}
          onVerify={handleVerifyAssembly}
          onBack={() => setStep('welcome')}
          onNext={() => setStep('gemini')}
        />
      ) : step === 'gemini' ? (
        <GeminiStep
          value={geminiKey}
          onChange={setGeminiKey}
          verify={geminiVerify}
          checking={geminiChecking}
          onVerify={handleVerifyGemini}
          onBack={() => setStep('assembly')}
          onNext={() => setStep('done')}
        />
      ) : (
        <DoneStep onFinish={finishWizard} />
      )}

      {persistError ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Couldn't save to this browser</p>
          <p className="mt-1">{persistError}</p>
          <p className="mt-2 text-xs">
            Common causes on iOS: Private Browsing, "Block All Cookies" in Settings → Safari, or
            using a different mode than where the keys were last saved (Safari tab vs. Add-to-Home
            PWA store separately).
          </p>
        </div>
      ) : null}
    </main>
  );
}

function ProgressDots({ step }: { step: Step }){
  const order: Step[] = ['welcome', 'assembly', 'gemini', 'done'];
  const idx = order.indexOf(step);
  return (
    <ol className="mb-8 flex items-center justify-center gap-2">
      {order.map((s, i) => (
        <li
          key={s}
          aria-current={s === step ? 'step' : undefined}
          className={
            'h-2 rounded-full transition-all ' +
            (i === idx ? 'w-8 bg-graphite' : i < idx ? 'w-2 bg-graphite' : 'w-2 bg-graphite-soft/30')
          }
        />
      ))}
    </ol>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }){
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-graphite">
        Let's get you set up.
      </h1>
      <p className="mt-3 text-sm text-graphite-soft">
        brtlb runs in your browser. You bring two keys — one for transcription, one for the LLM
        that writes your notes. Keys live in this browser; they never leave the device.
      </p>
      <ul className="mt-5 space-y-2 text-sm text-graphite">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-graphite text-xs font-semibold text-white">
            1
          </span>
          <span>
            <span className="font-medium">AssemblyAI</span> — transcription with speaker labels.
            Free signup, BAA via DocuSign.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-graphite text-xs font-semibold text-white">
            2
          </span>
          <span>
            <span className="font-medium">Google Gemini</span> — note generation. Uses your Google
            Workspace HIPAA BAA if you have one.
          </span>
        </li>
      </ul>
      <p className="mt-5 text-xs text-graphite-soft">
        Takes about 5 minutes. We'll test each key live before moving on.
      </p>
      <div className="mt-8 flex justify-end">
        <Button onClick={onNext}>Get started</Button>
      </div>
    </section>
  );
}

function AssemblyStep(props: {
  value: string;
  onChange: (v: string) => void;
  verify: VerifyResult | null;
  checking: boolean;
  onVerify: () => void;
  onBack: () => void;
  onNext: () => void;
}){
  const { value, onChange, verify, checking, onVerify, onBack, onNext } = props;
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-graphite">Step 1 of 2 · AssemblyAI</h2>
      <p className="mt-2 text-sm text-graphite-soft">
        Sign up (free), grab your API key from the dashboard, paste it here.
      </p>

      <ol className="mt-5 space-y-4 text-sm text-graphite">
        <li className="flex flex-wrap items-center gap-3">
          <span className="font-medium">a.</span>
          <a
            href="https://www.assemblyai.com/dashboard/signup"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-graphite px-3 py-1.5 text-xs font-medium text-white hover:bg-graphite-soft"
          >
            Open AssemblyAI signup ↗
          </a>
          <span className="text-xs text-graphite-soft">
            Already have an account? Just open the dashboard.
          </span>
        </li>
        <li className="flex flex-wrap items-center gap-3">
          <span className="font-medium">b.</span>
          <a
            href="https://na4.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=12d882a8-2414-419a-9d61-5b15a3d20c19&env=na4&acct=327087e3-0eb7-4ce0-b492-10daade58b39&v=2"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist"
          >
            Sign their BAA ↗
          </a>
          <span className="text-xs text-graphite-soft">
            Required before recording any real patient visits.
          </span>
        </li>
        <li>
          <span className="font-medium">c.</span> Paste the API key from your dashboard:
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="32-character hex string"
            autoComplete="off"
            spellCheck={false}
            className="mt-2 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 font-mono text-sm text-graphite focus:border-graphite focus:outline-none"
          />
        </li>
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVerify}
          disabled={checking || !value.trim()}
          className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
        >
          {checking ? 'Verifying…' : 'Verify key'}
        </button>
        {verify ? (
          <p className={'text-sm ' + (verify.ok ? 'text-emerald-700' : 'text-red-700')}>
            {verify.ok ? '✓ ' : '✗ '}
            {verify.message}
          </p>
        ) : null}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-graphite-soft hover:text-graphite"
        >
          ← Back
        </button>
        <Button onClick={onNext} disabled={!verify?.ok}>
          Next: Gemini key
        </Button>
      </div>
    </section>
  );
}

function GeminiStep(props: {
  value: string;
  onChange: (v: string) => void;
  verify: VerifyResult | null;
  checking: boolean;
  onVerify: () => void;
  onBack: () => void;
  onNext: () => void;
}){
  const { value, onChange, verify, checking, onVerify, onBack, onNext } = props;
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-graphite">Step 2 of 2 · Google Gemini</h2>
      <p className="mt-2 text-sm text-graphite-soft">
        If your practice runs on Google Workspace, your existing HIPAA BAA already covers Gemini
        when the key comes from a billing-enabled Cloud project.
      </p>

      <ol className="mt-5 space-y-4 text-sm text-graphite">
        <li className="flex flex-wrap items-center gap-3">
          <span className="font-medium">a.</span>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-graphite px-3 py-1.5 text-xs font-medium text-white hover:bg-graphite-soft"
          >
            Open AI Studio ↗
          </a>
          <span className="text-xs text-graphite-soft">
            Click "Create API key" → pick or create a Cloud project → copy the AIzaSy… string.
          </span>
        </li>
        <li>
          <span className="font-medium">b.</span> Paste the key here:
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="AIzaSy…"
            autoComplete="off"
            spellCheck={false}
            className="mt-2 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 font-mono text-sm text-graphite focus:border-graphite focus:outline-none"
          />
        </li>
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVerify}
          disabled={checking || !value.trim()}
          className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
        >
          {checking ? 'Verifying…' : 'Verify key'}
        </button>
        {verify && !verify.adminBlock ? (
          <p className={'text-sm ' + (verify.ok ? 'text-emerald-700' : 'text-red-700')}>
            {verify.ok ? '✓ ' : '✗ '}
            {verify.message}
          </p>
        ) : null}
      </div>

      {verify?.adminBlock ? <AdminPolicyHelp /> : null}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-graphite-soft hover:text-graphite"
        >
          ← Back
        </button>
        <Button onClick={onNext} disabled={!verify?.ok}>
          Finish setup
        </Button>
      </div>
    </section>
  );
}

function AdminPolicyHelp(){
  return (
    <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Workspace org policy is blocking API key creation</p>
      <p className="mt-1">
        You see this on a brand-new GCP project where the org enforces{' '}
        <code className="rounded bg-white/70 px-1 py-0.5 text-[11px]">
          iam.managed.disableServiceAccountApiKeyCreation
        </code>
        . If you're a Workspace admin, you can override it for this project:
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5">
        <li>
          <a
            href="https://console.cloud.google.com/iam-admin/iam"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Open GCP IAM
          </a>{' '}
          — switch the project picker (top of page) to your{' '}
          <span className="font-medium">organization</span>, find your account, add the role{' '}
          <span className="font-medium">Organization Policy Administrator</span>. Wait ~30 seconds.
        </li>
        <li>
          <a
            href="https://console.cloud.google.com/iam-admin/orgpolicies/list"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Open Organization Policies
          </a>{' '}
          — filter by "api". Find any policy disabling API key creation, click ⋮ → Edit policy →{' '}
          <span className="font-medium">Override parent's policy</span> → Off → Save.
        </li>
        <li>
          Back in{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            AI Studio
          </a>
          , create the key. Paste it above and verify.
        </li>
      </ol>
      <p className="mt-3 text-xs">
        Don't have admin? Use a personal Gmail to make a non-PHI test key, or ask your IT to run
        these steps.
      </p>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }){
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-seafoam text-graphite">
          ✓
        </span>
        <h2 className="text-xl font-semibold text-graphite">You're set.</h2>
      </div>
      <p className="mt-3 text-sm text-graphite-soft">
        Both keys verified and saved to this browser. You're ready to record your first visit.
      </p>
      <ul className="mt-5 space-y-2 text-sm text-graphite-soft">
        <li>· Tap "Record visit" on the home screen to capture an ambient encounter.</li>
        <li>· Or "dictate" if you'd rather narrate the note yourself.</li>
        <li>· Long visits (autism evals, BH): plug the phone in and disable Auto-Lock.</li>
      </ul>
      <div className="mt-8 flex justify-end">
        <Button onClick={onFinish}>Take me home</Button>
      </div>
    </section>
  );
}
