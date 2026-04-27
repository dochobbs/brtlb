// Re-export react-markdown's defaults wrapped in our chosen plugins. We
// keep this in a dedicated module so future Phase-4 work (Capacitor) can
// swap implementations without touching the screens.
export { default as Markdown } from 'react-markdown';
export { default as remarkGfm } from 'remark-gfm';
