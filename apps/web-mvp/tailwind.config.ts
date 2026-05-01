import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CSS-variable-backed so the same Tailwind class flips automatically
        // when the `dark` class is on <html>. Variables are defined in
        // src/index.css for both light and dark modes.
        graphite: 'var(--brtlb-graphite)',
        'graphite-soft': 'var(--brtlb-graphite-soft)',
        seafoam: 'var(--brtlb-seafoam)',
        'seafoam-pale': 'var(--brtlb-seafoam-pale)',
        mist: 'var(--brtlb-mist)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
