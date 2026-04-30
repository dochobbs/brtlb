import { useState } from 'react';
import { listTemplates } from '@brtlb/prompts';
import type { CustomTemplate } from '../store';
import { useAppStore } from '../store';
import { polishTemplatePrompt } from '../lib/template-polish';
import { redactKeysInText } from '../lib/redact';

export interface CustomTemplateEditorProps {
  templates: readonly CustomTemplate[];
  onChange: (next: CustomTemplate[]) => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const BLANK_STARTER = `Describe the visit type and the note format you want, in plain English. For example:
- What kind of visit is this? (e.g., orthopedic follow-up, lactation visit, telehealth med refill)
- What sections do you want and in what order?
- What should each section contain?
- Anything you always include, anything you never want?

Then click "Polish with AI" — brtlb will turn this into a structured prompt with the same fabrication rules and consistency check the built-in templates use.

You can still edit the polished result by hand before saving.`;

const BUILTINS_FOR_CLONING = listTemplates().filter(
  // Don't offer 'dictation' as a clone source — it's mode-specific.
  (t) => t.id !== 'dictation',
);

type CloneSource = 'blank' | string; // template id

export function CustomTemplateEditor({ templates, onChange }: CustomTemplateEditorProps) {
  const settings = useAppStore((s) => s.settings);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [polishedThisSession, setPolishedThisSession] = useState(false);

  function startCreate(source: CloneSource): void {
    setEditingId('__new__');
    setPolishError(null);
    setPolishedThisSession(false);
    if (source === 'blank') {
      setDraftName('');
      setDraftBody(BLANK_STARTER);
    } else {
      const base = BUILTINS_FOR_CLONING.find((t) => t.id === source);
      if (!base) return;
      setDraftName(`${base.name} (custom)`);
      setDraftBody(base.promptBody);
    }
  }

  function startEdit(t: CustomTemplate): void {
    setEditingId(t.id);
    setDraftName(t.name);
    setDraftBody(t.promptBody);
    setPolishError(null);
    setPolishedThisSession(false);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setDraftName('');
    setDraftBody('');
    setPolishError(null);
    setPolishedThisSession(false);
  }

  function saveDraft(): void {
    const name = draftName.trim();
    const body = draftBody.trim();
    if (!name || !body) return;
    if (editingId === '__new__') {
      const next: CustomTemplate = { id: generateId(), name, promptBody: body };
      onChange([...templates, next]);
    } else if (editingId) {
      onChange(templates.map((t) => (t.id === editingId ? { ...t, name, promptBody: body } : t)));
    }
    cancelEdit();
  }

  function deleteTemplate(id: string): void {
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    onChange(templates.filter((t) => t.id !== id));
    if (editingId === id) cancelEdit();
  }

  async function handlePolish(): Promise<void> {
    setPolishing(true);
    setPolishError(null);
    try {
      const polished = await polishTemplatePrompt(draftBody, settings, draftName);
      setDraftBody(polished);
      setPolishedThisSession(true);
    } catch (err) {
      setPolishError(redactKeysInText(err instanceof Error ? err.message : String(err)));
    } finally {
      setPolishing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-graphite">Custom templates</h2>
        <p className="mt-1 text-xs text-graphite-soft">
          Built-in templates cover most peds visits. Custom templates let you describe a visit
          type we don't ship — they show up in the Review picker alongside built-ins. Best
          quality comes from <span className="font-medium">cloning a built-in</span> or using{' '}
          <span className="font-medium">"Polish with AI"</span> to rewrite a rough description in
          the brtlb house style.
        </p>
      </div>

      {templates.length === 0 ? (
        <p className="rounded-md border border-dashed border-graphite-soft/30 bg-mist p-4 text-center text-xs text-graphite-soft">
          No custom templates yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-md border border-graphite-soft/20 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-graphite">{t.name}</div>
                <div className="truncate text-xs text-graphite-soft">
                  {t.promptBody.slice(0, 120)}
                  {t.promptBody.length > 120 ? '…' : ''}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(t)}
                  className="rounded-md border border-graphite-soft/30 bg-white px-2 py-1 text-xs text-graphite hover:bg-mist"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => deleteTemplate(t.id)}
                  className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => startCreate('blank')}
            className="rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm font-medium text-graphite hover:bg-mist"
          >
            + New template
          </button>
          <span className="text-xs text-graphite-soft">or start from a built-in:</span>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                startCreate(e.target.value);
                e.target.value = '';
              }
            }}
            className="rounded-md border border-graphite-soft/30 bg-white px-2 py-1.5 text-xs text-graphite focus:border-graphite focus:outline-none"
          >
            <option value="">Clone a built-in…</option>
            {BUILTINS_FOR_CLONING.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-graphite-soft/30 bg-mist p-3">
          <label className="block">
            <span className="block text-sm font-medium text-graphite">Name</span>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Lactation visit"
              className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between">
              <span className="text-sm font-medium text-graphite">Prompt</span>
              {polishedThisSession ? (
                <span className="text-xs text-emerald-700">✓ Polished — review before saving</span>
              ) : null}
            </span>
            <textarea
              value={draftBody}
              onChange={(e) => {
                setDraftBody(e.target.value);
                if (polishedThisSession) setPolishedThisSession(false);
              }}
              rows={14}
              className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-graphite focus:border-graphite focus:outline-none"
            />
            <p className="mt-1 text-xs text-graphite-soft">
              Don't include the transcript — brtlb appends it for you. After polishing, edit any
              section you want to tweak before saving.
            </p>
          </label>

          <div className="flex flex-wrap items-center gap-2 border-t border-graphite-soft/20 pt-3">
            <button
              type="button"
              onClick={handlePolish}
              disabled={polishing || !draftBody.trim()}
              className="rounded-md bg-seafoam-pale px-3 py-2 text-sm font-medium text-graphite hover:bg-seafoam disabled:opacity-50"
              title="Sends your draft to your configured LLM and rewrites it in the brtlb house style."
            >
              {polishing ? 'Polishing…' : '✨ Polish with AI'}
            </button>
            <span className="text-xs text-graphite-soft">
              Costs &lt; $0.001 per click. Uses your existing key.
            </span>
          </div>
          {polishError ? (
            <p className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700">
              {polishError}
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={saveDraft}
              disabled={!draftName.trim() || !draftBody.trim()}
              className="rounded-md bg-graphite px-3 py-2 text-sm font-medium text-white hover:bg-graphite-soft disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm font-medium text-graphite hover:bg-mist"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
