import { useEffect, useState } from 'react';
import { Lockup, Button } from '@brtlb/ui';
import { useAppStore } from '../store';
import { listRecordings, type RecordingMeta } from '../lib/db';

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

export function Home() {
  const { setView, selectRecording, hasRequiredKeys } = useAppStore();
  const [recordings, setRecordings] = useState<RecordingMeta[] | null>(null);

  useEffect(() => {
    listRecordings()
      .then(setRecordings)
      .catch(() => setRecordings([]));
  }, []);

  function startNew(): void {
    if (!hasRequiredKeys()) {
      setView('settings');
      return;
    }
    selectRecording(null);
    setView('record');
  }

  function openRecording(id: string): void {
    selectRecording(id);
    setView('review');
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-10 flex items-center justify-between">
        <Lockup size="md" />
        <button
          type="button"
          onClick={() => setView('settings')}
          className="text-sm text-graphite-soft hover:text-graphite"
        >
          Settings
        </button>
      </header>

      <section className="mb-10 rounded-xl bg-white p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-graphite">New visit</h2>
        <p className="mt-1 text-sm text-graphite-soft">
          {hasRequiredKeys()
            ? 'Press record to start an ambient or dictation session.'
            : 'Add your AssemblyAI and foundation-model keys to begin.'}
        </p>
        <div className="mt-6">
          <Button onClick={startNew}>{hasRequiredKeys() ? 'New recording' : 'Set up keys'}</Button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-graphite-soft">
          Past recordings
        </h2>
        {recordings === null ? (
          <p className="text-sm text-graphite-soft">Loading…</p>
        ) : recordings.length === 0 ? (
          <p className="rounded-md border border-dashed border-graphite-soft/30 bg-white p-6 text-center text-sm text-graphite-soft">
            No recordings yet. Your first one will appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {recordings.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openRecording(r.id)}
                  className="flex w-full items-center justify-between rounded-md bg-white px-4 py-3 text-left shadow-sm transition hover:bg-mist"
                >
                  <div>
                    <div className="text-sm font-medium text-graphite">
                      {formatDate(r.createdAt)} · {r.mode}
                    </div>
                    <div className="text-xs text-graphite-soft">
                      {formatDuration(r.durationMs)} · {STAGE_LABEL[r.stage]}
                    </div>
                  </div>
                  <span className="text-graphite-soft">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-12 text-center text-xs text-graphite-soft">
        Less noise. Same meaning.
      </footer>
    </main>
  );
}
