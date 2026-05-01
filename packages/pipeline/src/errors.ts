/**
 * Classify a fetch() rejection as either a network/abort error (and turn it
 * into something the user can act on) or pass it through unchanged.
 *
 * Why: when fetch() fails at the network layer (DNS, TCP reset, page
 * suspension, abort) browsers throw with messages that tell the user
 * nothing about what went wrong:
 * - iOS Safari:  TypeError "Load failed"
 * - Chrome/Edge: TypeError "Failed to fetch"
 * - Firefox:    TypeError "NetworkError when attempting to fetch resource"
 *
 * "Load failed" landing in the brtlb UI is useless — the user can't tell if
 * their key is bad, AssemblyAI is down, or their Wi-Fi dropped. Wrap these
 * at the boundary so the error has actionable next steps.
 *
 * Pass-through for: HTTP errors (already classified by per-vendor handlers
 * upstream), and anything that doesn't match the network-error fingerprint.
 */
export function classifyFetchError(vendor: string, step: string, err: unknown): Error {
  if (!(err instanceof Error)) {
    return new Error(`${vendor} ${step}: ${String(err)}`);
  }

  const msg = err.message || '';
  const name = err.name || '';

  // Abort: our own withTimeout fired, or the user navigated away. Either
  // way, "the request timed out / was cancelled" is the right framing.
  if (name === 'AbortError' || /aborted|operation was aborted/i.test(msg)) {
    return new Error(
      `${vendor} ${step}: request timed out or was cancelled. Most often this is a slow connection — try again on Wi-Fi if you're on cellular, and keep the brtlb tab open while it works.`,
    );
  }

  // Network-layer fetch failure across browsers. iOS Safari is the painful
  // one because "Load failed" is opaque and is also what fires when iOS
  // suspends the page mid-upload (returning to brtlb after switching apps,
  // locking the screen during a long upload, etc.).
  const networkLike =
    name === 'TypeError' ||
    /load failed|failed to fetch|networkerror|network request failed|connection (reset|aborted|closed)|econn/i.test(
      msg,
    );

  if (networkLike) {
    return new Error(
      `${vendor} ${step}: connection was interrupted. This usually means your Wi-Fi/cellular dropped, the brtlb tab was suspended (common on iOS when you switch apps mid-upload), or ${vendor} is briefly unavailable. Reopen brtlb on a stable connection and tap Retry from audio.`,
    );
  }

  return err;
}

/**
 * True if this error is worth retrying once with backoff. Includes network-
 * layer failures (covered by classifyFetchError) plus 5xx HTTP responses
 * upstream code may already have wrapped into an Error message.
 */
export function isRetriableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (err.name === 'TypeError' || err.name === 'AbortError') return true;
  if (/load failed|failed to fetch|networkerror|connection reset|econn|abort|timeout/i.test(msg)) {
    return true;
  }
  // Generic 5xx wrapped in our HTTP-error path (e.g., "AssemblyAI upload: 502 …")
  if (/\b5\d\d\b/.test(err.message)) return true;
  return false;
}
