import { useState, type KeyboardEvent } from 'react';
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
 * Verifies the AssemblyAI key by listing the user's transcripts (limit=1).
 * Returns 200 if auth works, 401 if not. AssemblyAI doesn't expose a billing
 * or BAA-status endpoint, and a real transcription round-trip would cost money
 * and take 10+ seconds — so auth is the practical ceiling here.
 */
async function verifyAssemblyAi(key: string): Promise<VerifyResult> {
  if (!key.trim()) return { ok: false, message: 'Paste a key first.' };
  try {
    const res = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', {
      headers: { Authorization: key.trim() },
    });
    if (res.ok) return { ok: true, message: 'Key works.' };
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
        'Network error reaching AssemblyAI. ' +
        redactKeysInText(err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * True end-to-end Gemini probe: sends a tiny generateContent request against
 * the model the user will actually use. Costs a fraction of a cent. This is
 * the only way to confirm key + API enabled + billing + chosen model all work
 * together — listing /models doesn't catch a stale model name or a billing gap.
 */
async function verifyGemini(key: string, model: string): Promise<VerifyResult> {
  if (!key.trim()) return { ok: false, message: 'Paste a key first.' };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key.trim(),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      },
    );

    if (res.ok) {
      const json = (await res.json().catch(() => null)) as
        | { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
        | null;
      const reply =
        json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (/ok/i.test(reply)) return { ok: true, message: `Generation works (${model}).` };
      return {
        ok: false,
        message: `Reached ${model} but got an unexpected reply: ${reply.slice(0, 80) || '(empty)'}`,
      };
    }

    const body = await res.text().catch(() => '');
    const adminBlocked =
      /API[_ ]Keys?[_ ](are[_ ])?Disallowed/i.test(body) ||
      /iam\.managed\.disableServiceAccountApiKeyCreation/i.test(body) ||
      /policy.*disable.*api.?key/i.test(body);
    if (adminBlocked) {
      return {
        ok: false,
        adminBlock: true,
        message: 'Workspace org policy is blocking API key creation. See the admin steps below.',
      };
    }
    if (/billing/i.test(body) || /CONSUMER_INVALID/i.test(body) || res.status === 403) {
      return {
        ok: false,
        message:
          'Project may not have billing linked or the Generative Language API enabled. ' +
          redactKeysInText(`${res.status}: ${body.slice(0, 200)}`),
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        message: `Model "${model}" wasn't found for this key. Use "List my models" in Settings to pick one.`,
      };
    }
    return {
      ok: false,
      message: redactKeysInText(`${res.status}: ${body.slice(0, 300) || 'unexpected response'}`),
    };
  } catch (err) {
    return {
      ok: false,
      message:
        'Network error reaching Google. ' +
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
    settings.assemblyAiKey ? { ok: true, message: 'Saved earlier — verified previously.' } : null,
  );
  const [assemblyChecking, setAssemblyChecking] = useState(false);
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey);
  const [geminiVerify, setGeminiVerify] = useState<VerifyResult | null>(
    settings.geminiApiKey ? { ok: true, message: 'Saved earlier — verified previously.' } : null,
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
    if (!assemblyKey.trim() || assemblyChecking) return;
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
    if (!geminiKey.trim() || geminiChecking) return;
    setGeminiChecking(true);
    try {
      const result = await verifyGemini(geminiKey, settings.geminiModel);
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

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:py-14">
      <header className="mb-8 flex items-center justify-between">
        <Lockup size="md" />
        <button
          type="button"
          onClick={() => setView('home')}
          className="text-xs text-graphite-soft hover:text-graphite"
        >
          I'll do this later
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
            using a different mode than where keys were last saved (Safari tab vs. Add-to-Home PWA
            store separately).
          </p>
        </div>
      ) : null}
    </main>
  );
}

function ProgressDots({ step }: { step: Step }) {
  const order: Step[] = ['welcome', 'assembly', 'gemini', 'done'];
  const idx = order.indexOf(step);
  return (
    <ol className="mb-10 flex items-center justify-center gap-2" aria-label="Setup progress">
      {order.map((s, i) => (
        <li
          key={s}
          aria-current={s === step ? 'step' : undefined}
          className={
            'h-1.5 rounded-full transition-all ' +
            (i === idx
              ? 'w-10 bg-graphite'
              : i < idx
                ? 'w-1.5 bg-graphite'
                : 'w-1.5 bg-graphite-soft/25')
          }
        />
      ))}
    </ol>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <section className="rounded-2xl bg-white p-7 shadow-sm sm:p-10">
      <h1 className="text-3xl font-semibold tracking-tight text-graphite">Welcome.</h1>
      <p className="mt-4 text-base leading-relaxed text-graphite-soft">
        brtlb runs in your browser. You'll add two keys — one for transcription
        (<span className="font-medium text-graphite">AssemblyAI</span>), one for note generation
        (<span className="font-medium text-graphite">Gemini</span>). Both stay on this device.
      </p>
      <p className="mt-4 text-sm text-graphite-soft">
        Takes a few minutes. Each key is tested live before you move on, so you'll know it works.
      </p>
      <div className="mt-8 flex justify-end">
        <Button onClick={onNext}>Continue</Button>
      </div>
    </section>
  );
}

function StepCard(props: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-7 shadow-sm sm:p-10">
      <h2 className="text-2xl font-semibold tracking-tight text-graphite">{props.title}</h2>
      <p className="mt-2 text-sm text-graphite-soft">{props.subtitle}</p>
      <div className="mt-6 space-y-5">{props.children}</div>
    </section>
  );
}

function VerifyRow(props: {
  value: string;
  onChange: (v: string) => void;
  onVerify: () => void;
  checking: boolean;
  placeholder: string;
}) {
  function handleKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      props.onVerify();
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        type="password"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder={props.placeholder}
        autoComplete="off"
        spellCheck={false}
        className="flex-1 rounded-md border border-graphite-soft/30 bg-white px-3 py-2.5 font-mono text-sm text-graphite focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite"
      />
      <button
        type="button"
        onClick={props.onVerify}
        disabled={props.checking || !props.value.trim()}
        className="rounded-md border border-graphite-soft/30 bg-white px-5 py-2.5 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
      >
        {props.checking ? 'Verifying…' : 'Verify'}
      </button>
    </div>
  );
}

function VerifyStatus({ result }: { result: VerifyResult | null }) {
  if (!result || result.adminBlock) return null;
  return (
    <p
      role="status"
      className={'text-sm ' + (result.ok ? 'text-emerald-700' : 'text-red-700')}
    >
      {result.ok ? '✓ ' : '✗ '}
      {result.message}
    </p>
  );
}

function StepNav(props: { onBack: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="mt-8 flex items-center justify-between">
      <button
        type="button"
        onClick={props.onBack}
        className="text-sm text-graphite-soft hover:text-graphite"
      >
        ← Back
      </button>
      <Button onClick={props.onNext} disabled={props.nextDisabled}>
        Continue
      </Button>
    </div>
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
}) {
  return (
    <StepCard
      title="AssemblyAI"
      subtitle="Transcribes the visit audio with speaker labels."
    >
      <div>
        <a
          href="https://www.assemblyai.com/dashboard/signup"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-graphite px-4 py-2 text-sm font-medium text-white hover:bg-graphite-soft"
        >
          Open AssemblyAI <span aria-hidden>↗</span>
        </a>
        <p className="mt-2 text-xs text-graphite-soft">
          Sign up free, copy your API key from the dashboard, paste it below.
        </p>
        <details className="mt-2 text-xs text-graphite-soft">
          <summary className="cursor-pointer text-graphite underline-offset-2 hover:underline">
            Where exactly is the key?
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
            <li>Sign up with your work email and verify it.</li>
            <li>
              You'll land on the dashboard. Look at the top-right card labeled{' '}
              <span className="font-medium text-graphite">"API Key"</span> (or "Your API key").
            </li>
            <li>Tap the copy icon next to the masked string. It's 32 hex characters.</li>
            <li>
              Paste it below. The key stays valid until you regenerate it from{' '}
              <span className="font-medium text-graphite">Account → API keys</span>.
            </li>
          </ol>
          <p className="mt-2">
            New accounts get $50 of free credit — about 75 hours of audio. Plenty for testing.
          </p>
        </details>
      </div>

      <VerifyRow
        value={props.value}
        onChange={props.onChange}
        onVerify={props.onVerify}
        checking={props.checking}
        placeholder="32-character hex key"
      />
      <VerifyStatus result={props.verify} />

      {props.verify?.ok ? (
        <p className="rounded-md bg-mist px-3 py-2 text-xs text-graphite-soft">
          Before recording <em>real</em> patient visits, sign their HIPAA BAA via{' '}
          <a
            href="https://na4.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=12d882a8-2414-419a-9d61-5b15a3d20c19&env=na4&acct=327087e3-0eb7-4ce0-b492-10daade58b39&v=2"
            target="_blank"
            rel="noopener noreferrer"
            className="text-graphite underline underline-offset-2 hover:text-graphite-soft"
          >
            DocuSign ↗
          </a>
          . Test runs without PHI don't need it.
        </p>
      ) : null}

      <StepNav onBack={props.onBack} onNext={props.onNext} nextDisabled={!props.verify?.ok} />
    </StepCard>
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
}) {
  return (
    <StepCard
      title="Google Gemini"
      subtitle="Writes the SOAP note. If your practice is on Google Workspace, your existing HIPAA BAA covers Gemini when the key comes from a billing-enabled Cloud project."
    >
      <div>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-graphite px-4 py-2 text-sm font-medium text-white hover:bg-graphite-soft"
        >
          Open AI Studio <span aria-hidden>↗</span>
        </a>
        <p className="mt-2 text-xs text-graphite-soft">
          Click "Create API key" → pick or create a Cloud project → copy the AIzaSy… string.
        </p>
        <details className="mt-2 text-xs text-graphite-soft">
          <summary className="cursor-pointer text-graphite underline-offset-2 hover:underline">
            Walk me through it
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
            <li>
              Sign in with your{' '}
              <span className="font-medium text-graphite">work Google account</span> (the one with
              your practice's HIPAA BAA). Personal Gmail works too for testing without PHI.
            </li>
            <li>
              Tap the blue <span className="font-medium text-graphite">"Create API key"</span>{' '}
              button at the top of the page.
            </li>
            <li>
              When asked, pick a <span className="font-medium text-graphite">Google Cloud project</span>{' '}
              — any project tied to your billing account works. If you don't have one yet, choose
              "Create API key in new project."
            </li>
            <li>
              A modal pops up showing your key, starting with{' '}
              <span className="font-mono text-graphite">AIzaSy…</span>. Tap the copy icon. The key
              stays accessible from the same page if you need it again.
            </li>
            <li>Paste it below.</li>
          </ol>
          <p className="mt-2">
            <span className="font-medium text-graphite">Hit a wall?</span> If AI Studio shows "API
            keys are disallowed," your Workspace org policy blocks API key creation. The wizard
            detects this on Verify and shows the admin override path.
          </p>
        </details>
      </div>

      <VerifyRow
        value={props.value}
        onChange={props.onChange}
        onVerify={props.onVerify}
        checking={props.checking}
        placeholder="AIzaSy…"
      />
      <VerifyStatus result={props.verify} />

      {props.verify?.adminBlock ? <AdminPolicyHelp /> : null}

      <StepNav onBack={props.onBack} onNext={props.onNext} nextDisabled={!props.verify?.ok} />
    </StepCard>
  );
}

function AdminPolicyHelp() {
  return (
    <details
      open
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <summary className="cursor-pointer font-semibold">
        Workspace org policy is blocking API key creation
      </summary>
      <p className="mt-3">
        New GCP projects under a Workspace org may enforce{' '}
        <code className="rounded bg-white/70 px-1 py-0.5 text-[11px]">
          iam.managed.disableServiceAccountApiKeyCreation
        </code>
        . If you're a Workspace admin, override it for this project:
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5">
        <li>
          <a
            href="https://console.cloud.google.com/iam-admin/iam"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            GCP IAM
          </a>{' '}
          — switch the picker to your <span className="font-medium">organization</span>, give your
          account the <span className="font-medium">Organization Policy Administrator</span> role.
          Wait ~30 seconds.
        </li>
        <li>
          <a
            href="https://console.cloud.google.com/iam-admin/orgpolicies/list"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Organization Policies
          </a>{' '}
          — filter by "api". On the offending policy, ⋮ → Edit policy →{' '}
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
        Not an admin? Use a personal Gmail to make a non-PHI test key, or ask your IT to run these
        steps.
      </p>
    </details>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <section className="rounded-2xl bg-white p-7 shadow-sm sm:p-10">
      <p className="text-sm font-medium uppercase tracking-wider text-emerald-700">✓ All set</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-graphite">
        Ready to record.
      </h2>
      <p className="mt-4 text-base leading-relaxed text-graphite-soft">
        Both keys verified and saved to this browser. Tap{' '}
        <span className="font-medium text-graphite">Record visit</span> on the home screen for an
        ambient encounter, or <span className="font-medium text-graphite">dictate</span> if you'd
        rather narrate the note yourself.
      </p>
      <p className="mt-4 text-xs text-graphite-soft">
        For long visits (autism evals, behavioral health), plug the phone in and disable
        Auto-Lock — iOS suspends background recording when the screen sleeps.
      </p>
      <div className="mt-8 flex justify-end">
        <Button onClick={onFinish}>Start using brtlb</Button>
      </div>
    </section>
  );
}
