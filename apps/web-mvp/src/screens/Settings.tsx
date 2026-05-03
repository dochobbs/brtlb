import { useEffect, useState } from 'react';
import { Button } from '@brtlb/ui';
import { useAppStore, type ProviderKind } from '../store';
import { KeyField } from '../components/KeyField';
import { redactKeysInText } from '../lib/redact';
import { clearAll, listAuditLog, logAudit, type AuditLogEntry } from '../lib/db';
import { CustomTemplateEditor } from '../components/CustomTemplateEditor';
import { CHANGELOG } from '../lib/changelog';
import { clearClipboard } from '../lib/clipboard';
import {
  createAnthropicProvider,
  createGeminiApiKeyProvider,
  createOpenAiCompatibleProvider,
} from '@brtlb/pipeline';

const ANTHROPIC_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'];
const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
// Starter list of recent Gemini models. The "List my models" button replaces
// this with whatever the user's key actually has access to. Newer keys may
// not have 3.x in their listing — typing a model name into the field directly
// works even when List my models doesn't surface it.
const GEMINI_MODELS_DEFAULT = [
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash-001',
];

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Anthropic',
  'gemini-api-key': 'Gemini',
  'openai-compatible': 'OpenAI-compatible',
};

export function Settings() {
  const { settings, saveSettings, setView } = useAppStore();
  const [draft, setDraft] = useState(settings);
  const [testStatus, setTestStatus] = useState<null | { ok: boolean; message: string }>(null);
  const [testing, setTesting] = useState(false);
  const [geminiModels, setGeminiModels] = useState<string[]>(GEMINI_MODELS_DEFAULT);
  const [listingGeminiModels, setListingGeminiModels] = useState(false);
  const [geminiModelsError, setGeminiModelsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleListGeminiModels(): Promise<void> {
    setListingGeminiModels(true);
    setGeminiModelsError(null);
    try {
      // Pass the key in the x-goog-api-key header — keeps it out of browser
      // history, referrer headers, and any URL-based logs.
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': draft.geminiApiKey },
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };
      const all = json.models ?? [];
      // Prefer Gemini models that support generateContent for the dropdown.
      const generateCapable = all
        .filter(
          (m) =>
            m.name &&
            m.name.includes('gemini') &&
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent'),
        )
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .sort();

      if (generateCapable.length === 0) {
        // Diagnostic: show what we DID get so the user can see why nothing matched.
        const allNames = all
          .map((m) => (m.name ?? '').replace(/^models\//, ''))
          .filter(Boolean)
          .join(', ');
        throw new Error(
          allNames
            ? `No Gemini models with generateContent support. API returned: ${allNames}`
            : 'API returned 0 models. Project may need billing enabled at console.cloud.google.com/billing/linkedaccount',
        );
      }
      setGeminiModels(generateCapable);
      // Auto-select the first if the current draft model isn't in the list
      if (!generateCapable.includes(draft.geminiModel)) {
        update('geminiModel', generateCapable[0] ?? draft.geminiModel);
      }
    } catch (err) {
      setGeminiModelsError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setListingGeminiModels(false);
    }
  }

  async function handleSave() {
    const err = saveSettings(draft);
    if (err) {
      setSaveError(err);
      return; // stay on the page so the user sees the failure
    }
    setSaveError(null);
    void logAudit('settings_saved');
    setView('home');
  }

  async function handleTest() {
    setTesting(true);
    setTestStatus(null);
    try {
      const provider =
        draft.provider === 'anthropic'
          ? createAnthropicProvider({
              kind: 'anthropic',
              apiKey: draft.anthropicApiKey,
              model: draft.anthropicModel,
              maxTokens: 64,
            })
          : draft.provider === 'gemini-api-key'
            ? createGeminiApiKeyProvider({
                kind: 'gemini-api-key',
                apiKey: draft.geminiApiKey,
                model: draft.geminiModel,
                maxOutputTokens: 64,
              })
            : createOpenAiCompatibleProvider({
                kind: 'openai-compatible',
                apiKey: draft.openaiApiKey,
                model: draft.openaiModel,
                maxTokens: 64,
                ...(draft.openaiBaseUrl ? { baseUrl: draft.openaiBaseUrl } : {}),
              });

      const out = await provider.generateNote({
        transcript: {
          id: 'probe',
          recordingId: 'probe',
          utterances: [
            {
              speakerId: 'A',
              role: 'provider',
              startMs: 0,
              endMs: 1000,
              text: 'reply with the single word PONG',
              confidence: 1,
            },
          ],
          createdAt: new Date().toISOString(),
        },
        template: {
          id: 'probe',
          name: 'Probe',
          description: '',
          promptBody: 'You are a connection probe. Reply with the single word PONG.',
        },
        pattern: { id: 'probe', name: 'Probe', description: '', promptModifier: '' },
        mode: 'dictation',
        speakerRoles: [],
      });

      const ok = /pong/i.test(out);
      setTestStatus({
        ok,
        message: ok
          ? `OK — ${draft.provider} answered.`
          : `Reached ${draft.provider} but got an unexpected reply.`,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'unknown error';
      const isAnthropicCors = /CORS requests are not allowed for this Organization/i.test(raw);
      const message = isAnthropicCors
        ? 'Anthropic blocks browser calls for BAA / Enterprise orgs (custom retention). Switch to Gemini for now, use a personal Anthropic key without custom retention, or wait for the native app.'
        : redactKeysInText(raw);
      setTestStatus({ ok: false, message });
    } finally {
      setTesting(false);
    }
  }

  async function handleWipeAll(): Promise<void> {
    const confirmed = window.confirm(
      'Wipe ALL local brtlb data? This deletes:\n\n' +
        '  • All recordings (audio + transcripts + notes)\n' +
        '  • Saved API keys and settings\n' +
        '  • Any in-progress work\n\n' +
        'There is no undo. Continue?',
    );
    if (!confirmed) return;
    void logAudit('wipe_all');
    await clearAll();
    if (typeof localStorage !== 'undefined') localStorage.clear();
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
    // Clear PWA / Service Worker caches so cached note pages aren't recoverable
    // post-wipe. Best-effort; failures here shouldn't block the wipe.
    if (typeof caches !== 'undefined') {
      try {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      } catch {
        // ignore — caches API may not exist or may throw on private mode
      }
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch {
        // ignore
      }
    }
    window.location.reload();
  }

  return (
    <main className="mx-auto max-w-2xl px-3 py-6 sm:px-6 sm:py-12">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-graphite">Settings</h1>
        <button
          type="button"
          onClick={() => setView('home')}
          className="text-sm text-graphite-soft hover:text-graphite"
        >
          Cancel
        </button>
      </header>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm text-graphite-soft">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setView('wizard')}
            className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist"
          >
            Run setup wizard
          </button>
          <span>
            Need keys?{' '}
            <a
              href="https://github.com/dochobbs/brtlb/blob/main/docs/SETUP.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-graphite underline underline-offset-2 hover:text-graphite-soft"
            >
              Setup guide →
            </a>
          </span>
        </div>
        <ThemeToggle />
      </div>

      <ChangelogPanel />

      <SupportPanel />

      <section className="space-y-6 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-graphite">Foundation model</h2>
          <p className="mt-1 text-xs text-graphite-soft">
            Pick a provider you have a Business Associate Agreement with. Keys are stored in your
            browser's localStorage and never leave this device.
          </p>
          <div className="mt-3 inline-flex flex-wrap rounded-md border border-graphite-soft/30 p-0.5">
            {(['gemini-api-key', 'openai-compatible'] as ProviderKind[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => update('provider', p)}
                className={
                  'rounded px-3 py-1.5 text-sm font-medium transition ' +
                  (draft.provider === p
                    ? 'bg-graphite text-white'
                    : 'text-graphite-soft hover:text-graphite')
                }
              >
                {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        {draft.provider === 'anthropic' ? (
          <div className="space-y-4">
            <KeyField
              label="Anthropic API key"
              value={draft.anthropicApiKey}
              savedValue={settings.anthropicApiKey}
              onChange={(v) => update('anthropicApiKey', v)}
              placeholder="sk-ant-..."
              helperText="Get a key with BAA at console.anthropic.com (Enterprise / BAA Add-on)."
            />
            <label className="block">
              <span className="block text-sm font-medium text-graphite">Model</span>
              <select
                value={draft.anthropicModel}
                onChange={(e) => update('anthropicModel', e.target.value)}
                className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
              >
                {ANTHROPIC_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : draft.provider === 'gemini-api-key' ? (
          <div className="space-y-4">
            <KeyField
              label="Gemini API key"
              value={draft.geminiApiKey}
              savedValue={settings.geminiApiKey}
              onChange={(v) => update('geminiApiKey', v)}
              placeholder="AIzaSy..."
              helperText="Recommended for users on Google Workspace — leverages your existing Google HIPAA BAA. Create the key in your Google Cloud project (APIs & Services → Credentials) with billing enabled. See docs/SETUP.md for the step-by-step."
            />
            <div>
              <div className="flex items-end justify-between gap-3">
                <label className="block flex-1">
                  <span className="block text-sm font-medium text-graphite">Model</span>
                  <input
                    type="text"
                    list="gemini-models"
                    value={draft.geminiModel}
                    onChange={(e) => update('geminiModel', e.target.value)}
                    className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <datalist id="gemini-models">
                    {geminiModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>
                <button
                  type="button"
                  onClick={handleListGeminiModels}
                  disabled={listingGeminiModels || !draft.geminiApiKey}
                  className="mb-px rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-xs font-medium text-graphite hover:bg-mist disabled:opacity-50"
                >
                  {listingGeminiModels ? 'Listing…' : 'List my models'}
                </button>
              </div>
              {geminiModelsError ? (
                <p className="mt-1 text-xs text-red-700">{geminiModelsError}</p>
              ) : (
                <p className="mt-1 text-xs text-graphite-soft">
                  Click "List my models" to populate the dropdown with what your key actually has
                  access to.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <KeyField
              label="OpenAI-compatible API key"
              value={draft.openaiApiKey}
              savedValue={settings.openaiApiKey}
              onChange={(v) => update('openaiApiKey', v)}
              placeholder="sk-..."
              helperText="Works with OpenAI, Azure OpenAI, OpenRouter, Ollama, and other compatible endpoints."
            />
            <label className="block">
              <span className="block text-sm font-medium text-graphite">Base URL (optional)</span>
              <input
                type="text"
                value={draft.openaiBaseUrl}
                onChange={(e) => update('openaiBaseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-graphite-soft">
                Leave blank for OpenAI proper. Override for Azure/OpenRouter/local.
              </p>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-graphite">Model</span>
              <input
                type="text"
                list="openai-models"
                value={draft.openaiModel}
                onChange={(e) => update('openaiModel', e.target.value)}
                className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="openai-models">
                {OPENAI_MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </div>
        )}
      </section>

      <section className="mt-6 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-graphite">Transcription</h2>
          <p className="mt-1 text-xs text-graphite-soft">
            AssemblyAI handles diarization. A BAA-eligible plan is required for PHI.
          </p>
        </div>
        <KeyField
          label="AssemblyAI API key"
          value={draft.assemblyAiKey}
          savedValue={settings.assemblyAiKey}
          onChange={(v) => update('assemblyAiKey', v)}
          placeholder="aai-..."
          helperText="Get a key at assemblyai.com. Sign a BAA before using with PHI."
        />
      </section>

      {saveError ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Couldn't save your settings</p>
          <p className="mt-1">{saveError}</p>
          <p className="mt-2 text-xs">
            Common causes on iOS: Private Browsing is on, "Block All Cookies" is enabled in Settings
            → Safari, or you're using a different mode than where the keys were last saved (Safari
            tab vs. Add-to-Home-Screen PWA store keys separately). After fixing, tap Save again.
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <Button onClick={handleSave}>Save</Button>
      </div>

      <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <CustomTemplateEditor
          templates={draft.customTemplates}
          onChange={(next) => update('customTemplates', next)}
        />
      </section>

      <section className="mt-6 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-graphite">Privacy</h2>
          <p className="mt-1 text-xs text-graphite-soft">
            Audio is the heaviest PHI we store. Auto-purge the recording's audio file after this
            many days. Transcripts and notes stay until you delete them manually. Set to 0 to keep
            audio forever (not recommended).
          </p>
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-graphite">Auto-purge audio after</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={365}
              value={draft.audioPurgeDays}
              onChange={(e) => update('audioPurgeDays', Number(e.target.value) || 0)}
              className="w-24 rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
            />
            <span className="text-sm text-graphite-soft">days</span>
          </div>
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-graphite">Idle auto-lock</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={120}
              value={draft.idleLockMinutes}
              onChange={(e) => update('idleLockMinutes', Number(e.target.value) || 0)}
              className="w-24 rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
            />
            <span className="text-sm text-graphite-soft">
              minutes — hides PHI behind a tap-to-continue screen after inactivity. 0 = disabled.
            </span>
          </div>
        </label>
      </section>

      <PrivacySecuritySection />

      <section className="mt-10 rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="text-sm font-semibold text-red-800">Danger zone</h2>
        <p className="mt-1 text-xs text-red-700">
          Wipe every recording, transcript, note, key, and setting from this device. There is no
          undo. Use this when you're done testing or if you suspect this device has been
          compromised.
        </p>
        <button
          type="button"
          onClick={handleWipeAll}
          className="mt-4 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Wipe all local data
        </button>
      </section>
      {testStatus ? (
        <p className={'mt-3 text-sm ' + (testStatus.ok ? 'text-emerald-700' : 'text-red-700')}>
          {testStatus.message}
        </p>
      ) : null}
    </main>
  );
}

function formatChangelogDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const AUDIT_LABEL: Record<AuditLogEntry['action'], string> = {
  record_started: 'Recording started',
  record_completed: 'Recording saved',
  transcribe_started: 'Transcription started',
  transcribe_completed: 'Transcription complete',
  transcribe_failed: 'Transcription failed',
  generate_completed: 'Note generated',
  generate_failed: 'Note generation failed',
  note_copied: 'Note copied',
  note_shared: 'Note shared',
  note_downloaded: 'Note downloaded',
  note_deleted: 'Recording deleted',
  audio_purged: 'Audio auto-purged',
  wipe_all: 'All local data wiped',
  clipboard_cleared: 'Clipboard cleared',
  settings_saved: 'Settings saved',
};

function formatAuditTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function PrivacySecuritySection() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[] | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);

  function handleToggleAutoDelete(): void {
    saveSettings({
      deleteAssemblyAiAfterTranscription: !settings.deleteAssemblyAiAfterTranscription,
    });
  }

  async function loadAuditOnExpand(): Promise<void> {
    if (auditEntries !== null) return;
    const entries = await listAuditLog(100);
    setAuditEntries(entries);
  }

  async function handleClearClipboard(): Promise<void> {
    const ok = await clearClipboard();
    setClipboardStatus(
      ok
        ? 'Clipboard cleared.'
        : "Couldn't clear clipboard automatically — copy something else (a single space) to overwrite it.",
    );
    setTimeout(() => setClipboardStatus(null), 4000);
  }

  return (
    <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-graphite">Privacy &amp; security</h2>
      <p className="mt-1 text-xs text-graphite-soft">
        What stays on your device, what leaves it, and what to do if something goes wrong.
      </p>

      <details className="mt-4 rounded-md border border-graphite-soft/20 p-3">
        <summary className="cursor-pointer text-sm font-medium text-graphite">
          What stays on this device
        </summary>
        <ul className="mt-3 space-y-1.5 pl-1 text-xs leading-relaxed text-graphite-soft">
          <li>· Audio recordings (until you delete them or auto-purge runs).</li>
          <li>· Transcripts and generated notes.</li>
          <li>· Your API keys and settings.</li>
          <li>· Custom templates you've authored.</li>
          <li>· This device's audit log (last 200 actions).</li>
        </ul>
        <p className="mt-2 pl-1 text-xs text-graphite-soft">
          Wipe all of it via the Danger zone below. Audio also auto-purges on the schedule above.
        </p>
        <div className="mt-3 rounded border border-graphite-soft/20 bg-mist/40 p-2 pl-3 text-xs leading-relaxed text-graphite-soft">
          <p className="font-medium text-graphite">No cross-device sync.</p>
          <p className="mt-1">
            brtlb has no backend, so each device + browser is its own island. A recording made on
            your iPhone PWA won't appear on your laptop, on Android, or even in Safari on the same
            iPhone (the "Add to Home Screen" PWA and the Safari tab are separate containers). Use
            Copy or Download to move a note between devices manually.
          </p>
        </div>
      </details>

      <details className="mt-3 rounded-md border border-graphite-soft/20 p-3">
        <summary className="cursor-pointer text-sm font-medium text-graphite">
          What leaves this device
        </summary>
        <ul className="mt-3 space-y-2.5 pl-1 text-xs leading-relaxed text-graphite-soft">
          <li>
            <span className="font-medium text-graphite">Audio → AssemblyAI</span> (US) for
            transcription. Transcript text comes back. BAA-covered when you've signed their BAA.
            Retention is governed by your AssemblyAI account; check their dashboard.
          </li>
          <li>
            <span className="font-medium text-graphite">Transcript text → Google Gemini</span> (US)
            for note generation. The note comes back. BAA-covered if your Google Workspace HIPAA BAA
            is accepted and the key is from a billing-enabled Cloud project. Google retains
            prompts/responses for ~24h for abuse review under their BAA.
          </li>
          <li>
            <span className="font-medium text-graphite">Anonymous page-view counts → Vercel.</span>{' '}
            brtlb uses Vercel Analytics to count how many people open the site, which routes they
            visit (Home / Wizard / Record / Review), and what country / browser they're on.
            Cookieless, no fingerprinting, no cross-site tracking. Vercel never sees your audio,
            transcripts, notes, API keys, or any other PHI — only that someone navigated to a URL.
            This is the only telemetry brtlb sends.
          </li>
          <li>
            <span className="font-medium text-graphite">Nothing else.</span> brtlb has no backend in
            your data path — no server holds your audio, transcripts, notes, or keys. Vercel hosts
            the static app code only, plus the page-view analytics above.
          </li>
        </ul>
      </details>

      <details className="mt-3 rounded-md border border-graphite-soft/20 p-3">
        <summary className="cursor-pointer text-sm font-medium text-graphite">
          Your responsibilities
        </summary>
        <ul className="mt-3 space-y-2 pl-1 text-xs leading-relaxed text-graphite-soft">
          <li>
            ·{' '}
            <a
              href="https://na4.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=12d882a8-2414-419a-9d61-5b15a3d20c19&env=na4&acct=327087e3-0eb7-4ce0-b492-10daade58b39&v=2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-graphite underline underline-offset-2"
            >
              Sign AssemblyAI's BAA
            </a>{' '}
            before recording real visits.
          </li>
          <li>
            · Confirm your{' '}
            <a
              href="https://admin.google.com/ac/legalandcompliance"
              target="_blank"
              rel="noopener noreferrer"
              className="text-graphite underline underline-offset-2"
            >
              Google Workspace HIPAA BAA
            </a>{' '}
            is accepted for your domain.
          </li>
          <li>
            · Lock this device. Set a passcode or biometric. Don't leave brtlb open in front of
            others — the idle auto-lock above is a fallback, not a substitute.
          </li>
          <li>
            · On iOS: install brtlb as a PWA (Share → Add to Home Screen). PWA storage is isolated
            from the regular Safari container.
          </li>
          <li>· Keep your browser updated. Security patches matter.</li>
        </ul>
      </details>

      <details className="mt-3 rounded-md border border-graphite-soft/20 p-3">
        <summary className="cursor-pointer text-sm font-medium text-graphite">
          If you lose this device
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-graphite-soft">
          <li>
            <span className="font-medium text-graphite">Revoke your AssemblyAI key</span>{' '}
            immediately —{' '}
            <a
              href="https://www.assemblyai.com/dashboard/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-graphite underline underline-offset-2"
            >
              dashboard
            </a>
            . Generate a new one.
          </li>
          <li>
            <span className="font-medium text-graphite">Revoke your Gemini key</span> —{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="text-graphite underline underline-offset-2"
            >
              GCP Credentials
            </a>
            . Delete the lost-device key, generate a fresh one for your replacement device.
          </li>
          <li>
            Trigger an OS-level remote wipe if you can (Find My iPhone, Android Find My Device).
            brtlb itself can't reach across to wipe data on a device that's no longer in your hands.
          </li>
          <li>
            On your replacement device, sign in to brtlb and run the wizard with your new keys.
          </li>
        </ol>
      </details>

      <div className="mt-4 rounded-md border border-graphite-soft/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-graphite">
              Delete AssemblyAI transcripts after pulling
            </p>
            <p className="mt-0.5 text-xs text-graphite-soft">
              When on, brtlb tells AssemblyAI to delete the transcript and audio from their side
              right after we receive the result. Cuts vendor retention from their default policy
              (days) to seconds. Best-effort — failures don't break the pipeline.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.deleteAssemblyAiAfterTranscription}
            onClick={handleToggleAutoDelete}
            className={
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ' +
              (settings.deleteAssemblyAiAfterTranscription ? 'bg-graphite' : 'bg-graphite-soft/30')
            }
          >
            <span
              className={
                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition ' +
                (settings.deleteAssemblyAiAfterTranscription ? 'translate-x-5' : 'translate-x-0.5')
              }
            />
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-graphite-soft/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-graphite">Clipboard hygiene</p>
            <p className="mt-0.5 text-xs text-graphite-soft">
              When you copy a note to paste into your EHR, the clipboard holds the PHI until you
              copy something else. Tap to clear it now.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearClipboard}
            className="rounded-md border border-graphite-soft/30 bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist"
          >
            Clear clipboard
          </button>
        </div>
        {clipboardStatus ? (
          <p className="mt-2 text-xs text-emerald-700">{clipboardStatus}</p>
        ) : null}
      </div>

      <details
        className="mt-3 rounded-md border border-graphite-soft/20 p-3"
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open;
          setAuditOpen(open);
          if (open) void loadAuditOnExpand();
        }}
      >
        <summary className="cursor-pointer text-sm font-medium text-graphite">
          Activity log <span className="text-graphite-soft">(this device only)</span>
        </summary>
        <p className="mt-3 pl-1 text-xs text-graphite-soft">
          Last 100 actions — timestamps and action types only. No patient identifiers, transcript
          text, or note content. Wipe All clears this log too.
        </p>
        {auditOpen && auditEntries === null ? (
          <p className="mt-3 pl-1 text-xs text-graphite-soft">Loading…</p>
        ) : null}
        {auditEntries && auditEntries.length === 0 ? (
          <p className="mt-3 pl-1 text-xs text-graphite-soft">
            No activity recorded yet. Use brtlb and check back.
          </p>
        ) : null}
        {auditEntries && auditEntries.length > 0 ? (
          <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-2 font-mono text-[11px] text-graphite-soft">
            {auditEntries.map((e, i) => (
              <li key={e.id ?? i} className="flex gap-3">
                <span className="shrink-0 text-graphite-soft/70">{formatAuditTime(e.ts)}</span>
                <span className="text-graphite">{AUDIT_LABEL[e.action] ?? e.action}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}

function ThemeToggle() {
  const theme = useAppStore((s) => s.settings.theme);
  const saveSettings = useAppStore((s) => s.saveSettings);

  const options: Array<{ key: 'system' | 'light' | 'dark'; label: string }> = [
    { key: 'system', label: 'Auto' },
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-full border border-graphite-soft/25 bg-white p-0.5 text-xs"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={theme === o.key}
          onClick={() => saveSettings({ theme: o.key })}
          className={
            'rounded-full px-3 py-1 font-medium transition ' +
            (theme === o.key ? 'bg-graphite text-white' : 'text-graphite-soft hover:text-graphite')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SupportPanel() {
  // Plain anchor on purpose. NOT the Buy Me a Coffee <script> embed —
  // that loads third-party JS on every page view and would conflict with
  // the "no third-party scripts in your data path" privacy story (and
  // would require loosening the CSP to allow cdnjs.buymeacoffee.com).
  // Click opens the BMC page in a new tab on their domain; whatever
  // tracking happens there happens in their context, not in brtlb.
  return (
    <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-graphite">Support brtlb</h2>
      <p className="mt-1 text-xs leading-relaxed text-graphite-soft">
        brtlb is built and maintained by Hobbs in his spare time. You pay AssemblyAI and Gemini
        directly for the API calls. If you find brtlb useful and want to help keep it going, a
        one-time coffee or a monthly membership is appreciated. Never expected.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href="https://buymeacoffee.com/dochobbs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-[#FFDD00] px-4 py-2 text-sm font-medium text-graphite hover:bg-[#FFE433]"
        >
          <span aria-hidden>☕</span>
          Buy me a coffee
        </a>
        <a
          href="https://buymeacoffee.com/dochobbs/membership"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-[#FFDD00] bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-[#FFFCE8]"
        >
          <span aria-hidden>💛</span>
          $5/month membership
        </a>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-graphite-soft">
        Memberships unlock zero features. The whole product stays the same whether you support or
        not — that's the point.
      </p>
    </section>
  );
}

function ChangelogPanel() {
  if (CHANGELOG.length === 0) return null;
  return (
    <details className="mb-6 rounded-xl bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-graphite">What's new</span>
        <span className="text-xs text-graphite-soft">
          Last update: {formatChangelogDate(CHANGELOG[0]?.date ?? '')}
        </span>
      </summary>
      <ol className="mt-4 space-y-5">
        {CHANGELOG.map((entry) => (
          <li key={entry.date} className="border-l-2 border-graphite-soft/20 pl-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold text-graphite">{entry.title}</h3>
              <span className="text-xs text-graphite-soft">{formatChangelogDate(entry.date)}</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-graphite-soft">
              {entry.items.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-graphite-soft/60" aria-hidden>
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}
