import { Lockup } from '@brtlb/ui';

export function App() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-8 p-6 bg-white">
      <Lockup size="xl" />
      <div className="text-center space-y-2">
        <p className="text-graphite text-lg">Less noise. Same meaning.</p>
        <p className="text-graphite-soft text-sm">Pediatric documentation, compressed.</p>
      </div>
    </main>
  );
}
