import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './store';

describe('useAppStore', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    useAppStore.setState({
      settings: {
        provider: 'anthropic',
        anthropicApiKey: '',
        anthropicModel: 'claude-sonnet-4-6',
        openaiApiKey: '',
        openaiBaseUrl: '',
        openaiModel: 'gpt-4o',
        geminiApiKey: '',
        geminiModel: 'gemini-2.0-flash',
        assemblyAiKey: '',
        audioPurgeDays: 7,
        idleLockMinutes: 5,
        customTemplates: [],
        wizardCompletedV1: false,
        deleteAssemblyAiAfterTranscription: true,
        theme: 'system',
      },
      view: 'home',
      currentRecordingId: null,
      locked: false,
    });
  });

  it('starts on the home view with no current recording', () => {
    expect(useAppStore.getState().view).toBe('home');
    expect(useAppStore.getState().currentRecordingId).toBeNull();
  });

  it('saveSettings merges and persists', () => {
    useAppStore.getState().saveSettings({ assemblyAiKey: 'aai-test' });
    expect(useAppStore.getState().settings.assemblyAiKey).toBe('aai-test');
    expect(localStorage.getItem('brtlb.settings.v1')).toContain('aai-test');
  });

  it('hasRequiredKeys requires both AssemblyAI and an LLM key for the active provider', () => {
    const { saveSettings, hasRequiredKeys } = useAppStore.getState();
    expect(hasRequiredKeys()).toBe(false);
    saveSettings({ assemblyAiKey: 'aai' });
    expect(useAppStore.getState().hasRequiredKeys()).toBe(false);
    saveSettings({ anthropicApiKey: 'sk-ant' });
    expect(useAppStore.getState().hasRequiredKeys()).toBe(true);
    saveSettings({ provider: 'openai-compatible' });
    expect(useAppStore.getState().hasRequiredKeys()).toBe(false);
    saveSettings({ openaiApiKey: 'sk-oai' });
    expect(useAppStore.getState().hasRequiredKeys()).toBe(true);
  });
});
