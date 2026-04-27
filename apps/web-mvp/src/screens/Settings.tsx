import { useEffect, useState } from 'react';
import { Button } from '@brtlb/ui';
import { useAppStore, type ProviderKind } from '../store';
import { KeyField } from '../components/KeyField';
import { createAnthropicProvider, createOpenAiCompatibleProvider } from '@brtlb/pipeline';

const ANTHROPIC_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'];
const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];

export function Settings() {
  const { settings, saveSettings, setView } = useAppStore();
  const [draft, setDraft] = useState(settings);
  const [testStatus, setTestStatus] = useState<null | { ok: boolean; message: string }>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
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
      const message = err instanceof Error ? err.message : 'unknown error';
      setTestStatus({ ok: false, message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
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
          <div className="mt-3 inline-flex rounded-md border border-graphite-soft/30 p-0.5">
            {(['anthropic', 'openai-compatible'] as ProviderKind[]).map((p) => (
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
                {p === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
              </button>
            ))}
          </div>
        </div>

        {draft.provider === 'anthropic' ? (
          <div className="space-y-4">
            <KeyField
              label="Anthropic API key"
              value={draft.anthropicApiKey}
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
        ) : (
          <div className="space-y-4">
            <KeyField
              label="OpenAI-compatible API key"
              value={draft.openaiApiKey}
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
      {testStatus ? (
        <p className={'mt-3 text-sm ' + (testStatus.ok ? 'text-emerald-700' : 'text-red-700')}>
          {testStatus.message}
        </p>
      ) : null}
    </main>
  );
}
