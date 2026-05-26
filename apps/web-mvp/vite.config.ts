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
    // Vite's SPA fallback would serve index.html for /docs/ in dev,
    // which makes the marketing-page Docs link silently land on the
    // landing route. Production Vercel routes /docs/* to public/docs/*
    // correctly; this middleware mirrors that behavior in dev.
    {
      name: 'serve-docs-dir-index',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (!req.url) return next();
          const path = req.url.split('?')[0];
          if (path === '/docs' || path === '/docs/') {
            req.url = '/docs/index.html';
          }
          next();
        });
      },
    },
  ],
  server: { port: 5181, strictPort: true, https: true },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
});
