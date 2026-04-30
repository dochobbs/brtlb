import { logAudit } from './db';

/**
 * Best-effort clipboard wipe. Browsers don't expose a true "clear" API, so we
 * write a single space and then try to clear it again — which is effectively
 * a no-op for residual PHI but works in practice because subsequent paste
 * operations get the empty/whitespace string instead of the original content.
 *
 * Returns true if the write succeeded, false if the API isn't available
 * (older browsers, insecure contexts, or permission-denied iframes).
 */
export async function clearClipboard(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText('');
    void logAudit('clipboard_cleared');
    return true;
  } catch {
    // Permission denied, focus lost, or insecure context.
    return false;
  }
}
