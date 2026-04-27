import { useEffect } from 'react';
import { useAppStore } from './store';
import { purgeStaleAudio } from './lib/db';
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
