import { readFile } from 'node:fs/promises';
import type { TranscribeInput, Transcript, Utterance } from '../types';

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

async function uploadAudio(http: typeof fetch, apiKey: string, audioPath: string): Promise<string> {
  const data = await readFile(audioPath);
  const res = await http(`${BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: data,
  });
  await expectOk(res, 'upload');
  const json = (await res.json()) as { upload_url: string };
  return json.upload_url;
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

export async function transcribeWithAssemblyAi(input: TranscribeOptions): Promise<Transcript> {
  const http = input.httpClient ?? globalThis.fetch;
  const sleep = input.sleep ?? defaultSleep;
  const intervalMs = input.pollIntervalMs ?? 3000;
  const speakerLabels = input.mode === 'ambient';

  const audioUrl = await uploadAudio(http, input.config.apiKey, input.audioPath);
  const id = await requestTranscript(
    http,
    input.config.apiKey,
    audioUrl,
    speakerLabels,
    input.wordBoost,
  );
  const final = await pollTranscript(http, input.config.apiKey, id, intervalMs, sleep);

  return {
    id,
    recordingId: '',
    utterances: (final.utterances ?? []).map(toUtterance),
    createdAt: new Date().toISOString(),
  };
}
