import { useEffect } from 'react';
import { useAppStore } from './store';
import {
  purgeStaleAudio,
  recoverInterruptedRecordings,
  recoverOrphanedRecordings,
} from './lib/db';
import { useIdleLock } from './lib/useIdleLock';
import { Home } from './screens/Home';
import { Settings } from './screens/Settings';
import { Record } from './screens/Record';
import { Review } from './screens/Review';
import { LockScreen } from './screens/LockScreen';

export function App() {
  const view = useAppStore((s) => s.view);
  const locked = useAppStore((s) => s.locked);
  const audioPurgeDays = useAppStore((s) => s.settings.audioPurgeDays);

  useIdleLock();

  // Run audio auto-purge once on app load. The DB pass is cheap; we don't
  // need to schedule it more aggressively for a session-length use.
  useEffect(() => {
    if (!audioPurgeDays || audioPurgeDays <= 0) return;
    const cutoff = new Date(Date.now() - audioPurgeDays * 86_400_000).toISOString();
    purgeStaleAudio(cutoff)
      .then((purged) => {
        if (purged.length > 0) {
          console.info(`brtlb: auto-purged audio for ${purged.length} stale recording(s)`);
        }
      })
      .catch((err) => {
        console.warn('brtlb: audio purge failed', err);
      });
  }, [audioPurgeDays]);

  // Recover any recording that was mid-pipeline when the tab last closed.
  useEffect(() => {
    recoverInterruptedRecordings()
      .then((ids) => {
        if (ids.length > 0) {
          console.info(`brtlb: recovered ${ids.length} interrupted recording(s)`);
        }
      })
      .catch((err) => {
        console.warn('brtlb: recovery scan failed', err);
      });
  }, []);

  // Recover any audio chunks that were persisted mid-recording but never
  // assembled into a full recording (tab crashed during the visit itself).
  useEffect(() => {
    recoverOrphanedRecordings()
      .then((ids) => {
        if (ids.length > 0) {
          console.info(
            `brtlb: reconstructed ${ids.length} crashed recording(s) from chunked saves`,
          );
        }
      })
      .catch((err) => {
        console.warn('brtlb: chunk recovery failed', err);
      });
  }, []);

  if (locked) return <LockScreen />;

  switch (view) {
    case 'home':
      return <Home />;
    case 'settings':
      return <Settings />;
    case 'record':
      return <Record />;
    case 'review':
      return <Review />;
    default:
      return <Home />;
  }
}
