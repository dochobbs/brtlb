import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    // The Anthropic + OpenAI Node SDKs touch process / Buffer / events at
    // module load. Polyfill the small surface they need for browser builds.
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    // Self-signed HTTPS so the dev server is a secure context for the
    // mic API on iPhone over LAN. Accept the cert warning once on the
    // device and getUserMedia works.
    basicSsl(),
  ],
  server: { port: 5181, strictPort: true, https: true },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
});
