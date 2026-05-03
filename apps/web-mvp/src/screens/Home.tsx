import { useEffect, useMemo, useState } from 'react';
import { DotsMark, Lockup } from '@brtlb/ui';
import { useAppStore } from '../store';
import { useRecorderStore } from '../lib/recorder-store';
import { deleteRecording, listRecordings, logAudit, type RecordingMeta } from '../lib/db';
import { ConfirmDialog } from '../components/ConfirmDialog';

const TAGLINES = [
  'Less noise. Same meaning.',
  'Pediatric documentation, compressed.',
  'Chart less. Notice more.',
];

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfWeek(d: Date): number {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Treat Monday as start of week (most clinics' rhythm). Adjust later if needed.
  const dow = day.getDay();
  const diff = (dow + 6) % 7;
  day.setDate(day.getDate() - diff);
  return day.getTime();
}

function getGreeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Working late.';
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  return 'Good evening.';
}

const STAGE_LABEL: Record<RecordingMeta['stage'], string> = {
  recording: 'Recording',
  recorded: 'Recorded',
  uploading: 'Uploading',
  transcribing: 'Transcribing',
  generating: 'Generating',
  ready_for_review: 'Ready',
  failed: 'Failed',
};

const STAGE_TONE: Record<RecordingMeta['stage'], string> = {
  recording: 'bg-seafoam-pale text-graphite',
  recorded: 'bg-mist text-graphite-soft',
  uploading: 'bg-seafoam-pale text-graphite',
  transcribing: 'bg-seafoam-pale text-graphite',
  generating: 'bg-seafoam-pale text-graphite',
  ready_for_review: 'bg-seafoam text-graphite',
  failed: 'bg-red-100 text-red-800',
};

interface RecordingGroup {
  label: string;
  items: RecordingMeta[];
}

function groupRecordings(recordings: RecordingMeta[], now: Date): RecordingGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = startOfWeek(now);
  const today: RecordingMeta[] = [];
  const yesterday: RecordingMeta[] = [];
  const thisWeek: RecordingMeta[] = [];
  const earlier: RecordingMeta[] = [];
  for (const r of recordings) {
    const t = new Date(r.createdAt).getTime();
    if (t >= todayStart) today.push(r);
    else if (t >= yesterdayStart) yesterday.push(r);
    else if (t >= weekStart) thisWeek.push(r);
    else earlier.push(r);
  }
  const groups: RecordingGroup[] = [];
  if (today.length) groups.push({ label: 'Today', items: today });
  if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday });
  if (thisWeek.length) groups.push({ label: 'Earlier this week', items: thisWeek });
  if (earlier.length) groups.push({ label: 'Earlier', items: earlier });
  return groups;
}

export function Home() {
  const { setView, selectRecording, hasRequiredKeys } = useAppStore();
  const startRecording = useRecorderStore((s) => s.start);
  const [recordings, setRecordings] = useState<RecordingMeta[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecordingMeta | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'failed' | 'in_progress'>(
    'all',
  );

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteRecording(id);
    void logAudit('note_deleted', { recordingId: id });
    setRecordings((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
  }
  const now = useMemo(() => new Date(), []);
  const tagline = useMemo(() => {
    // Stable across the day so the page doesn't feel chatty mid-session.
    const idx = Math.floor(now.getTime() / (1000 * 60 * 60 * 4)) % TAGLINES.length;
    return TAGLINES[idx];
  }, [now]);

  useEffect(() => {
    listRecordings()
      .then(setRecordings)
      .catch(() => setRecordings([]));
  }, []);

  async function startNew(mode: 'ambient' | 'dictation'): Promise<void> {
    if (!hasRequiredKeys()) {
      setView('settings');
      return;
    }
    setStarting(true);
    try {
      // Kick off the mic permission + MediaRecorder before navigating so the
      // browser treats it as part of the user gesture from this click.
      await startRecording(mode);
    } finally {
      selectRecording(null);
      setView('record');
      setStarting(false);
    }
  }

  function openRecording(id: string): void {
    selectRecording(id);
    setView('review');
  }

  const filteredRecordings = useMemo(() => {
    if (!recordings) return null;
    const q = query.trim().toLowerCase();
    return recordings.filter((r) => {
      // Status filter
      if (statusFilter === 'ready' && r.stage !== 'ready_for_review') return false;
      if (statusFilter === 'failed' && r.stage !== 'failed') return false;
      if (
        statusFilter === 'in_progress' &&
        r.stage !== 'recording' &&
        r.stage !== 'recorded' &&
        r.stage !== 'uploading' &&
        r.stage !== 'transcribing' &&
        r.stage !== 'generating'
      )
        return false;
      // Text search across label + transcript + note. PHI search is local
      // only — never leaves the device.
      if (!q) return true;
      const haystack = [r.label ?? '', r.transcriptText ?? '', r.noteMarkdown ?? '']
        .join('\n')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [recordings, query, statusFilter]);

  const groups = useMemo(
    () => (filteredRecordings ? groupRecordings(filteredRecordings, now) : []),
    [filteredRecordings, now],
  );

  const todayCount = groups.find((g) => g.label === 'Today')?.items.length ?? 0;
  const todayMinutes = Math.round(
    (groups.find((g) => g.label === 'Today')?.items.reduce((a, r) => a + r.durationMs, 0) ?? 0) /
      60_000,
  );
  const totalCount = recordings?.length ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between sm:mb-8">
        <Lockup size="md" />
        <div className="flex items-center gap-1">
          <a
            href="https://github.com/dochobbs/brtlb/blob/main/docs/USING_BRTLB.md"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-3 py-2 text-sm text-graphite-soft hover:text-graphite"
          >
            Guide
          </a>
          <button
            type="button"
            onClick={() => setView('settings')}
            className="rounded-md px-3 py-2 text-sm text-graphite-soft hover:text-graphite"
          >
            Settings
          </button>
        </div>
      </header>

      <section className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-graphite sm:text-3xl">
          {getGreeting(now)}
        </h1>
        {hasRequiredKeys() && totalCount > 0 ? (
          <p className="mt-1 text-sm text-graphite-soft">
            {todayCount > 0
              ? `${todayCount} ${todayCount === 1 ? 'visit' : 'visits'} today · ${todayMinutes} min recorded`
              : `${totalCount} ${totalCount === 1 ? 'recording' : 'recordings'} on file. Ready when you are.`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-graphite-soft">{tagline}</p>
        )}
      </section>

      <section className="mb-8 overflow-hidden rounded-2xl bg-graphite text-white shadow-sm sm:mb-10">
        <div className="flex flex-col items-center gap-4 px-6 py-10 text-center sm:px-10 sm:py-14">
          <DotsMark size={48} color="#A8E6CF" className="opacity-90" />
          <h2 className="text-xl font-semibold sm:text-2xl">
            {hasRequiredKeys() ? 'Start a visit' : 'Set up your keys'}
          </h2>
          <p className="max-w-md text-sm text-white/70">
            {hasRequiredKeys()
              ? 'Record an ambient encounter or dictate directly. Diarized transcripts and SOAP-ready notes in seconds.'
              : 'Add your AssemblyAI key plus your Anthropic, Gemini, or OpenAI key. Everything is stored on this device — keys and notes never leave it.'}
          </p>
          <button
            type="button"
            onClick={() => startNew('ambient')}
            disabled={starting}
            className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-full bg-white px-6 py-2 text-sm font-semibold text-graphite shadow-sm transition hover:bg-seafoam-pale active:scale-95 disabled:opacity-70"
          >
            {hasRequiredKeys() ? (starting ? 'Starting…' : 'Record visit') : 'Set up keys'}
          </button>
          {hasRequiredKeys() ? (
            <button
              type="button"
              onClick={() => startNew('dictation')}
              disabled={starting}
              className="text-xs text-white/60 underline-offset-4 hover:text-white hover:underline disabled:opacity-70"
            >
              or dictate instead
            </button>
          ) : null}
        </div>
      </section>

      <section>
        {recordings && recordings.length >= 4 ? (
          <div className="mb-4 space-y-2">
            <div className="relative">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search labels, transcripts, notes…"
                className="w-full rounded-md border border-graphite-soft/30 bg-white px-3 py-2 pr-9 text-sm text-graphite focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite"
                autoComplete="off"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-graphite-soft hover:text-graphite"
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {(
                [
                  ['all', 'All'],
                  ['ready', 'Ready'],
                  ['in_progress', 'In progress'],
                  ['failed', 'Failed'],
                ] as const
              ).map(([key, label]) => {
                const count =
                  key === 'all'
                    ? recordings.length
                    : recordings.filter((r) => {
                        if (key === 'ready') return r.stage === 'ready_for_review';
                        if (key === 'failed') return r.stage === 'failed';
                        return [
                          'recording',
                          'recorded',
                          'uploading',
                          'transcribing',
                          'generating',
                        ].includes(r.stage);
                      }).length;
                if (count === 0 && key !== 'all') return null;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={
                      'rounded-full border px-2.5 py-1 font-medium transition ' +
                      (statusFilter === key
                        ? 'border-graphite bg-graphite text-white'
                        : 'border-graphite-soft/30 bg-white text-graphite-soft hover:text-graphite')
                    }
                  >
                    {label} <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
            {(query || statusFilter !== 'all') && filteredRecordings ? (
              <p className="text-[11px] text-graphite-soft">
                Showing {filteredRecordings.length} of {recordings.length}
              </p>
            ) : null}
          </div>
        ) : null}

        {recordings === null ? (
          <p className="text-sm text-graphite-soft">Loading…</p>
        ) : recordings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-graphite-soft/30 bg-white p-8 text-center">
            <DotsMark size={32} className="mx-auto opacity-50" />
            <p className="mt-3 text-sm text-graphite-soft">
              No recordings yet. Your first one will appear here.
            </p>
          </div>
        ) : filteredRecordings && filteredRecordings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-graphite-soft/30 bg-white p-6 text-center">
            <p className="text-sm text-graphite-soft">No recordings match.</p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setStatusFilter('all');
              }}
              className="mt-2 text-xs text-graphite underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-graphite-soft">
                  {group.label}
                </h3>
                <ul className="space-y-2">
                  {group.items.map((r) => (
                    <li
                      key={r.id}
                      className="group flex items-stretch gap-1 rounded-xl bg-white shadow-sm transition hover:bg-mist focus-within:bg-mist"
                    >
                      <button
                        type="button"
                        onClick={() => openRecording(r.id)}
                        className="flex flex-1 items-center justify-between gap-3 rounded-l-xl px-4 py-3 text-left transition active:scale-[0.99] sm:px-5 sm:py-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-graphite sm:text-base">
                            {r.label || `${r.mode === 'ambient' ? 'Ambient visit' : 'Dictation'}`}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-graphite-soft">
                            <span
                              className={
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ' +
                                STAGE_TONE[r.stage]
                              }
                            >
                              {STAGE_LABEL[r.stage]}
                            </span>
                            <span>{formatTimeOfDay(r.createdAt)}</span>
                            <span aria-hidden>·</span>
                            <span>{r.mode}</span>
                            <span aria-hidden>·</span>
                            <span>{formatDuration(r.durationMs)}</span>
                            {group.label !== 'Today' ? (
                              <>
                                <span aria-hidden>·</span>
                                <span>{formatDateOnly(r.createdAt)}</span>
                              </>
                            ) : null}
                            {r.audioPurgedAt ? (
                              <span className="inline-flex items-center rounded-full bg-mist px-2 py-0.5 text-[10px] uppercase tracking-wide text-graphite-soft">
                                Audio purged
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 text-graphite-soft">›</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(r);
                        }}
                        aria-label={`Delete ${r.label || 'recording'}`}
                        title="Delete this recording"
                        className="flex w-10 shrink-0 items-center justify-center rounded-r-xl text-graphite-soft transition hover:bg-red-50 hover:text-red-700 sm:w-12"
                      >
                        <span aria-hidden className="text-base">
                          ×
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-16 pb-8 text-center text-xs text-graphite-soft">
        <p>{tagline}</p>
        <p className="mt-2 italic">the Scrivener</p>
        <p className="italic">&ldquo;I would prefer not to&hellip; chart after hours.&rdquo;</p>
        <p className="mt-4">
          <a
            href="https://buymeacoffee.com/dochobbs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-graphite-soft/80 hover:text-graphite"
          >
            <span aria-hidden>☕</span>
            <span>Buy Dr. Hobbs a coffee</span>
          </a>
        </p>
      </footer>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this recording?"
        message={
          pendingDelete?.label
            ? `"${pendingDelete.label}" — audio, transcript, and note will be permanently removed from this device. There is no undo.`
            : 'Audio, transcript, and note will be permanently removed from this device. There is no undo.'
        }
        tone="danger"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
