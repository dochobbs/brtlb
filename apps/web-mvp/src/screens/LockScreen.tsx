import { Button, Lockup } from '@brtlb/ui';
import { useAppStore } from '../store';

export function LockScreen() {
  const unlock = useAppStore((s) => s.unlock);
  return (
    <main className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-graphite text-white">
      <Lockup size="xl" dotColor="#A8E6CF" className="[&_span]:text-white" />
      <p className="max-w-md text-center text-sm text-white/70">
        Locked for privacy. Tap to continue. The form, transcripts, and notes are hidden until you
        confirm you're at the device.
      </p>
      <Button onClick={unlock}>I'm here</Button>
    </main>
  );
}
