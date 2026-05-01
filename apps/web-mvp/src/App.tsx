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
import { Wizard } from './screens/Wizard';

export function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const locked = useAppStore((s) => s.locked);
  const audioPurgeDays = useAppStore((s) => s.settings.audioPurgeDays);
  const wizardCompletedV1 = useAppStore((s) => s.settings.wizardCompletedV1);
  const hasRequiredKeys = useAppStore((s) => s.hasRequiredKeys);
  const theme = useAppStore((s) => s.settings.theme);

  useIdleLock();

  // Apply the user's theme preference to <html>. 'system' follows the OS
  // via prefers-color-scheme; 'light' / 'dark' force the choice. We use
  // a class on the document element so Tailwind's `dark:` variant fires
  // and the CSS variable swap in index.css takes effect everywhere.
  useEffect(() => {
    const root = document.documentElement;
    function applyTheme() {
      const dark =
        theme === 'dark' ||
        (theme === 'system' &&
          window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', dark);
    }
    applyTheme();
    if (theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [theme]);

  // First-run auto-launch: if the user has never finished the wizard AND has
  // no keys yet, drop them into the wizard. Returning users with keys see
  // their normal home screen.
  useEffect(() => {
    if (!wizardCompletedV1 && !hasRequiredKeys() && view === 'home') {
      setView('wizard');
    }
    // Only run on initial mount — re-running on every view change would
    // trap the user in the wizard when they "skip for now".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    case 'wizard':
      return <Wizard />;
    default:
      return <Home />;
  }
}
