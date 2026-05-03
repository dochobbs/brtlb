import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { App } from './App';
import { CapabilityGate } from './components/CapabilityGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <CapabilityGate>
        <App />
      </CapabilityGate>
    </ErrorBoundary>
    {/* Vercel Analytics — cookieless page-view counter. Sees route navigation
        only; no PHI, no fingerprinting, no cross-site tracking. Privacy
        disclosure lives in Settings → Privacy & security → "What leaves
        this device". */}
    <Analytics />
  </StrictMode>,
);
