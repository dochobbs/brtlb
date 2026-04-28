import {
  composeNotePrompt,
  createAnthropicProvider,
  createGeminiApiKeyProvider,
  createOpenAiCompatibleProvider,
  transcribeBlobWithAssemblyAi,
  type GenerateNoteInput,
  type LlmProvider,
  type NoteBookmark,
  type NoteTemplate,
  type RecordingMode,
  type SpeakerRoleAssignment,
  type Transcript,
} from '@brtlb/pipeline';
import { getPattern, getTemplate } from '@brtlb/prompts';
import type { ProviderKind, Settings } from '../store';
import { PEDIATRIC_WORD_BOOST } from './peds-vocabulary';

export type PipelineStage = 'uploading' | 'transcribing' | 'generating' | 'done' | 'failed';

export interface RunMvpPipelineInput {
  audio: Blob;
  mode: RecordingMode;
  settings: Settings;
  onStage?: (stage: PipelineStage) => void;
  templateId?: string;
  patternId?: string;
  speakerRoles?: SpeakerRoleAssignment[];
  bookmarks?: NoteBookmark[];
}

export interface RunMvpPipelineOutput {
  transcript: Transcript;
  note: string;
  providerUsed: ProviderKind;
  /** The template actually used — may differ from the input templateId when auto-detection picked something else. */
  templateId: string;
}

/**
 * When the beta invite is set, all LLM calls go through brtlb's proxy at
 * the same origin (relative URLs work because the SPA is served from the
 * same Vercel project). The invite token is sent as the SDK auth header
 * and the server swaps in the real upstream key.
 */
function proxyBaseUrl(suffix: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/api/${suffix}`;
}

function buildProvider(settings: Settings): {
  provider: LlmProvider;
  kind: ProviderKind;
} {
  const beta = settings.betaInvite.trim();
  const useProxy = beta.length > 0;

  if (settings.provider === 'anthropic') {
    return {
      provider: createAnthropicProvider({
        kind: 'anthropic',
        apiKey: useProxy ? beta : settings.anthropicApiKey,
        model: settings.anthropicModel,
        ...(useProxy ? { baseUrl: proxyBaseUrl('anthropic') } : {}),
      }),
      kind: 'anthropic',
    };
  }
  if (settings.provider === 'gemini-api-key') {
    return {
      provider: createGeminiApiKeyProvider({
        kind: 'gemini-api-key',
        apiKey: useProxy ? beta : settings.geminiApiKey,
        model: settings.geminiModel,
        ...(useProxy ? { baseUrl: proxyBaseUrl('gemini') } : {}),
      }),
      kind: 'gemini-api-key',
    };
  }
  // OpenAI: SDK's baseURL is e.g. https://api.openai.com/v1; mirror that
  // path on the proxy so SDK routes resolve cleanly.
  return {
    provider: createOpenAiCompatibleProvider({
      kind: 'openai-compatible',
      apiKey: useProxy ? beta : settings.openaiApiKey,
      model: settings.openaiModel,
      ...(useProxy
        ? { baseUrl: proxyBaseUrl('openai/v1') }
        : settings.openaiBaseUrl
          ? { baseUrl: settings.openaiBaseUrl }
          : {}),
    }),
    kind: 'openai-compatible',
  };
}

function resolveTemplate(
  id: string,
  customTemplates: readonly {
    id: string;
    name: string;
    description?: string;
    promptBody: string;
  }[],
): NoteTemplate | undefined {
  const builtin = getTemplate(id);
  if (builtin) return builtin;
  const custom = customTemplates.find((t) => t.id === id);
  if (!custom) return undefined;
  return {
    id: custom.id,
    name: custom.name,
    description: custom.description ?? '',
    promptBody: custom.promptBody,
  };
}

/**
 * Built-in template IDs we ask the auto-detector to choose between. We
 * intentionally exclude 'dictation' (mode-specific) and any user customs
 * (we don't want the LLM picking "Dr Smith's preferred format" by name).
 */
const AUTO_DETECT_CANDIDATES = [
  'soap',
  'well-child',
  'sick-visit',
  'follow-up',
  'adhd-med-check',
  'procedure',
] as const;

const VISIT_TYPE_DETECTOR_PROMPT = `You are a pediatric documentation router. Read the transcript excerpt and pick ONE template id from this list:

- soap            — generic visit, when no other category clearly fits
- well-child      — preventive care visit (vaccines, milestones, anticipatory guidance dominate)
- sick-visit      — acute illness or injury (URI, ear pain, rash, fever, GI, asthma, etc.)
- follow-up       — interim check on a known problem or recently treated condition
- adhd-med-check  — explicit ADHD medication visit (response, side effects, vitals on stimulant)
- procedure       — an in-office procedure was performed (laceration repair, I&D, ear curettage, etc.)

RULES:
- When in doubt between sick-visit and well-child, BOTH happened, or the visit is mixed: pick "soap" (its prompt handles mixed visits explicitly).
- When the transcript is too short or ambiguous: pick "soap".
- Output the id ONLY. No quotes, no punctuation, no explanation. One word.

Examples of valid output: soap | well-child | sick-visit | follow-up | adhd-med-check | procedure`;

async function detectVisitType(
  transcript: Transcript,
  settings: Settings,
): Promise<string> {
  // Use the first ~2000 chars of transcript text for the routing decision.
  // Longer is wasteful and the LLM rarely needs more for the call.
  const text = transcript.utterances
    .map((u) => u.text)
    .join(' ')
    .slice(0, 2000);
  if (text.trim().length < 50) return 'soap'; // not enough to decide

  const detectorTemplate: NoteTemplate = {
    id: 'visit-type-detector',
    name: 'Visit-Type Detector',
    description: 'Internal — picks the best template for this transcript.',
    promptBody: `${VISIT_TYPE_DETECTOR_PROMPT}\n\nTRANSCRIPT EXCERPT:\n${text}`,
  };

  const { provider } = buildProvider(settings);
  let raw: string;
  try {
    raw = await provider.generateNote({
      transcript: {
        // Pass an empty utterance list so composeNotePrompt doesn't duplicate
        // the transcript (we already embedded it in promptBody).
        ...transcript,
        utterances: [],
      },
      template: detectorTemplate,
      pattern: NEUTRAL_PATTERN,
      mode: 'ambient',
      speakerRoles: [],
    });
  } catch {
    return 'soap'; // any failure → safe fallback
  }
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return (AUTO_DETECT_CANDIDATES as readonly string[]).includes(cleaned) ? cleaned : 'soap';
}

export async function runMvpPipeline(input: RunMvpPipelineInput): Promise<RunMvpPipelineOutput> {
  const initialTemplateId = input.templateId ?? (input.mode === 'dictation' ? 'dictation' : 'soap');
  const patternId = input.patternId ?? 'narrative';
  const pattern = getPattern(patternId);
  if (!pattern) throw new Error(`Unknown pattern: ${patternId}`);

  input.onStage?.('uploading');
  const beta = input.settings.betaInvite.trim();
  const useProxy = beta.length > 0;
  let transcript: Transcript;
  try {
    transcript = await transcribeBlobWithAssemblyAi({
      audio: input.audio,
      mode: input.mode,
      config: {
        apiKey: useProxy ? beta : input.settings.assemblyAiKey,
        ...(useProxy && typeof window !== 'undefined'
          ? { baseUrl: `${window.location.origin}/api/assemblyai` }
          : {}),
      },
      wordBoost: [...PEDIATRIC_WORD_BOOST],
    });
    input.onStage?.('transcribing');
  } catch (err) {
    input.onStage?.('failed');
    throw err;
  }

  // Auto-detect visit type for ambient when the caller used the default
  // 'soap'. If the user explicitly picked a non-default template (or this
  // is dictation mode), respect their choice.
  let templateId = initialTemplateId;
  if (input.mode === 'ambient' && initialTemplateId === 'soap') {
    templateId = await detectVisitType(transcript, input.settings);
  }
  const template = resolveTemplate(templateId, input.settings.customTemplates);
  if (!template) throw new Error(`Unknown template: ${templateId}`);

  input.onStage?.('generating');
  const { provider, kind } = buildProvider(input.settings);
  const noteInput: GenerateNoteInput = {
    transcript,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      promptBody: template.promptBody,
    },
    pattern: {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      promptModifier: pattern.promptModifier,
    },
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
    bookmarks: input.bookmarks ?? [],
  };

  let note: string;
  try {
    note = await provider.generateNote(noteInput);
  } catch (err) {
    input.onStage?.('failed');
    throw err;
  }

  input.onStage?.('done');
  return { transcript, note, providerUsed: kind, templateId };
}

export interface RegenerateNoteInput {
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  templateId: string;
  patternId?: string;
  speakerRoles?: SpeakerRoleAssignment[];
  bookmarks?: NoteBookmark[];
}

export interface RegenerateNoteOutput {
  note: string;
  providerUsed: ProviderKind;
}

/**
 * Re-run only the LLM step against an existing transcript with a (possibly
 * different) template. Skips AssemblyAI entirely — no extra transcription
 * cost, no need to keep the audio.
 */
export async function regenerateNoteFromTranscript(
  input: RegenerateNoteInput,
): Promise<RegenerateNoteOutput> {
  const template = resolveTemplate(input.templateId, input.settings.customTemplates);
  const pattern = getPattern(input.patternId ?? 'narrative');
  if (!template) throw new Error(`Unknown template: ${input.templateId}`);
  if (!pattern) throw new Error(`Unknown pattern: ${input.patternId}`);

  const { provider, kind } = buildProvider(input.settings);
  const noteInput: GenerateNoteInput = {
    transcript: input.transcript,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      promptBody: template.promptBody,
    },
    pattern: {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      promptModifier: pattern.promptModifier,
    },
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
    bookmarks: input.bookmarks ?? [],
  };
  const note = await provider.generateNote(noteInput);
  return { note, providerUsed: kind };
}

const NEUTRAL_PATTERN = {
  id: 'plain',
  name: 'Plain',
  description: 'No additional style modifier.',
  promptModifier: '',
};

const QA_REVIEW_PROMPT_HEADER = `You are a clinical QA reviewer checking whether a pediatric note accurately reflects the transcript.
Your job is to flag concrete, clinically meaningful risks of HALLUCINATION (note says something the transcript doesn't support) and OMISSION (note misses something the transcript clearly addresses).

CRITICAL CONTEXT — THE TRANSCRIPT HAS STT ERRORS:
The transcript is from automatic speech-to-text and contains misheard words, dropped words, fragments, and noise. Common issues: medication names rendered phonetically (e.g., "albuterol" → "all beautiful"), dosing units garbled, child names changed, "no" / "now" confusion, side-effect lists collapsed.
- DO NOT flag a note phrase as "hallucination" just because the literal transcript words don't match. If the note's wording is a reasonable correction of an obvious STT error in context (medication names, doses, dates, ages), that is NOT a hallucination.
- DO flag the note when it asserts a clinical fact (a vital, a diagnosis, a duration, a treatment) that has no plausible source anywhere in the transcript — including charitable readings of garbled stretches.
- When the transcript is ambiguous or garbled in a clinically important spot, that is itself worth flagging as a possible-omission risk so the physician can verify.

REVIEW PRIORITIES (in order):
1. HALLUCINATION — findings, vitals, diagnoses, history, exam details, or plan items in the note that have no plausible source in the transcript even after charitable interpretation of STT errors.
2. OMISSION — concerns, symptoms, exam findings, or plan items clearly discussed in the transcript that are MISSING from the note.
3. MIXED-VISIT COLLAPSE — preventive + acute visits reduced to only the sick problem (or only the well-child portion).
4. ASSESSMENT/PLAN MISMATCH — the assessment or plan doesn't match the chief complaint or what was actually discussed.
5. WRONG-PATIENT RISK — the note appears to describe a different child than the encounter (sibling contamination, name drift).

RULES:
- Be conservative. Do not nitpick style or wording.
- Charitable interpretation: assume the physician heard correctly and the transcript is the noisy artifact, NOT the source of truth.
- If there are no meaningful issues, return exactly: "No issues found."
- Max 5 issues.

OUTPUT — markdown bullet list. Each bullet starts with a severity emoji, then a category tag, then a one-sentence explanation. Cite a short excerpt from the note or transcript when it makes the issue concrete.

Severity:
- 🔴 Critical — safety-relevant fabrication, missing red-flag content, wrong patient.
- 🟡 Warning — clinically meaningful but not immediately unsafe.
- ⚪ Info — minor concerns.

Category tags (use exactly one per bullet):
- (possible hallucination)
- (missing from note)
- (mixed-visit collapse)
- (assessment/plan mismatch)
- (wrong patient risk)

Example:
- 🔴 (possible hallucination) Note documents temp 102°F but transcript only mentions "felt warm last night."
- 🟡 (missing from note) Transcript discusses fluoride varnish counseling at length; note has no anticipatory guidance section.`;

const PEARLS_PROMPT_HEADER = `You are a senior pediatrician reviewing a finished visit note alongside the transcript and offering 0–3 SHARP clinical pearls.

A pearl is what an experienced colleague would lean over and say after the visit: a non-obvious connection, a subtle differential to keep on the radar, a guideline nuance, a dosing consideration, a developmental or family-dynamics observation that shapes care. Pearls are SPECIFIC TO THIS CHILD AND THIS VISIT. They are not generic pediatric advice and not restatements of what's already in the note.

WHAT QUALIFIES (high-quality examples):
- "Concerta peaks 6–8h after dosing — the 'WIND-time' episodes the teacher describes are exactly that window, worth distinguishing pharmacologic activation from environmental triggers before adjusting the regimen."
- "The hoarse cry plus arching during feeds is more suggestive of laryngomalacia + reflux than colic; if not improving by 4 months, consider GI."
- "Mother is a physician and offering a detailed differential — easy to default to her framing, but worth confirming the child's symptoms in your own words to avoid co-option of the visit."
- "The shift in episode character (dissociative vs. overt anger) plus 'he seems like he's not there' deserves a low threshold for EEG before escalating ADHD meds."
- "5-day-amox course for AOM in a 2yo with recent recurrent OM may be undertreatment; current AAP guidance favors 10 days under age 2."

WHAT DOES NOT QUALIFY:
- Generic safety advice ("monitor for fever").
- Restating the assessment ("AOM was diagnosed").
- Proposing tests, imaging, referrals, or med changes — those go in the plan.
- Anything not specifically grounded in this transcript.
- Vague observations that could apply to any child.

HARD RULES:
- Each pearl is ONE specific, concrete sentence (or two short ones). No labels, no preambles.
- Pearls must be grounded in the transcript or the note. No fabrication.
- The transcript may have STT errors — interpret charitably; do not pearl on garbled words.
- If there is nothing genuinely useful to add, return exactly: "No pearls."
- Maximum 3 pearls. Better to return 1 sharp pearl than 3 dull ones.

OUTPUT — markdown bullet list (\`- \`), 0 to 3 bullets.`;

export interface ReviewNoteInput {
  note: string;
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  speakerRoles?: SpeakerRoleAssignment[];
}

/**
 * Roci-style QA pass. Run a separate LLM call whose only job is to flag
 * note-vs-transcript inconsistencies. Cheap (one short reply), high value.
 * Returns markdown — render directly in the UI.
 */
export async function reviewNoteQuality(input: ReviewNoteInput): Promise<string> {
  const reviewTemplate: NoteTemplate = {
    id: 'qa-review',
    name: 'QA Review',
    description: 'Internal — note quality review against the transcript.',
    promptBody: `${QA_REVIEW_PROMPT_HEADER}\n\nNOTE TO REVIEW:\n${input.note}`,
  };

  const { provider } = buildProvider(input.settings);
  const out = await provider.generateNote({
    transcript: input.transcript,
    template: reviewTemplate,
    pattern: NEUTRAL_PATTERN,
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  });
  return out.trim();
}

export interface ClinicalPearlsInput {
  note: string;
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  speakerRoles?: SpeakerRoleAssignment[];
}

/**
 * Roci-style enrichment pass scoped to clinical pearls only — 0-3 brief
 * collegial observations grounded in the transcript and note. Cheap (one
 * short reply), surfaced after the note in the UI.
 */
export async function generateClinicalPearls(input: ClinicalPearlsInput): Promise<string> {
  const pearlsTemplate: NoteTemplate = {
    id: 'clinical-pearls',
    name: 'Clinical Pearls',
    description: 'Internal — pediatric pearls pass.',
    promptBody: `${PEARLS_PROMPT_HEADER}\n\nNOTE:\n${input.note}`,
  };

  const { provider } = buildProvider(input.settings);
  const out = await provider.generateNote({
    transcript: input.transcript,
    template: pearlsTemplate,
    pattern: NEUTRAL_PATTERN,
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  });
  return out.trim();
}

export interface TweakNoteInput {
  note: string;
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  instruction: string;
  speakerRoles?: SpeakerRoleAssignment[];
}

/**
 * Roci-style note revision. Take an existing note + the transcript +
 * a free-form physician instruction ("shorten the assessment", "rewrite
 * the plan as a numbered list", "fix the dose to mg/kg") and return a
 * revised note. The transcript still gates fabrication.
 */
export async function tweakNote(input: TweakNoteInput): Promise<string> {
  const tweakTemplate: NoteTemplate = {
    id: 'tweak',
    name: 'Tweak',
    description: 'Internal — physician-directed revision.',
    promptBody: `You are revising an existing pediatric outpatient note based on a physician instruction.
Keep the note faithful to the transcript.

HARD RULES:
- Do not invent history, exam findings, vitals, or diagnoses not supported by the transcript.
- Keep the note scoped to this encounter's primary patient.
- Only make changes that are necessary to satisfy the instruction unless the instruction explicitly says the current note is wrong.
- Preserve sections the instruction does not mention.
- Return the COMPLETE revised note in markdown, not just a diff or the changed section.

PHYSICIAN INSTRUCTION:
${input.instruction}

CURRENT NOTE:
${input.note}`,
  };

  const { provider } = buildProvider(input.settings);
  const out = await provider.generateNote({
    transcript: input.transcript,
    template: tweakTemplate,
    pattern: NEUTRAL_PATTERN,
    mode: input.mode,
    speakerRoles: input.speakerRoles ?? [],
  });
  return out.trim();
}

// Re-export composeNotePrompt for tests / dev tooling
export { composeNotePrompt };
