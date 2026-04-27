import type { Database } from '../adapter';

export interface SettingsRow {
  activeProvider: string | null;
  geminiConfigJson: string | null;
  anthropicConfigJson: string | null;
  openaiCompatibleConfigJson: string | null;
  assemblyAiKeyEncrypted: string | null;
  audioPurgeDays: number;
  defaultTemplateId: string | null;
  defaultPatternId: string | null;
  letterheadHtml: string | null;
  lockPolicy: string;
}

export interface SettingsInit {
  activeProvider?: string | null;
  geminiConfigJson?: string | null;
  anthropicConfigJson?: string | null;
  openaiCompatibleConfigJson?: string | null;
  assemblyAiKeyEncrypted?: string | null;
  audioPurgeDays?: number;
  defaultTemplateId?: string | null;
  defaultPatternId?: string | null;
  letterheadHtml?: string | null;
  lockPolicy?: string;
}

export type SettingsUpdate = SettingsInit;

export interface SettingsRepo {
  get(): SettingsRow | null;
  init(input: SettingsInit): void;
  update(input: SettingsUpdate): number;
}

interface Row {
  id: number;
  active_provider: string | null;
  gemini_config_json: string | null;
  anthropic_config_json: string | null;
  openai_compatible_config_json: string | null;
  assemblyai_key_encrypted: string | null;
  audio_purge_days: number;
  default_template_id: string | null;
  default_pattern_id: string | null;
  letterhead_html: string | null;
  lock_policy: string;
}

function toRow(r: Row): SettingsRow {
  return {
    activeProvider: r.active_provider,
    geminiConfigJson: r.gemini_config_json,
    anthropicConfigJson: r.anthropic_config_json,
    openaiCompatibleConfigJson: r.openai_compatible_config_json,
    assemblyAiKeyEncrypted: r.assemblyai_key_encrypted,
    audioPurgeDays: r.audio_purge_days,
    defaultTemplateId: r.default_template_id,
    defaultPatternId: r.default_pattern_id,
    letterheadHtml: r.letterhead_html,
    lockPolicy: r.lock_policy,
  };
}

const COLUMN_MAP: Record<keyof SettingsInit, string> = {
  activeProvider: 'active_provider',
  geminiConfigJson: 'gemini_config_json',
  anthropicConfigJson: 'anthropic_config_json',
  openaiCompatibleConfigJson: 'openai_compatible_config_json',
  assemblyAiKeyEncrypted: 'assemblyai_key_encrypted',
  audioPurgeDays: 'audio_purge_days',
  defaultTemplateId: 'default_template_id',
  defaultPatternId: 'default_pattern_id',
  letterheadHtml: 'letterhead_html',
  lockPolicy: 'lock_policy',
};

export function createSettingsRepo(db: Database): SettingsRepo {
  const getStmt = db.prepare(`SELECT * FROM settings WHERE id = 1`);

  return {
    get() {
      const r = getStmt.get<Row>();
      return r ? toRow(r) : null;
    },
    init(input) {
      const cols: string[] = ['id'];
      const placeholders: string[] = ['1'];
      const values: Array<string | number | null> = [];
      for (const [key, dbCol] of Object.entries(COLUMN_MAP)) {
        const v = input[key as keyof SettingsInit];
        if (v !== undefined) {
          cols.push(dbCol);
          placeholders.push('?');
          values.push(v as string | number | null);
        }
      }
      const sql = `INSERT OR IGNORE INTO settings (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
      db.prepare(sql).run(...values);
    },
    update(input) {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      for (const [key, dbCol] of Object.entries(COLUMN_MAP)) {
        const v = input[key as keyof SettingsInit];
        if (v !== undefined) {
          sets.push(`${dbCol} = ?`);
          values.push(v as string | number | null);
        }
      }
      if (sets.length === 0) return 0;

      const existing = getStmt.get<Row>();
      if (!existing) {
        throw new Error('SettingsRepo.update: settings row not initialized; call init() first');
      }

      const sql = `UPDATE settings SET ${sets.join(', ')} WHERE id = 1`;
      return db.prepare(sql).run(...values).changes;
    },
  };
}
