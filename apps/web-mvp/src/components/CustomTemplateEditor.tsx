import { useState } from 'react';
import type { CustomTemplate } from '../store';

export interface CustomTemplateEditorProps {
  templates: readonly CustomTemplate[];
  onChange: (next: CustomTemplate[]) => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const STARTER_PROMPT = `You are an expert pediatric medical scribe. Generate a clinical note from the diarized transcript below.

Describe what you want here, e.g.:
- Sections you want and what each should contain
- Format preferences (bullets vs prose, numbered vs not)
- Any phrases or boilerplate you always include
- Any phrases you never want

DOCUMENTATION PRINCIPLES:
1. Document only what was actually discussed or observed.
2. Prefer omission over fabrication.
3. Never invent vitals, exam findings, durations, or doses not stated.
`;

export function CustomTemplateEditor({ templates, onChange }: CustomTemplateEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftBody, setDraftBody] = useState('');

  function startCreate(): void {
    setEditingId('__new__');
    setDraftName('');
    setDraftBody(STARTER_PROMPT);
  }

  function startEdit(t: CustomTemplate): void {
    setEditingId(t.id);
    setDraftName(t.name);
    setDraftBody(t.promptBody);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setDraftName('');
    setDraftBody('');
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-graphite">Custom templates</h2>
        <p className="mt-1 text-xs text-graphite-soft">
          Describe your own note format in plain English (or paste a known-good prompt). Saved
          templates show up in the Review picker alongside the built-in ones.
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
        <button
          type="button"
          onClick={startCreate}
          className="rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm font-medium text-graphite hover:bg-mist"
        >
          + New template
        </button>
      ) : (
        <div className="space-y-3 rounded-md border border-graphite-soft/30 bg-mist p-3">
          <label className="block">
            <span className="block text-sm font-medium text-graphite">Name</span>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Quick well-child"
              className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm text-graphite focus:border-graphite focus:outline-none"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-graphite">Prompt</span>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={12}
              className="mt-1 w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-graphite focus:border-graphite focus:outline-none"
            />
            <p className="mt-1 text-xs text-graphite-soft">
              Plain text instructions to the model. Don't include the transcript — brtlb appends it
              for you.
            </p>
          </label>
          <div className="flex gap-2">
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
