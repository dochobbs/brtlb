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
  const res = await http(`${BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: body as BodyInit,
  });
  await expectOk(res, 'upload');
  const json = (await res.json()) as { upload_url: string };
  return json.upload_url;
}

async function uploadAudioFromPath(
  http: typeof fetch,
  apiKey: string,
  audioPath: string,
): Promise<string> {
  const { readFile } = await import('node:fs/promises');
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

  const res = await http(`${BASE}/transcript`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
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
  for (;;) {
    const res = await http(`${BASE}/transcript/${id}`, {
      headers: { Authorization: apiKey },
    });
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
