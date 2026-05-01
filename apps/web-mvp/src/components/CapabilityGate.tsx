import type { ReactNode } from 'react';

interface MissingCapability {
  /** Short label shown to the user. */
  label: string;
  /** One-line explanation of what's missing. */
  detail: string;
}

/**
 * Detects browsers that can't run brtlb's core flow. Returns the missing
 * capabilities so we can render an explicit message instead of failing
 * opaquely deep in a recording or pipeline call.
 *
 * Runs synchronously at module load — `navigator.mediaDevices.getUserMedia`
 * is only checked for existence; the actual permission prompt happens later.
 */
function detectMissingCapabilities(): MissingCapability[] {
  const missing: MissingCapability[] = [];
  if (typeof window === 'undefined') return missing;

  if (typeof window.indexedDB === 'undefined') {
    missing.push({
      label: 'IndexedDB',
      detail:
        'brtlb stores recordings, transcripts, and notes locally in IndexedDB. Your browser blocks it (often Private/Incognito mode or a strict cookie setting).',
    });
  }

  if (typeof window.MediaRecorder === 'undefined') {
    missing.push({
      label: 'MediaRecorder',
      detail:
        'brtlb captures audio with the MediaRecorder API. Your browser is too old or has it disabled.',
    });
  }

  const md = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') {
    missing.push({
      label: 'Microphone access',
      detail:
        'brtlb needs navigator.mediaDevices.getUserMedia. This is usually missing on http:// pages — brtlb requires HTTPS.',
    });
  }

  const subtle = (window.crypto as Crypto | undefined)?.subtle;
  if (!subtle || typeof subtle.encrypt !== 'function') {
    missing.push({
      label: 'WebCrypto',
      detail:
        'brtlb uses WebCrypto (window.crypto.subtle) to encrypt API keys at rest. Your browser is missing it — usually means an outdated version or a non-HTTPS context.',
    });
  }

  return missing;
}

const MISSING = detectMissingCapabilities();

interface CapabilityGateProps {
  children: ReactNode;
}

/**
 * Renders a clear "your browser is missing X" page if any required API is
 * unavailable, instead of letting the app render and fail opaquely later.
 */
export function CapabilityGate(props: CapabilityGateProps) {
  if (MISSING.length === 0) return <>{props.children}</>;
  return (
    <div className="min-h-screen bg-mist px-4 py-12">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-graphite">
          Your browser is missing what brtlb needs.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-graphite-soft">
          brtlb runs in modern Safari, Chrome, Edge, and Firefox over HTTPS. Update your browser or
          open brtlb in a different one to continue.
        </p>
        <ul className="mt-4 space-y-3">
          {MISSING.map((m) => (
            <li key={m.label} className="rounded-md border border-graphite-soft/20 p-3">
              <div className="text-sm font-medium text-graphite">{m.label}</div>
              <div className="mt-1 text-xs leading-relaxed text-graphite-soft">{m.detail}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
