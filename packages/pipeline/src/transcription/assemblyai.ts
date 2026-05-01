import type {
  AssemblyAiConfig,
  RecordingMode,
  TranscribeInput,
  Transcript,
  Utterance,
} from '../types';

interface AssemblyAiUtterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
  confidence: number;
}

interface AssemblyAiTranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  error?: string;
  utterances?: AssemblyAiUtterance[];
}

const BASE = 'https://api.assemblyai.com/v2';

// Per-request timeouts. Upload + transcript-create are short calls; the
// long-running work happens in the polling loop, which has its own
// overall budget.
//
// AssemblyAI's Best model processes at roughly 10-20× real-time, so a
// 60-min visit finishes in ~3-5 min, a 90-min autism eval in ~5-8 min,
// even a 3-hour evaluation in ~10-15 min. The 90-min cap below is purely
// a safety net for stuck/lost jobs — successful transcriptions return
// as soon as AssemblyAI is done regardless of cap.
const REQUEST_TIMEOUT_MS = 300_000; // 5 min per HTTP request (default for short calls)
const TOTAL_POLL_BUDGET_MS = 90 * 60_000; // 90 min safety net for stuck jobs

/**
 * Per-MB upload budget for slow connections. A 90-min recording at 32 kbps
 * is ~22 MB. On a 256 Kbps uplink (rural / weak hotspot / congested clinic
 * WiFi), 22 MB takes ~12 min — exceeding a fixed 5-min cap. So we scale the
 * upload timeout to file size: max(REQUEST_TIMEOUT_MS, 30 sec/MB).
 */
const UPLOAD_TIMEOUT_PER_MB_MS = 30_000; // 30 sec per MB
/** Single retry attempt for transient upload failures. */
const UPLOAD_RETRY_ATTEMPTS = 2;

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function uploadTimeoutFor(body: UploadBody): number {
  const bytes =
    body instanceof Blob
      ? body.size
      : body instanceof ArrayBuffer
        ? body.byteLength
        : body instanceof Uint8Array
          ? body.byteLength
          : (body as Buffer).length ?? 0;
  const mb = bytes / (1024 * 1024);
  const sized = Math.ceil(mb * UPLOAD_TIMEOUT_PER_MB_MS);
  return Math.max(REQUEST_TIMEOUT_MS, sized);
}

function isRetriableUploadError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Network blips, aborts (timeout), 5xx server errors. NOT 4xx — those
    // mean a real config issue (bad key, bad request) that won't change
    // on retry.
    if (/network|fetch failed|connection reset|econn|abort|timeout/i.test(msg)) return true;
    if (/^assemblyai upload: 5\d\d/.test(err.message)) return true;
  }
  return false;
}

export interface TranscribeOptions extends TranscribeInput {
  /** Polling interval between status checks. Default 3000 ms. */
  pollIntervalMs?: number;
  /** Injectable for tests. Default: setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Override clock (used only for diagnostics, not flow control). */
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function expectOk(res: Response, step: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`AssemblyAI ${step}: ${res.status} ${body}`);
}

type UploadBody = Blob | ArrayBuffer | Uint8Array | Buffer;

async function uploadAudioBody(
  http: typeof fetch,
  apiKey: string,
  body: UploadBody,
): Promise<string> {
  const timeoutMs = uploadTimeoutFor(body);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
    const t = withTimeout(timeoutMs);
    try {
      const res = await http(`${BASE}/upload`, {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/octet-stream',
        },
        body: body as BodyInit,
        signal: t.signal,
      });
      t.cancel();
      await expectOk(res, 'upload');
      const json = (await res.json()) as { upload_url: string };
      return json.upload_url;
    } catch (err) {
      t.cancel();
      lastErr = err;
      if (attempt < UPLOAD_RETRY_ATTEMPTS && isRetriableUploadError(err)) {
        // Exponential-ish backoff: 1.5s on first retry. Single retry is
        // usually enough — sustained outages aren't going to clear in 1.5s
        // anyway. Surface the error to the user after the retry.
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  // Unreachable, but TS wants it.
  throw lastErr instanceof Error ? lastErr : new Error('upload failed');
}

async function uploadAudioFromPath(
  http: typeof fetch,
  apiKey: string,
  audioPath: string,
): Promise<string> {
  // The dynamic specifier hides node:fs/promises from bundler import analyzers
  // (Vite, esbuild) so this file stays browser-safe. Real Node callers still
  // resolve it at runtime.
  const moduleId = 'node:fs/promises';
  const { readFile } = (await import(
    /* @vite-ignore */ moduleId
  )) as typeof import('node:fs/promises');
  const data = await readFile(audioPath);
  return uploadAudioBody(http, apiKey, data);
}

async function requestTranscript(
  http: typeof fetch,
  apiKey: string,
  audioUrl: string,
  speakerLabels: boolean,
  wordBoost?: string[],
): Promise<string> {
  const body: Record<string, unknown> = {
    audio_url: audioUrl,
    speaker_labels: speakerLabels,
    // AssemblyAI's 2026 API rev requires speech_models explicitly.
    // universal-3-pro is the current flagship; universal-2 is the
    // prior-gen fallback. Listing both lets AssemblyAI fall back if
    // pro is unavailable for some reason.
    speech_models: ['universal-3-pro', 'universal-2'],
  };
  if (wordBoost && wordBoost.length > 0) body.word_boost = wordBoost;

  const t = withTimeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await http(`${BASE}/transcript`, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: t.signal,
    });
  } finally {
    t.cancel();
  }
  await expectOk(res, 'request');
  const json = (await res.json()) as AssemblyAiTranscriptResponse;
  return json.id;
}

/**
 * Best-effort DELETE on a completed transcript. AssemblyAI honors this by
 * removing the transcript record (and the uploaded audio) from their side.
 * Cuts vendor retention from days to seconds. Failures are swallowed —
 * deletion is privacy-positive but never load-bearing for the pipeline.
 */
async function deleteTranscriptOnVendor(
  http: typeof fetch,
  apiKey: string,
  id: string,
): Promise<void> {
  try {
    const t = withTimeout(REQUEST_TIMEOUT_MS);
    try {
      await http(`${BASE}/transcript/${id}`, {
        method: 'DELETE',
        headers: { Authorization: apiKey },
        signal: t.signal,
      });
    } finally {
      t.cancel();
    }
  } catch {
    // best-effort; log nothing in production to avoid noise
  }
}

async function pollTranscript(
  http: typeof fetch,
  apiKey: string,
  id: string,
  intervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<AssemblyAiTranscriptResponse> {
  // Hard upper bound on total time spent waiting for a transcript so a
  // stuck job doesn't leave the UI on "Transcribing…" forever.
  const deadline = Date.now() + TOTAL_POLL_BUDGET_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('AssemblyAI transcription timed out after 90 minutes');
    }
    const t = withTimeout(REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await http(`${BASE}/transcript/${id}`, {
        headers: { Authorization: apiKey },
        signal: t.signal,
      });
    } finally {
      t.cancel();
    }
    await expectOk(res, 'poll');
    const json = (await res.json()) as AssemblyAiTranscriptResponse;
    if (json.status === 'completed') return json;
    if (json.status === 'error') {
      throw new Error(`AssemblyAI transcription failed: ${json.error ?? 'unknown error'}`);
    }
    await sleep(intervalMs);
  }
}

function toUtterance(u: AssemblyAiUtterance): Utterance {
  return {
    speakerId: u.speaker,
    role: null,
    startMs: u.start,
    endMs: u.end,
    text: u.text,
    confidence: u.confidence,
  };
}

async function runTranscription(
  audioUrl: string,
  options: {
    http: typeof fetch;
    apiKey: string;
    mode: RecordingMode;
    wordBoost?: string[];
    intervalMs: number;
    sleep: (ms: number) => Promise<void>;
    deleteOnCompletion?: boolean;
  },
): Promise<Transcript> {
  const speakerLabels = options.mode === 'ambient';
  const id = await requestTranscript(
    options.http,
    options.apiKey,
    audioUrl,
    speakerLabels,
    options.wordBoost,
  );
  const final = await pollTranscript(
    options.http,
    options.apiKey,
    id,
    options.intervalMs,
    options.sleep,
  );

  // Dictation mode (speaker_labels: false) returns `text` but no `utterances`
  // array. Without this fallback we'd hand the LLM an empty transcript and
  // produce a useless note. Synthesize a single utterance from the full text
  // so downstream consumers see one continuous "Speaker A" turn from the
  // physician — which is exactly what dictation is.
  let utterances = (final.utterances ?? []).map(toUtterance);
  if (utterances.length === 0 && final.text && final.text.trim().length > 0) {
    utterances = [
      {
        speakerId: 'A',
        role: options.mode === 'dictation' ? 'provider' : null,
        startMs: 0,
        endMs: 0,
        text: final.text,
        confidence: 1,
      },
    ];
  }

  // Privacy-positive auto-delete after we've successfully pulled the
  // transcript content. Fire-and-forget — we already have what we need.
  if (options.deleteOnCompletion) {
    void deleteTranscriptOnVendor(options.http, options.apiKey, id);
  }

  return {
    id,
    recordingId: '',
    utterances,
    createdAt: new Date().toISOString(),
  };
}

export async function transcribeWithAssemblyAi(input: TranscribeOptions): Promise<Transcript> {
  const http = input.httpClient ?? globalThis.fetch;
  const sleep = input.sleep ?? defaultSleep;
  const intervalMs = input.pollIntervalMs ?? 3000;

  const audioUrl = await uploadAudioFromPath(http, input.config.apiKey, input.audioPath);
  return runTranscription(audioUrl, {
    http,
    apiKey: input.config.apiKey,
    mode: input.mode,
    wordBoost: input.wordBoost,
    intervalMs,
    sleep,
    deleteOnCompletion: input.config.deleteOnCompletion,
  });
}

export interface TranscribeBlobOptions {
  audio: UploadBody;
  mode: RecordingMode;
  config: AssemblyAiConfig;
  wordBoost?: string[];
  httpClient?: typeof fetch;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function transcribeBlobWithAssemblyAi(
  input: TranscribeBlobOptions,
): Promise<Transcript> {
  const http = input.httpClient ?? globalThis.fetch;
  const sleep = input.sleep ?? defaultSleep;
  const intervalMs = input.pollIntervalMs ?? 3000;

  const audioUrl = await uploadAudioBody(http, input.config.apiKey, input.audio);
  return runTranscription(audioUrl, {
    http,
    apiKey: input.config.apiKey,
    mode: input.mode,
    wordBoost: input.wordBoost,
    intervalMs,
    sleep,
    deleteOnCompletion: input.config.deleteOnCompletion,
  });
}
