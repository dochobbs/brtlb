import { Button } from '@brtlb/ui';

export function App() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-4xl font-semibold tracking-tight">brtlb</h1>
      <p className="text-slate-600">Pediatric AI scribe — coming soon.</p>
      <Button onClick={() => console.log('hello brtlb')}>Test Button</Button>
    </main>
  );
}
