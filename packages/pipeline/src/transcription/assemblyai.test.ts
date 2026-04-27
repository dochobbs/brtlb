import { describe, expect, it, vi } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcribeBlobWithAssemblyAi, transcribeWithAssemblyAi } from './assemblyai';

async function tempAudio(bytes = Buffer.from([1, 2, 3, 4])): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brtlb-assemblyai-'));
  const path = join(dir, 'sample.m4a');
  await writeFile(path, bytes);
  return path;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('transcribeWithAssemblyAi', () => {
  it('uploads audio, requests transcription with speaker_labels for ambient mode, polls until complete', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const httpClient = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });

      if (url === 'https://api.assemblyai.com/v2/upload') {
        return jsonResponse({ upload_url: 'https://cdn.assemblyai.com/uploads/abc' });
      }
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        return jsonResponse({ id: 'tr_1', status: 'queued' });
      }
      if (url === 'https://api.assemblyai.com/v2/transcript/tr_1') {
        // First poll returns processing, second returns completed
        const isFirstPoll = calls.filter((c) => c.url.endsWith('/tr_1')).length === 1;
        if (isFirstPoll) return jsonResponse({ id: 'tr_1', status: 'processing' });
        return jsonResponse({
          id: 'tr_1',
          status: 'completed',
          text: 'fever',
          utterances: [{ speaker: 'A', start: 0, end: 1500, text: 'fever', confidence: 0.92 }],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const audioPath = await tempAudio();
    const transcript = await transcribeWithAssemblyAi({
      audioPath,
      mode: 'ambient',
      config: { apiKey: 'test-key' },
      httpClient: httpClient as unknown as typeof fetch,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
    });

    expect(transcript.utterances).toEqual([
      {
        speakerId: 'A',
        role: null,
        startMs: 0,
        endMs: 1500,
        text: 'fever',
        confidence: 0.92,
      },
    ]);

    // Verify the transcribe POST body included speaker_labels=true
    const transcribePost = calls.find((c) => c.url === 'https://api.assemblyai.com/v2/transcript');
    expect(transcribePost).toBeDefined();
    const body = JSON.parse(transcribePost!.init!.body as string);
    expect(body.speaker_labels).toBe(true);
    expect(body.audio_url).toBe('https://cdn.assemblyai.com/uploads/abc');
  });

  it('sends speaker_labels=false for dictation mode', async () => {
    let transcribeBody: Record<string, unknown> | undefined;
    const httpClient = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/upload')) return jsonResponse({ upload_url: 'u' });
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        transcribeBody = JSON.parse(init.body as string);
        return jsonResponse({ id: 'tr', status: 'queued' });
      }
      return jsonResponse({
        id: 'tr',
        status: 'completed',
        text: '',
        utterances: [],
      });
    });

    await transcribeWithAssemblyAi({
      audioPath: await tempAudio(),
      mode: 'dictation',
      config: { apiKey: 'k' },
      httpClient: httpClient as unknown as typeof fetch,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
    });

    expect(transcribeBody?.speaker_labels).toBe(false);
  });

  it('throws when AssemblyAI returns status=error', async () => {
    const httpClient = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith('/upload')) return jsonResponse({ upload_url: 'u' });
      if (url === 'https://api.assemblyai.com/v2/transcript') {
        return jsonResponse({ id: 'tr', status: 'queued' });
      }
      return jsonResponse({
        id: 'tr',
        status: 'error',
        error: 'audio file is too short',
      });
    });

    await expect(
      transcribeWithAssemblyAi({
        audioPath: await tempAudio(),
        mode: 'ambient',
        config: { apiKey: 'k' },
        httpClient: httpClient as unknown as typeof fetch,
        pollIntervalMs: 1,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(/audio file is too short/);
  });

  it('throws when upload returns non-2xx', async () => {
    const httpClient = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(
      transcribeWithAssemblyAi({
        audioPath: await tempAudio(),
        mode: 'ambient',
        config: { apiKey: 'k' },
        httpClient: httpClient as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/AssemblyAI upload: 403/);
  });

  it('passes word_boost when provided', async () => {
    let transcribeBody: Record<string, unknown> | undefined;
    const httpClient = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/upload')) return jsonResponse({ upload_url: 'u' });
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        transcribeBody = JSON.parse(init.body as string);
        return jsonResponse({ id: 'tr', status: 'queued' });
      }
      return jsonResponse({ id: 'tr', status: 'completed', text: '', utterances: [] });
    });

    await transcribeWithAssemblyAi({
      audioPath: await tempAudio(),
      mode: 'ambient',
      config: { apiKey: 'k' },
      wordBoost: ['amoxicillin', 'tympanic membrane'],
      httpClient: httpClient as unknown as typeof fetch,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
    });

    expect(transcribeBody?.word_boost).toEqual(['amoxicillin', 'tympanic membrane']);
  });

  it('rejects when the audio file does not exist', async () => {
    const httpClient = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(
      transcribeWithAssemblyAi({
        audioPath: '/nonexistent/path/to/audio.m4a',
        mode: 'ambient',
        config: { apiKey: 'k' },
        httpClient: httpClient as unknown as typeof fetch,
        pollIntervalMs: 1,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow();
  });
});

describe('transcribeBlobWithAssemblyAi', () => {
  it('uploads a Blob directly without touching the filesystem', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const httpClient = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });
      if (url === 'https://api.assemblyai.com/v2/upload') {
        return jsonResponse({ upload_url: 'https://cdn.assemblyai.com/uploads/blob' });
      }
      if (url === 'https://api.assemblyai.com/v2/transcript' && init?.method === 'POST') {
        return jsonResponse({ id: 'tr_blob', status: 'queued' });
      }
      return jsonResponse({
        id: 'tr_blob',
        status: 'completed',
        text: 'hello',
        utterances: [{ speaker: 'A', start: 0, end: 500, text: 'hello', confidence: 0.95 }],
      });
    });

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });

    const transcript = await transcribeBlobWithAssemblyAi({
      audio: blob,
      mode: 'ambient',
      config: { apiKey: 'test-key' },
      httpClient: httpClient as unknown as typeof fetch,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
    });

    expect(transcript.utterances).toHaveLength(1);
    expect(transcript.utterances[0]?.text).toBe('hello');

    const uploadCall = calls.find((c) => c.url === 'https://api.assemblyai.com/v2/upload');
    expect(uploadCall?.init?.body).toBe(blob);

    const transcribeCall = calls.find(
      (c) => c.url === 'https://api.assemblyai.com/v2/transcript' && c.init?.method === 'POST',
    );
    const body = JSON.parse(transcribeCall!.init!.body as string);
    expect(body.speaker_labels).toBe(true);
    expect(body.audio_url).toBe('https://cdn.assemblyai.com/uploads/blob');
  });

  it('rejects when the upload step returns non-2xx', async () => {
    const httpClient = vi.fn(async () => new Response('over quota', { status: 402 }));
    await expect(
      transcribeBlobWithAssemblyAi({
        audio: new Blob([new Uint8Array([1, 2])]),
        mode: 'ambient',
        config: { apiKey: 'k' },
        httpClient: httpClient as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/AssemblyAI upload: 402/);
  });
});
