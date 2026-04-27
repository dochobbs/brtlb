import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    // The Anthropic + OpenAI Node SDKs touch process / Buffer / events at
    // module load. Polyfill the small surface they need for browser builds.
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  server: { port: 5181, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
});
