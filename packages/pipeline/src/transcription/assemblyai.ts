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
const REQUEST_TIMEOUT_MS = 300_000; // 5 min per HTTP request
const TOTAL_POLL_BUDGET_MS = 30 * 60_000; // 30 min cap for transcription end-to-end

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
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
  const t = withTimeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await http(`${BASE}/upload`, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: body as BodyInit,
      signal: t.signal,
    });
  } finally {
    t.cancel();
  }
  await expectOk(res, 'upload');
  const json = (await res.json()) as { upload_url: string };
  return json.upload_url;
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
      throw new Error('AssemblyAI transcription timed out after 30 minutes');
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

  return {
    id,
    recordingId: '',
    utterances: (final.utterances ?? []).map(toUtterance),
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
  });
}
