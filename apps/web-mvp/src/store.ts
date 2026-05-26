import { create } from 'zustand';
import { useRecorderStore } from './lib/recorder-store';

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
  /** Audio retention in days. 0 = never purge automatically. */
  audioPurgeDays: number;
  /** Auto-lock the UI after this many minutes of inactivity. 0 = disabled. */
  idleLockMinutes: number;
  /** User-authored note templates / instructions (saved across sessions). */
  customTemplates: CustomTemplate[];
  /** Set true once the user has finished (or explicitly skipped) the onboarding wizard. */
  wizardCompletedV1: boolean;
  /** Set true once the user dismisses the Home-screen setup checklist. The
   * checklist also hides automatically once every step is done — this flag
   * is for users who'd rather see the bare Home view even while incomplete. */
  setupChecklistDismissed?: boolean;
  /**
   * If true, brtlb fires DELETE on the AssemblyAI transcript right after
   * pulling the result. Cuts vendor retention from days to seconds. Default
   * true — privacy-positive, no functional cost since we keep the transcript
   * locally anyway.
   */
  deleteAssemblyAiAfterTranscription: boolean;
  /**
   * Color theme. 'system' follows the OS preference via prefers-color-scheme.
   * 'light' / 'dark' force the choice regardless of OS. Default 'system'.
   */
  theme: 'system' | 'light' | 'dark';
}

export interface CustomTemplate {
  id: string;
  name: string;
  description?: string;
  promptBody: string;
}

const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini-api-key',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  openaiApiKey: '',
  openaiBaseUrl: '',
  openaiModel: 'gpt-4o',
  geminiApiKey: '',
  geminiModel: 'gemini-3-pro-preview',
  assemblyAiKey: '',
  audioPurgeDays: 7,
  idleLockMinutes: 5,
  customTemplates: [],
  wizardCompletedV1: false,
  setupChecklistDismissed: false,
  deleteAssemblyAiAfterTranscription: true,
  theme: 'system',
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
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Anthropic is removed from the picker for now (BAA orgs hit CORS).
    // Migrate anyone with that selection to Gemini so they don't get stuck.
    if (merged.provider === 'anthropic') merged.provider = 'gemini-api-key';
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Returns null on success, an error message string on failure.
 * Failures we've seen on iOS Safari:
 * - Private browsing (setItem throws QuotaExceededError despite the
 *   API being present)
 * - "Block All Cookies" in Settings → Safari (silently denies storage)
 * - PWA standalone storage container isolated from Safari proper —
 *   keys saved in one mode aren't visible from the other
 * - ITP wipes localStorage after 7 days of no first-party interaction
 */
function persistSettings(settings: Settings): string | null {
  const ls = safeStorage();
  if (!ls) return 'Browser storage is not available (private mode? cookies blocked?).';
  try {
    ls.setItem(SETTINGS_KEY, JSON.stringify(settings));
    // Roundtrip check — some iOS modes silently no-op the write.
    const probe = ls.getItem(SETTINGS_KEY);
    if (!probe) {
      return 'Browser storage rejected the write silently. Disable Private Browsing / "Block All Cookies" and try again.';
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Couldn't save: ${msg}`;
  }
}

export type View = 'landing' | 'home' | 'settings' | 'record' | 'review' | 'wizard';

/**
 * Compute the initial view synchronously, before React first renders. Avoids
 * the home→landing flash that happens when we wait for App's useEffect to
 * decide. Mirrors the gating logic in App.tsx — keep them in sync.
 */
function computeInitialView(settings: Settings): View {
  if (typeof window === 'undefined') return 'home';
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/wizard') return 'wizard';
  if (path === '/settings') return 'settings';
  if (path === '/record') return 'record';
  if (path === '/review') return 'review';

  const hasNoteKey =
    (settings.provider === 'anthropic' && Boolean(settings.anthropicApiKey)) ||
    (settings.provider === 'gemini-api-key' && Boolean(settings.geminiApiKey)) ||
    (settings.provider === 'openai-compatible' && Boolean(settings.openaiApiKey));
  const hasKeys = Boolean(settings.assemblyAiKey) && hasNoteKey;
  if (settings.wizardCompletedV1 || hasKeys) return 'home';

  const standalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? 'wizard' : 'landing';
}

interface AppState {
  settings: Settings;
  view: View;
  currentRecordingId: string | null;
  locked: boolean;
  setView(view: View): void;
  selectRecording(id: string | null): void;
  /** Returns null on success, an error string if the storage layer rejected the write. */
  saveSettings(partial: Partial<Settings>): string | null;
  hasRequiredKeys(): boolean;
  lock(): void;
  unlock(): void;
}

const INITIAL_SETTINGS = loadSettings();

export const useAppStore = create<AppState>((set, get) => ({
  settings: INITIAL_SETTINGS,
  view: computeInitialView(INITIAL_SETTINGS),
  currentRecordingId: null,
  locked: false,
  setView(view) {
    set({ view });
  },
  selectRecording(id) {
    set({ currentRecordingId: id });
  },
  saveSettings(partial) {
    const next = { ...get().settings, ...partial };
    const err = persistSettings(next);
    set({ settings: next });
    return err;
  },
  hasRequiredKeys() {
    const s = get().settings;
    if (!s.assemblyAiKey) return false;
    if (s.provider === 'anthropic') return Boolean(s.anthropicApiKey);
    if (s.provider === 'gemini-api-key') return Boolean(s.geminiApiKey);
    return Boolean(s.openaiApiKey);
  },
  lock() {
    set({ locked: true });
    // Freeze silence-detection while the lock screen is up — the "Keep
    // recording" banner is unreachable behind the z-50 overlay, so an
    // ongoing recording could silently auto-stop without the physician
    // ever seeing the prompt.
    useRecorderStore.getState().setSilenceCheckPaused(true);
  },
  unlock() {
    set({ locked: false });
    useRecorderStore.getState().setSilenceCheckPaused(false);
  },
}));
