import { create } from 'zustand';

export type ProviderKind = 'anthropic' | 'openai-compatible' | 'gemini-api-key';

export interface Settings {
  provider: ProviderKind;
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiModel: string;
  assemblyAiKey: string;
}

const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  openaiApiKey: '',
  openaiBaseUrl: '',
  openaiModel: 'gpt-4o',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  assemblyAiKey: '',
};

const SETTINGS_KEY = 'brtlb.settings.v1';

function safeStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== 'function') return null;
    return ls;
  } catch {
    return null;
  }
}

function loadSettings(): Settings {
  const ls = safeStorage();
  if (!ls) return DEFAULT_SETTINGS;
  const raw = ls.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: Settings): void {
  const ls = safeStorage();
  if (!ls) return;
  ls.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export type View = 'home' | 'settings' | 'record' | 'review';

interface AppState {
  settings: Settings;
  view: View;
  currentRecordingId: string | null;
  setView(view: View): void;
  selectRecording(id: string | null): void;
  saveSettings(partial: Partial<Settings>): void;
  hasRequiredKeys(): boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: loadSettings(),
  view: 'home',
  currentRecordingId: null,
  setView(view) {
    set({ view });
  },
  selectRecording(id) {
    set({ currentRecordingId: id });
  },
  saveSettings(partial) {
    const next = { ...get().settings, ...partial };
    persistSettings(next);
    set({ settings: next });
  },
  hasRequiredKeys() {
    const s = get().settings;
    if (!s.assemblyAiKey) return false;
    if (s.provider === 'anthropic') return Boolean(s.anthropicApiKey);
    if (s.provider === 'gemini-api-key') return Boolean(s.geminiApiKey);
    return Boolean(s.openaiApiKey);
  },
}));
