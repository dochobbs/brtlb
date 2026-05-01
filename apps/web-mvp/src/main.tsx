import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
  </StrictMode>,
);
