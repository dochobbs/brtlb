import { useEffect } from 'react';
import { useAppStore } from '../store';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Watches user activity and locks the UI when the user has been idle for
 * more than `settings.idleLockMinutes`. The lock just hides PHI behind a
 * confirmation screen — it does not encrypt the underlying data. Future
 * work will add an optional passphrase that gates the actual settings
 * blob in localStorage.
 *
 * Set `idleLockMinutes` to 0 in settings to disable.
 */
export function useIdleLock(): void {
  const idleLockMinutes = useAppStore((s) => s.settings.idleLockMinutes);
  const lock = useAppStore((s) => s.lock);
  const locked = useAppStore((s) => s.locked);

  useEffect(() => {
    if (!idleLockMinutes || idleLockMinutes <= 0) return;
    if (locked) return; // already locked, no need to track activity

    let timer: number | null = null;
    const idleMs = idleLockMinutes * 60 * 1000;

    const reset = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lock();
      }, idleMs);
    };

    const onVisibility = () => {
      // Lock immediately when the tab is backgrounded for any non-trivial time.
      if (document.visibilityState === 'hidden') {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (document.visibilityState === 'hidden') lock();
        }, 30_000); // 30s grace period for quick tab-switching
      } else {
        reset();
      }
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    reset();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [idleLockMinutes, lock, locked]);
}
