import { useEffect, useState } from 'react';
import { Button } from '@brtlb/ui';
import { useAppStore, type ProviderKind } from '../store';
import { KeyField } from '../components/KeyField';
import { redactKeysInText } from '../lib/redact';
import { clearAll } from '../lib/db';
import {
  createAnthropicProvider,
  createGeminiApiKeyProvider,
  createOpenAiCompatibleProvider,
} from '@brtlb/pipeline';

const ANTHROPIC_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'];
const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
// Conservative starter list — known to exist as of Jan 2026. The "List my
// models" button will replace this with whatever the user's key actually has
// access to.
const GEMINI_MODELS_DEFAULT = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
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
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?key=' +
          encodeURIComponent(draft.geminiApiKey),
      );
      if (!res.ok) {
        throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };
      const ids = (json.models ?? [])
        .filter(
          (m) =>
            m.name &&
            m.name.includes('gemini') &&
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent'),
        )
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .sort();
      if (ids.length === 0) throw new Error('no gemini models with generateContent support found');
      setGeminiModels(ids);
      // Auto-select the first if the current draft model isn't in the list
      if (!ids.includes(draft.geminiModel)) {
        update('geminiModel', ids[0] ?? draft.geminiModel);
      }
    } catch (err) {
      setGeminiModelsError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setListingGeminiModels(false);
    }
  }

  async function handleSave() {
    saveSettings(draft);
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
    await clearAll();
    if (typeof localStorage !== 'undefined') localStorage.clear();
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

      <section className="space-y-6 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-graphite">Foundation model</h2>
          <p className="mt-1 text-xs text-graphite-soft">
            Pick a provider you have a Business Associate Agreement with. Keys are stored in your
            browser's localStorage and never leave this device.
          </p>
          <div className="mt-3 inline-flex flex-wrap rounded-md border border-graphite-soft/30 p-0.5">
            {(['anthropic', 'gemini-api-key', 'openai-compatible'] as ProviderKind[]).map((p) => (
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
              helperText="Get a key at aistudio.google.com. Note: AI Studio keys are NOT BAA-eligible — for PHI, use Vertex AI (BAA via Google Cloud HIPAA) once that adapter ships."
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
