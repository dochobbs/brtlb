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
import {
  computeDiarizationHints,
  EMPTY_DIARIZATION_HINTS,
  selectRecoveryCandidates,
  summarizeTranscriptSpeakers,
  type DiarizationHints,
  type RawIdentifySpeaker,
  type RecoverySplit,
  type RecoverySuggestion,
} from './diarization-hints';

/** Hardcoded `speakers_expected` hint sent to AssemblyAI. The diarization-
 * hints layer compares detected speakers against this value to flag the
 * "AAI returned far fewer speakers than we asked for" failure mode. Bumping
 * this value would tighten Banner 1's hint-gap trigger; see
 * docs/design-diarization-banners.md. */
const SPEAKERS_EXPECTED_HINT = 4;

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
  /** Patient segments detected in the recording. Length 1 = single-patient encounter. */
  patientSegments: PatientSegment[];
  /** Long-visit chapter markers for navigation. Empty for short visits. */
  transcriptChapters: TranscriptChapter[];
  /** Auto-generated short label, or null if the transcript was too short / ambiguous. */
  suggestedLabel: string | null;
  /** Speaker-role mapping inferred during stage 1 patient identification.
   * Empty for dictation mode or when the LLM couldn't confidently map. The
   * Review UI seeds the manual chips with these so the first-pass note has
   * proper attribution without user intervention. */
  speakerRoles: SpeakerRoleAssignment[];
  /** Diarization quality hints derived from the transcript + identify
   * stage. Drives the Review-screen banners that surface silent AAI
   * diarization failures. See diarization-hints.ts. */
  diarizationHints: DiarizationHints;
}

const LONG_VISIT_CHAPTER_THRESHOLD_MS = 30 * 60_000; // 30 min

function buildProvider(settings: Settings): {
  provider: LlmProvider;
  kind: ProviderKind;
} {
  if (settings.provider === 'anthropic') {
    return {
      provider: createAnthropicProvider({
        kind: 'anthropic',
        apiKey: settings.anthropicApiKey,
        model: settings.anthropicModel,
      }),
      kind: 'anthropic',
    };
  }
  if (settings.provider === 'gemini-api-key') {
    return {
      provider: createGeminiApiKeyProvider({
        kind: 'gemini-api-key',
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
      }),
      kind: 'gemini-api-key',
    };
  }
  return {
    provider: createOpenAiCompatibleProvider({
      kind: 'openai-compatible',
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
      ...(settings.openaiBaseUrl ? { baseUrl: settings.openaiBaseUrl } : {}),
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
  'behavioral-health',
  'developmental-eval',
] as const;

const VISIT_TYPE_DETECTOR_PROMPT = `You are a pediatric documentation router. Read the transcript excerpt and pick ONE template id from this list:

- soap                — generic visit, when no other category clearly fits
- well-child          — preventive care visit (vaccines, milestones, anticipatory guidance dominate)
- sick-visit          — acute illness or injury (URI, ear pain, rash, fever, GI, asthma, etc.)
- follow-up           — interim check on a known problem or recently treated condition
- adhd-med-check      — explicit ADHD medication visit (response, side effects, vitals on stimulant)
- procedure           — an in-office procedure was performed (laceration repair, I&D, ear curettage, etc.)
- behavioral-health   — pediatric mental-health visit (mood, anxiety, depression screen, suicidality, trauma, ADHD diagnostic intake, family conflict, substance use, eating disorders, therapy referral)
- developmental-eval  — long-form developmental or autism evaluation (M-CHAT, ADOS-style observation, parent interview about milestones + social communication + repetitive behaviors, diagnostic feedback discussion)

RULES:
- When in doubt between sick-visit and well-child, BOTH happened, or the visit is mixed: pick "soap" (its prompt handles mixed visits explicitly).
- behavioral-health: pick when mood/behavior/relationships/safety/mental-health screens dominate the transcript. NOT for routine wellness checks that happen to ask "any worries?".
- developmental-eval: pick when the transcript reads like a structured evaluation — extensive milestone history, deliberate observation of communication / social / repetitive behaviors, formal screening tools mentioned, or visit duration suggests a multi-component eval.
- When the transcript is too short or ambiguous: pick "soap".
- Output the id ONLY. No quotes, no punctuation, no explanation. One word.

Examples of valid output: soap | well-child | sick-visit | follow-up | adhd-med-check | procedure | behavioral-health | developmental-eval`;

async function detectVisitType(transcript: Transcript, settings: Settings): Promise<string> {
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
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return (AUTO_DETECT_CANDIDATES as readonly string[]).includes(cleaned) ? cleaned : 'soap';
}

export async function runMvpPipeline(input: RunMvpPipelineInput): Promise<RunMvpPipelineOutput> {
  const initialTemplateId = input.templateId ?? (input.mode === 'dictation' ? 'dictation' : 'soap');
  const patternId = input.patternId ?? 'narrative';
  const pattern = getPattern(patternId);
  if (!pattern) throw new Error(`Unknown pattern: ${patternId}`);

  input.onStage?.('uploading');
  let transcript: Transcript;
  try {
    transcript = await transcribeBlobWithAssemblyAi({
      audio: input.audio,
      mode: input.mode,
      config: {
        apiKey: input.settings.assemblyAiKey,
        deleteOnCompletion: input.settings.deleteAssemblyAiAfterTranscription,
      },
      keytermsPrompt: [...PEDIATRIC_WORD_BOOST],
      // Bias the diarizer toward the typical peds-visit upper bound:
      // provider + up to 2 parents + child. Without this hint AssemblyAI
      // routinely lands on 2 even when 4 voices are present. Dictation
      // mode ignores this (speaker_labels is off there).
      speakersExpected: SPEAKERS_EXPECTED_HINT,
    });
    input.onStage?.('transcribing');
  } catch (err) {
    input.onStage?.('failed');
    throw err;
  }

  input.onStage?.('generating');
  const { provider, kind } = buildProvider(input.settings);

  // Multi-patient split — only runs in ambient mode. Dictation is by
  // definition single-patient (the physician is narrating).
  // Stage 1 of the splitter also surfaces per-speaker role mapping, which
  // we use as the initial speakerRoles so the note generation gets proper
  // attribution from the first pass (without the user having to tag chips
  // manually). User-supplied roles still win.
  let patientSegments: PatientSegment[];
  let detectedSpeakerRoles: SpeakerRoleAssignment[] = [];
  let identifyRawSpeakers: RawIdentifySpeaker[] = [];
  let identifyPatientCount = 0;
  if (input.mode === 'ambient') {
    const splitResult = await splitByPatient(transcript, input.settings);
    patientSegments = splitResult.segments;
    detectedSpeakerRoles = splitResult.speakerRoles;
    identifyRawSpeakers = splitResult.identifyContext.rawSpeakers;
    identifyPatientCount = splitResult.identifyContext.patientCount;
  } else {
    patientSegments = [allUtterancesSingleSegment(transcript)];
  }
  const effectiveSpeakerRoles =
    input.speakerRoles && input.speakerRoles.length > 0 ? input.speakerRoles : detectedSpeakerRoles;
  const isMultiPatient = patientSegments.length > 1;

  // Auto-detect visit type only when caller used the default 'soap' AND we
  // have a single patient. For multi-patient encounters, each segment
  // already carries its own visit_type from the split prompt and should
  // override the global template choice.
  let templateId = initialTemplateId;
  if (!isMultiPatient && input.mode === 'ambient' && initialTemplateId === 'soap') {
    templateId = await detectVisitType(transcript, input.settings);
  }
  const template = resolveTemplate(templateId, input.settings.customTemplates);
  if (!template) throw new Error(`Unknown template: ${templateId}`);

  let note: string;
  try {
    if (!isMultiPatient) {
      // Single-patient flow — exactly as before.
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
        speakerRoles: effectiveSpeakerRoles,
        bookmarks: input.bookmarks ?? [],
      };
      note = await provider.generateNote(noteInput);
    } else {
      // Multi-patient flow — generate a note per segment with that
      // segment's transcript slice + a per-segment context preamble that
      // tells the LLM which patient to scope to. Concatenate with
      // patient headers.
      const sections: string[] = [];
      for (const seg of patientSegments) {
        const filtered = filterTranscriptByIndices(transcript, seg.relevantUtteranceIndices);
        const segTemplateId = templateForVisitType(seg.visitType);
        const segTemplate = resolveTemplate(segTemplateId, input.settings.customTemplates);
        if (!segTemplate) throw new Error(`Unknown template: ${segTemplateId}`);
        const augmentedPromptBody = `${segTemplate.promptBody}\n\n${segmentContextPreamble(seg)}`;
        const segNote = await provider.generateNote({
          transcript: filtered,
          template: {
            id: segTemplate.id,
            name: segTemplate.name,
            description: segTemplate.description,
            promptBody: augmentedPromptBody,
          },
          pattern: {
            id: pattern.id,
            name: pattern.name,
            description: pattern.description,
            promptModifier: pattern.promptModifier,
          },
          mode: input.mode,
          speakerRoles: effectiveSpeakerRoles,
          bookmarks: input.bookmarks ?? [],
        });
        sections.push(`${patientHeader(seg)}\n\n${segNote.trim()}`);
      }
      note = sections.join('\n\n---\n\n');
    }
  } catch (err) {
    input.onStage?.('failed');
    throw err;
  }

  // Post-note enrichments: chapters (long visits only) + auto label. Run in
  // parallel since both are read-only against the transcript. Best-effort —
  // if either fails, ship the note without that field.
  let transcriptChapters: TranscriptChapter[] = [];
  let suggestedLabel: string | null = null;
  if (transcript.utterances.length > 0) {
    const lastUtterance = transcript.utterances[transcript.utterances.length - 1];
    const visitDurationMs = lastUtterance?.endMs ?? 0;
    const wantsChapters =
      input.mode === 'ambient' && visitDurationMs >= LONG_VISIT_CHAPTER_THRESHOLD_MS;
    const [chaptersResult, labelResult] = await Promise.allSettled([
      wantsChapters
        ? detectChapters(transcript, input.settings)
        : Promise.resolve([] as TranscriptChapter[]),
      suggestLabel(transcript, input.settings),
    ]);
    if (chaptersResult.status === 'fulfilled') {
      transcriptChapters = chaptersResult.value;
    }
    if (labelResult.status === 'fulfilled') {
      suggestedLabel = labelResult.value;
    }
  }

  // Diarization hints — derived from STT output + identify-stage context.
  // Dictation mode skips this entirely (no diarization to evaluate).
  let diarizationHints: DiarizationHints = EMPTY_DIARIZATION_HINTS;
  if (input.mode === 'ambient' && transcript.utterances.length > 0) {
    const { transcriptSpeakerIds, utteranceCountBySpeaker } = summarizeTranscriptSpeakers(
      transcript.utterances,
    );
    diarizationHints = computeDiarizationHints({
      transcriptSpeakerIds,
      utteranceCountBySpeaker,
      speakersExpectedHint: SPEAKERS_EXPECTED_HINT,
      identifiedPatientCount: identifyPatientCount,
      keptSpeakers: detectedSpeakerRoles.map((r) => ({ speakerId: r.speakerId, role: r.role })),
      rawIdentifySpeakers: identifyRawSpeakers,
    });
    if (diarizationHints.lowSpeakerCount || diarizationHints.collapseSuspected.length > 0) {
      console.info(`${SPLIT_LOG_PREFIX} diarization hints`, diarizationHints);
      // Tier 2 recovery — only runs when banners would fire. Best-effort:
      // if the LLM call fails, suggestions stay empty and the banner falls
      // back to the manual-tag affordance.
      try {
        const recoverySuggestions = await recoverMergedSpeakers(
          transcript,
          diarizationHints,
          input.settings,
        );
        if (recoverySuggestions.length > 0) {
          diarizationHints = { ...diarizationHints, recoverySuggestions };
        }
      } catch (err) {
        console.warn(`${RECOVERY_LOG_PREFIX} top-level failure, banner without recovery`, err);
      }
    }
  }

  input.onStage?.('done');
  return {
    transcript,
    note,
    providerUsed: kind,
    templateId,
    patientSegments,
    transcriptChapters,
    suggestedLabel,
    speakerRoles: effectiveSpeakerRoles,
    diarizationHints,
  };
}

// ---------------------------------------------------------------------------
// Auto label suggestion — short visit label for the home-screen list
// ---------------------------------------------------------------------------

const SUGGEST_LABEL_PROMPT = `You are reading a pediatric visit transcript and writing a SHORT label (3-6 words) that helps the physician find this visit later in a list of recordings.

GOOD EXAMPLES:
- "Tommy ear pain f/u"
- "MM age 4 WCV"
- "Lily ADHD med check"
- "Well child + ear pain"
- "Autism eval — James"
- "MH visit — anxiety"
- "Lac repair 3yo"

HARD RULES:
- 3-6 words. NEVER more than 8.
- Use a first name if clearly mentioned. Otherwise initials, age, or just visit-type.
- Capture the REASON for the visit, not the assessment or plan.
- Use common pediatric abbreviations (WCV, f/u, AOM, MH, etc.) where natural.
- No quotes, no trailing punctuation, no leading "Visit:".
- If transcript is too short or ambiguous to summarize, output exactly: "Visit"
- Output the label ONLY. One line. No explanation.`;

async function suggestLabel(transcript: Transcript, settings: Settings): Promise<string | null> {
  if (transcript.utterances.length === 0) return null;
  // First ~1500 chars is enough for routing-style decisions.
  const text = transcript.utterances
    .map((u) => u.text)
    .join(' ')
    .slice(0, 1500);
  if (text.trim().length < 30) return null;

  const labelTemplate: NoteTemplate = {
    id: 'auto-label',
    name: 'Auto Label',
    description: 'Internal — generates a short visit label from transcript.',
    promptBody: `${SUGGEST_LABEL_PROMPT}\n\nTRANSCRIPT EXCERPT:\n${text}`,
  };

  const { provider } = buildProvider(settings);
  let raw: string;
  try {
    raw = await provider.generateNote({
      transcript: { ...transcript, utterances: [] },
      template: labelTemplate,
      pattern: NEUTRAL_PATTERN,
      mode: 'ambient',
      speakerRoles: [],
    });
  } catch {
    return null;
  }
  const cleaned = raw
    .trim()
    .split('\n')[0]
    ?.replace(/^["']|["']$/g, '')
    .replace(/[.!?,;:]+$/, '')
    .trim();
  if (!cleaned || cleaned.toLowerCase() === 'visit') return null;
  // Cap at 60 chars regardless of what the model returned.
  return cleaned.slice(0, 60);
}

// ---------------------------------------------------------------------------
// Long-visit chapter markers
// ---------------------------------------------------------------------------

export interface TranscriptChapter {
  label: string;
  startMs: number;
  summary: string;
}

const CHAPTER_DETECTOR_PROMPT = `You are organizing a long pediatric clinical visit transcript into chapter markers so a physician can navigate it quickly.

Read the numbered transcript and emit 3-7 short chapters that capture how the visit unfolded. Common chapter labels for pediatric visits:
- "Greeting & rapport"
- "Parent interview / history"
- "Developmental history"
- "Child observation"
- "Examination"
- "Structured assessment / screening"
- "Medication discussion"
- "Discussion of findings"
- "Plan & follow-up"

But pick whatever ACTUALLY fits this visit — don't force these labels. Use the physician's own framing when something distinctive happened ("ADOS observation", "Suicide risk assessment", "Family meeting").

OUTPUT — JSON ONLY, no prose, no fences:
{
  "chapters": [
    {
      "label": "Parent interview",
      "start_utterance_index": 0,
      "summary": "Mother described 6-month history of social withdrawal and language regression"
    },
    {
      "label": "Child observation",
      "start_utterance_index": 47,
      "summary": "Direct observation of play, communication, and response to name"
    }
  ]
}

RULES:
- 3 chapters minimum, 7 maximum.
- start_utterance_index is the index of the FIRST utterance in that chapter (0-indexed).
- Chapters must be in ORDER. The first chapter starts at 0.
- summary is ONE short sentence (under 15 words) — what happened in this stretch.
- label is 2-5 words. Title Case.
- Do not invent content. If the transcript is too short or too uniform to chapter, return an empty array.
- Output JSON only — no markdown fences, no explanation.`;

async function detectChapters(
  transcript: Transcript,
  settings: Settings,
): Promise<TranscriptChapter[]> {
  if (transcript.utterances.length < 20) return []; // not enough to chapter
  const numbered = transcript.utterances.map((u, idx) => `[${idx}] ${u.text}`).join('\n');

  const detectorTemplate: NoteTemplate = {
    id: 'chapter-detector',
    name: 'Chapter Detector',
    description: 'Internal — finds chapter markers in a long-visit transcript.',
    promptBody: `${CHAPTER_DETECTOR_PROMPT}\n\nTRANSCRIPT:\n${numbered}`,
  };

  const { provider } = buildProvider(settings);
  let raw: string;
  try {
    raw = await provider.generateNote({
      transcript: { ...transcript, utterances: [] },
      template: detectorTemplate,
      pattern: NEUTRAL_PATTERN,
      mode: 'ambient',
      speakerRoles: [],
    });
  } catch {
    return [];
  }
  let parsed: {
    chapters?: Array<{ label?: string; start_utterance_index?: number; summary?: string }>;
  };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return [];
  }
  return (parsed.chapters ?? [])
    .map((c): TranscriptChapter | null => {
      const idx = c.start_utterance_index;
      if (typeof idx !== 'number' || idx < 0 || idx >= transcript.utterances.length) return null;
      const u = transcript.utterances[idx];
      if (!u) return null;
      return {
        label: (c.label ?? '').trim() || 'Chapter',
        startMs: u.startMs,
        summary: (c.summary ?? '').trim(),
      };
    })
    .filter((c): c is TranscriptChapter => c !== null);
}

function templateForVisitType(visitType: string): string {
  switch (visitType) {
    case 'well_child':
      return 'well-child';
    case 'sick':
      return 'sick-visit';
    case 'follow_up':
      return 'follow-up';
    case 'behavioral_health':
    case 'mental_health':
      return 'behavioral-health';
    case 'developmental_eval':
    case 'autism_eval':
      return 'developmental-eval';
    default:
      return 'soap';
  }
}

export interface RegenerateNoteInput {
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  templateId: string;
  patternId?: string;
  speakerRoles?: SpeakerRoleAssignment[];
  bookmarks?: NoteBookmark[];
  /** Existing per-patient segments from the original split. If present and >1,
   * regenerate produces one note per segment instead of a single note. */
  patientSegments?: PatientSegment[];
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
  const pattern = getPattern(input.patternId ?? 'narrative');
  if (!pattern) throw new Error(`Unknown pattern: ${input.patternId}`);
  const { provider, kind } = buildProvider(input.settings);

  const segments = input.patientSegments ?? [];
  if (segments.length > 1) {
    // Multi-patient regenerate. The dropdown choice is a "global" template
    // override that we apply to ALL segments (e.g., "regenerate everyone as
    // SOAP"). When the user picks a non-default template explicitly we
    // honor it for every segment.
    const sections: string[] = [];
    for (const seg of segments) {
      const filtered = filterTranscriptByIndices(input.transcript, seg.relevantUtteranceIndices);
      const segTemplateId =
        input.templateId !== 'soap' ? input.templateId : templateForVisitType(seg.visitType);
      const segTemplate = resolveTemplate(segTemplateId, input.settings.customTemplates);
      if (!segTemplate) throw new Error(`Unknown template: ${segTemplateId}`);
      const augmentedPromptBody = `${segTemplate.promptBody}\n\n${segmentContextPreamble(seg)}`;
      const segNote = await provider.generateNote({
        transcript: filtered,
        template: {
          id: segTemplate.id,
          name: segTemplate.name,
          description: segTemplate.description,
          promptBody: augmentedPromptBody,
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
      });
      sections.push(`${patientHeader(seg)}\n\n${segNote.trim()}`);
    }
    return { note: sections.join('\n\n---\n\n'), providerUsed: kind };
  }

  // Single-patient regenerate — original flow.
  const template = resolveTemplate(input.templateId, input.settings.customTemplates);
  if (!template) throw new Error(`Unknown template: ${input.templateId}`);
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

export interface RegenerateSinglePatientInput {
  /** Full structured transcript (will be filtered to the segment's utterances). */
  transcript: Transcript;
  segment: PatientSegment;
  mode: RecordingMode;
  settings: Settings;
  /**
   * Template id for this patient. Pass the active tab's template; falls
   * back to the visit-type-derived default when 'soap' (sentinel for
   * "not explicitly chosen").
   */
  templateId: string;
  patternId?: string;
  speakerRoles?: SpeakerRoleAssignment[];
  bookmarks?: NoteBookmark[];
}

export interface RegenerateSinglePatientOutput {
  /** The patient's note WITH the H2 header — drop-in replacement for one
   * chunk in the concatenated multi-patient note. */
  segmentBody: string;
  providerUsed: ProviderKind;
}

/**
 * Re-run the LLM for ONE patient segment in a multi-patient recording.
 * Used by the per-tab Regenerate button — leaves siblings' sections
 * untouched. Returns the segment's note prefixed with its H2 patient
 * header so the caller can splice it into the concatenated note.
 */
export async function regenerateSinglePatientNote(
  input: RegenerateSinglePatientInput,
): Promise<RegenerateSinglePatientOutput> {
  const pattern = getPattern(input.patternId ?? 'narrative');
  if (!pattern) throw new Error(`Unknown pattern: ${input.patternId}`);
  const { provider, kind } = buildProvider(input.settings);
  const filtered = filterTranscriptByIndices(
    input.transcript,
    input.segment.relevantUtteranceIndices,
  );
  const segTemplateId =
    input.templateId !== 'soap' ? input.templateId : templateForVisitType(input.segment.visitType);
  const segTemplate = resolveTemplate(segTemplateId, input.settings.customTemplates);
  if (!segTemplate) throw new Error(`Unknown template: ${segTemplateId}`);
  const augmentedPromptBody = `${segTemplate.promptBody}\n\n${segmentContextPreamble(input.segment)}`;
  const segNote = await provider.generateNote({
    transcript: filtered,
    template: {
      id: segTemplate.id,
      name: segTemplate.name,
      description: segTemplate.description,
      promptBody: augmentedPromptBody,
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
  });
  return {
    segmentBody: `${patientHeader(input.segment)}\n\n${segNote.trim()}`,
    providerUsed: kind,
  };
}

const NEUTRAL_PATTERN = {
  id: 'plain',
  name: 'Plain',
  description: 'No additional style modifier.',
  promptModifier: '',
};

// ---------------------------------------------------------------------------
// Multi-patient split — adapted from an earlier native-iOS note pipeline
// ---------------------------------------------------------------------------

export interface PatientSegment {
  /** Internal id for UI keying (p0, p1, ...). */
  id: string;
  /** Best-effort patient label from transcript (a name, "Patient 1", etc.). */
  patientLabel: string;
  /** sick | well_child | follow_up | phone | other */
  visitType: string;
  includesPreventiveCare: boolean;
  acuteConcerns: string[];
  chiefComplaint: string;
  /** Utterance indices in the original transcript that belong to this segment. */
  relevantUtteranceIndices: number[];
}

interface SplitResponse {
  patient_segments?: Array<{
    patient?: string;
    visit_type?: string;
    includes_preventive_care?: boolean;
    acute_concerns?: string[];
    relevant_utterances?: number[];
    chief_complaint?: string;
  }>;
}

// Stage 1: identify which children are clinically addressed in the visit.
// Discovery only — no utterance assignment. Keeping this separate from the
// split lets the splitter focus on assignment with a known roster, which is
// significantly easier than discover-and-split in one pass.
const IDENTIFY_PROMPT = `You are a medical transcription assistant. Identify the patient(s) being clinically seen in this pediatric visit recording AND map each speaker label to a role.

A "patient" is a child for whom the physician takes history, examines, counsels about, or plans care during this visit. Sibling visits are common and expected — when multiple children are clinically addressed in one recording, list each one.

OUTPUT — JSON ONLY, no prose, no code fences:
{
  "patients": [
    {"name": "Tommy", "confidence": 0.9, "note": "5yo well visit, vaccines given"},
    {"name": "Sara", "confidence": 0.85, "note": "3yo well visit, in OT/speech"},
    {"name": "Annie", "confidence": 0.95, "note": "2-month well visit"}
  ],
  "speakers": [
    {"speakerId": "A", "role": "provider", "confidence": 0.95},
    {"speakerId": "B", "role": "parent", "confidence": 0.9},
    {"speakerId": "C", "role": "patient", "confidence": 0.7}
  ]
}

PATIENT LABEL:
- Use the child's first name when stated in the transcript.
- If a name cannot be determined, use ordinal fallback ("Patient 1", "Patient 2") in the order they appear.
- NEVER use parent or sibling names that aren't being clinically addressed as patient labels.

INCLUDE A CHILD WHEN:
- The physician takes history about them (interval history, symptoms, development).
- The physician examines them (height, weight, looks at skin, checks ears, etc.).
- The physician counsels about their specific care (behavior, feeding, therapy, plan).
- They are receiving an intervention (vaccines, medication, therapy referral).

DO NOT INCLUDE:
- Children mentioned in passing but not addressed clinically (e.g., "my older son is at school today").
- Parents, caregivers, or non-patient family members.
- Children who are present in the room but only as bystanders (the physician interacts with them socially but does not address their care).

CONFIDENCE (patients):
- 0.9+ when clearly addressed with history + exam OR clear plan.
- 0.6–0.8 when partial (e.g., history only, or brief check-in).
- Below 0.6 should usually be omitted.

NOTE FIELD: One short phrase summarizing what was addressed. Helps downstream review.

SPEAKER ROLES:
- Map every distinct speakerId (A, B, C, D, …) that appears in the transcript to one of: "provider" (the physician), "parent" (caregiver), "patient" (the child being seen — usable when the child speaks for themselves), "sibling" (a non-patient child in the room), "other" (front desk, MA, unidentified).
- Use cues: clinical vocabulary + exam-driving language → provider. Speaking on behalf of a child, asking questions about a child's care → parent. Direct first-person symptom descriptions from a child → patient. Side comments from a child not being clinically addressed → sibling.
- Confidence 0.0–1.0. Lower (≤0.5) when a single speaker label clearly contains multiple voices (diarization collapse) — omit that speaker from the array if you cannot confidently pick a single role.
- Speaker labels with only filler / chatter / two or three utterances total and no clear role signal: omit.

Output JSON ONLY — no markdown fences, no explanation.`;

const SPLIT_PROMPT = `You are a medical transcription assistant. The patients being clinically seen in this visit have already been identified. Your job is to assign each transcript utterance to the patient it primarily concerns.

Visit types: sick, well_child, follow_up, phone, other.

OUTPUT — JSON ONLY, no prose, no code fences:
{
  "patient_segments": [
    {
      "patient": "Tommy",
      "visit_type": "well_child",
      "includes_preventive_care": true,
      "acute_concerns": ["left ear pain"],
      "relevant_utterances": [0, 1, 3, 5, 7],
      "chief_complaint": "well-child visit with left ear pain"
    }
  ]
}

ASSIGNMENT RULES:
- Return one segment per patient on the provided roster. Order segments to match the roster order.
- Assign each utterance to the ONE patient it primarily informs:
  - History, exam findings, counseling, or plan addressed to or about a specific child → that child.
  - Behavioral or family-dynamics counseling primarily about one child (even when partly addressed to a parent or sibling) → the child being counseled-about.
  - Shared clinical advice that applies across the children (return precautions, contagion guidance, household sick measures, when-to-call thresholds, school/daycare exclusion rules) → assign to the youngest patient (their visit will carry it). When in doubt between assigning shared clinical content and omitting it, prefer assignment — these instructions need a home in someone's note.
  - General family chatter, social moments, or logistics with no clinical signal for any child (small talk, scheduling, off-topic asides) → omit (do not assign).
- Best-effort. When an utterance could plausibly inform two children, pick the one it most directly applies to. Do not duplicate utterance indices across patients.
- Every patient on the roster should normally have a populated segment. Only return an empty segment for a patient if the transcript truly has zero clinical content for them.

VISIT TYPE RULES:
- If a child is here for a routine well visit AND also has an acute complaint, set visit_type="well_child", includes_preventive_care=true, list acute issues in acute_concerns.
- chief_complaint summarizes the combined encounter for that patient (e.g., "well-child visit with left ear pain"), not just one half.

PATIENT LABEL: Use the exact name from the provided roster.

Output JSON ONLY — no markdown fences, no explanation.`;

// Tier 2 speaker recovery — invoked only when the diarization hints layer
// detects a likely merge. Asks the LLM whether a specific speaker cluster
// contains one consistent voice or two. See docs/design-speaker-recovery.md.
const RECOVERY_PROMPT = `You are a medical transcription assistant. The speaker diarization for this pediatric visit transcript may have merged two different people into a single speaker label. Your job is to look at one specific speaker's utterances and decide whether they actually contain ONE consistent voice or TWO different people.

DEFAULT: keepAsIs. Only propose a split when the register / content evidence is strong. Examples of strong evidence:

- One subset of utterances uses adult clinical vocabulary, narrates history, or asks knowledgeable follow-up questions ("She started Friday afternoon, low fever 101.4", "Should we do a strep test?"). Another subset uses first-person symptom language or one-to-three-word kid answers ("My throat hurts", "Yeah", "Like a little"). → likely parent + child merged.
- Two adult registers: one drives the exam and uses clinical terms (provider). Another asks questions on a child's behalf, narrates history, or expresses worry (parent). → likely provider + parent merged (uncommon).
- Two child registers with clearly different developmental levels (one names complex feelings or describes school; another only answers in single words). → likely two siblings merged.

WEAK / INSUFFICIENT evidence (return keepAsIs):

- The speaker has many short answers AND some longer answers but they share a single first-person perspective (one child gradually opening up).
- The speaker code-switches between clinical and casual but it's plausibly one provider being warm with a child.
- You can't point to specific utterance text that shifts register. Vague intuition is not enough.

OUTPUT — JSON ONLY, no prose, no code fences. One of two shapes:

KEEP shape:
{
  "keepAsIs": true,
  "reason": "consistent first-person symptom register throughout, no clinical vocabulary"
}

SPLIT shape:
{
  "splits": [
    {
      "role": "parent",
      "indices": [0, 2, 5, 7, 11],
      "confidence": 0.85,
      "rationale": "narrates history with timestamps + clinical detail (utts 0, 2, 5)"
    },
    {
      "role": "patient",
      "indices": [1, 3, 4, 6, 8, 9, 10],
      "confidence": 0.85,
      "rationale": "first-person symptom answers, mostly one-to-three word responses"
    }
  ]
}

RULES:
- Confidence < 0.8 on any split → return keepAsIs instead.
- Maximum 2 sub-speakers per cluster. If you genuinely see 3+, return keepAsIs (too uncertain to act).
- Every utterance index from the input MUST appear in exactly one split. No omissions, no duplicates.
- Roles: one of "provider", "parent", "patient", "sibling", "other".
- The \`indices\` are relative to the numbered list you're given below, not the full transcript.`;

interface IdentifyResponse {
  patients?: Array<{
    name?: string;
    confidence?: number;
    note?: string;
  }>;
  speakers?: Array<{
    speakerId?: string;
    role?: string;
    confidence?: number;
  }>;
}

interface IdentifiedPatient {
  name: string;
  confidence: number;
  note: string;
}

function extractJson(s: string): string {
  // Strip ```json ... ``` fences if the model added them anyway.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  return s.trim();
}

const SPLIT_LOG_PREFIX = '[brtlb:split]';

/**
 * Stage 1 output: the patient roster plus per-speaker role mapping. Speaker
 * roles let the note-generation prompt see "Provider: ..." and "Parent: ..."
 * instead of "Speaker A: ..." without the user manually tagging chips first.
 * Empty arrays mean either no patients identified or identify failed — the
 * caller treats both as "fall back to single-patient with no role hints."
 *
 * `rawSpeakers` carries the LLM's pre-filter speaker array so downstream
 * diarization-hint logic can see entries that got dropped for low confidence
 * (collapse-suspected) or omitted entirely.
 */
interface IdentifyStageResult {
  patients: IdentifiedPatient[];
  speakerRoles: SpeakerRoleAssignment[];
  rawSpeakers: RawIdentifySpeaker[];
}

const VALID_SPEAKER_ROLES: ReadonlyArray<SpeakerRoleAssignment['role']> = [
  'provider',
  'parent',
  'patient',
  'sibling',
  'other',
];

const EMPTY_IDENTIFY_RESULT: IdentifyStageResult = {
  patients: [],
  speakerRoles: [],
  rawSpeakers: [],
};

/**
 * Stage 1 of the multi-patient split. Asks the LLM to enumerate the children
 * clinically addressed in the recording AND map speaker labels to roles.
 * Returns an empty result on any failure.
 */
async function identifyPatientsInTranscript(
  transcript: Transcript,
  settings: Settings,
): Promise<IdentifyStageResult> {
  if (transcript.utterances.length === 0) return EMPTY_IDENTIFY_RESULT;

  const numbered = transcript.utterances
    .map((u, idx) => {
      const speaker = u.speakerId ? `Speaker ${u.speakerId}` : 'Speaker';
      return `[${idx}] ${speaker}: ${u.text}`;
    })
    .join('\n');

  const identifyTemplate: NoteTemplate = {
    id: 'identify-patients',
    name: 'Identify Patients',
    description: 'Internal — discovers patients addressed in an ambient transcript.',
    promptBody: `${IDENTIFY_PROMPT}\n\nTRANSCRIPT (utterances numbered for reference):\n${numbered}`,
  };

  const { provider } = buildProvider(settings);
  let raw: string;
  try {
    raw = await provider.generateNote({
      transcript: { ...transcript, utterances: [] },
      template: identifyTemplate,
      pattern: NEUTRAL_PATTERN,
      mode: 'ambient',
      speakerRoles: [],
    });
  } catch (err) {
    console.warn(`${SPLIT_LOG_PREFIX} identify call failed, falling back to single-patient`, err);
    return EMPTY_IDENTIFY_RESULT;
  }

  let parsed: IdentifyResponse;
  try {
    parsed = JSON.parse(extractJson(raw)) as IdentifyResponse;
  } catch (err) {
    console.warn(`${SPLIT_LOG_PREFIX} identify response did not parse as JSON, falling back`, {
      error: err,
      raw,
    });
    return EMPTY_IDENTIFY_RESULT;
  }

  const patients = (parsed.patients ?? [])
    .map((p): IdentifiedPatient => ({
      name: (p.name ?? '').trim(),
      confidence: typeof p.confidence === 'number' ? p.confidence : 0,
      note: (p.note ?? '').trim(),
    }))
    .filter((p) => p.name.length > 0 && p.confidence >= 0.6);

  // Normalize the raw LLM speaker array before filtering. We keep this around
  // separately so the diarization-hints layer can detect collapse signatures
  // (low-confidence drops, "other"-role mash, silent omissions). The filter
  // logic below mirrors what the production pipeline has always done.
  const transcriptSpeakerIds = new Set(
    transcript.utterances.map((u) => u.speakerId).filter((id): id is string => Boolean(id)),
  );
  const normalizedRaw = (parsed.speakers ?? []).map((s) => ({
    speakerId: (s.speakerId ?? '').trim(),
    role: (s.role ?? '').trim().toLowerCase(),
    confidence: typeof s.confidence === 'number' ? s.confidence : 0,
  }));
  // Confidence floor 0.6 — same threshold as the patient filter; below that
  // the model is probably hedging on a collapsed-diarization mash where one
  // speaker label contains multiple voices, and using the wrong role would
  // mis-attribute the whole note.
  const speakerRoles: SpeakerRoleAssignment[] = normalizedRaw
    .filter(
      (s) =>
        s.speakerId.length > 0 &&
        transcriptSpeakerIds.has(s.speakerId) &&
        (VALID_SPEAKER_ROLES as readonly string[]).includes(s.role) &&
        s.confidence >= 0.6,
    )
    .map(({ speakerId, role }) => ({
      speakerId,
      role: role as SpeakerRoleAssignment['role'],
    }));
  // rawSpeakers keeps unfiltered entries (only the obvious garbage — empty
  // speakerId — is removed) for the diarization-hints derivation.
  const rawSpeakers: RawIdentifySpeaker[] = normalizedRaw.filter((s) => s.speakerId.length > 0);

  console.info(
    `${SPLIT_LOG_PREFIX} identified ${patients.length} patient(s), ${speakerRoles.length} speaker role(s)`,
    { patients, speakerRoles, rawSpeakerCount: rawSpeakers.length },
  );
  return { patients, speakerRoles, rawSpeakers };
}

/**
 * Stage 2 output: the per-patient segments plus the speaker-role mapping
 * surfaced by stage 1. Even when the splitter falls back to single-patient,
 * the speaker roles are still useful for note generation, so they come
 * along regardless.
 */
export interface SplitByPatientResult {
  segments: PatientSegment[];
  speakerRoles: SpeakerRoleAssignment[];
  /** Carried up so runMvpPipeline can derive diarization hints alongside
   * the existing splitter outputs without an extra LLM call. */
  identifyContext: {
    patientCount: number;
    rawSpeakers: RawIdentifySpeaker[];
  };
}

/**
 * Stage 2 of the multi-patient split. Given the patient roster from stage 1,
 * assign each utterance to a patient. Falls back to single-patient on any
 * failure (with a console warning so the fallback is observable). Speaker
 * roles from stage 1 are returned alongside the segments.
 */
async function splitByPatient(
  transcript: Transcript,
  settings: Settings,
): Promise<SplitByPatientResult> {
  if (transcript.utterances.length === 0) {
    return {
      segments: [],
      speakerRoles: [],
      identifyContext: { patientCount: 0, rawSpeakers: [] },
    };
  }

  const identifyResult = await identifyPatientsInTranscript(transcript, settings);
  const identified = identifyResult.patients;
  const speakerRoles = identifyResult.speakerRoles;
  const identifyContext = {
    patientCount: identified.length,
    rawSpeakers: identifyResult.rawSpeakers,
  };

  // Stage 1 found 0 or 1 patient → no split needed. Single-patient encounter
  // OR identify failed; either way, treat as single-patient and let the
  // standard note flow handle it.
  if (identified.length <= 1) {
    if (identified.length === 0) {
      console.info(
        `${SPLIT_LOG_PREFIX} stage 1 returned no patients — using all utterances as single segment`,
      );
    }
    return {
      segments: [allUtterancesSingleSegment(transcript)],
      speakerRoles,
      identifyContext,
    };
  }

  const numbered = transcript.utterances
    .map((u, idx) => {
      const speaker = u.speakerId ? `Speaker ${u.speakerId}` : 'Speaker';
      return `[${idx}] ${speaker}: ${u.text}`;
    })
    .join('\n');

  const roster = identified
    .map((p) => `- ${p.name}${p.note ? ` (${p.note})` : ''}`)
    .join('\n');

  const splitTemplate: NoteTemplate = {
    id: 'split-by-patient',
    name: 'Split by Patient',
    description: 'Internal — assigns utterances to a known patient roster.',
    promptBody: `${SPLIT_PROMPT}\n\nPATIENT ROSTER (assign utterances to these — one segment per patient, in this order):\n${roster}\n\nTRANSCRIPT (utterances numbered for reference):\n${numbered}`,
  };

  const { provider } = buildProvider(settings);
  let raw: string;
  try {
    raw = await provider.generateNote({
      transcript: { ...transcript, utterances: [] },
      template: splitTemplate,
      pattern: NEUTRAL_PATTERN,
      mode: 'ambient',
      speakerRoles: [],
    });
  } catch (err) {
    console.warn(
      `${SPLIT_LOG_PREFIX} stage 2 split call failed, falling back to single-patient`,
      err,
    );
    return { segments: [allUtterancesSingleSegment(transcript)], speakerRoles, identifyContext };
  }

  let parsed: SplitResponse;
  try {
    parsed = JSON.parse(extractJson(raw)) as SplitResponse;
  } catch (err) {
    console.warn(
      `${SPLIT_LOG_PREFIX} stage 2 response did not parse as JSON, falling back`,
      { error: err, raw },
    );
    return { segments: [allUtterancesSingleSegment(transcript)], speakerRoles, identifyContext };
  }
  const segments = (parsed.patient_segments ?? [])
    .map((s, idx): PatientSegment => {
      const indices = (s.relevant_utterances ?? []).filter(
        (i) => Number.isInteger(i) && i >= 0 && i < transcript.utterances.length,
      );
      return {
        id: `p${idx}`,
        patientLabel: s.patient?.trim() || identified[idx]?.name || `Patient ${idx + 1}`,
        visitType: s.visit_type ?? 'other',
        includesPreventiveCare: Boolean(s.includes_preventive_care),
        acuteConcerns: Array.isArray(s.acute_concerns) ? s.acute_concerns : [],
        chiefComplaint: s.chief_complaint ?? '',
        relevantUtteranceIndices: indices,
      };
    })
    .filter((s) => s.relevantUtteranceIndices.length > 0);

  if (segments.length === 0) {
    console.warn(
      `${SPLIT_LOG_PREFIX} stage 2 returned no usable segments despite ${identified.length} identified patients — falling back`,
    );
    return { segments: [allUtterancesSingleSegment(transcript)], speakerRoles, identifyContext };
  }
  console.info(
    `${SPLIT_LOG_PREFIX} stage 2 produced ${segments.length} segment(s)`,
    segments.map((s) => ({
      patient: s.patientLabel,
      visitType: s.visitType,
      utteranceCount: s.relevantUtteranceIndices.length,
    })),
  );
  return { segments, speakerRoles, identifyContext };
}

// ============================================================================
// Tier 2 — speaker recovery
// ============================================================================

interface RecoveryResponse {
  keepAsIs?: boolean;
  reason?: string;
  splits?: Array<{
    role?: string;
    indices?: number[];
    confidence?: number;
    rationale?: string;
  }>;
}

const RECOVERY_VALID_ROLES: ReadonlyArray<RecoverySplit['role']> = [
  'provider',
  'parent',
  'patient',
  'sibling',
  'other',
];
const RECOVERY_LOG_PREFIX = '[brtlb:recovery]';
const RECOVERY_CONFIDENCE_FLOOR = 0.8;

/** Evaluate one suspect speaker via the recovery LLM. Returns a normalized
 * RecoverySuggestion with GLOBAL transcript indices (not per-speaker). */
async function evaluateRecoveryForSpeaker(
  transcript: Transcript,
  speakerId: string,
  settings: Settings,
): Promise<RecoverySuggestion> {
  // Gather this speaker's utterances + their GLOBAL transcript indices so
  // we can translate per-speaker indices back when applying.
  const indexed = transcript.utterances
    .map((u, idx) => ({ idx, u }))
    .filter(({ u }) => u.speakerId === speakerId);

  if (indexed.length === 0) {
    return { speakerId, decision: 'keepAsIs', reason: 'no utterances for speaker' };
  }

  // Renumber for the model: row 0..N-1 with original text.
  const numbered = indexed.map(({ u }, row) => `[${row}] ${u.text}`).join('\n');
  const promptBody =
    `${RECOVERY_PROMPT}\n\n` +
    `SPEAKER UNDER REVIEW: ${speakerId}\n` +
    `NUMBER OF UTTERANCES IN THIS CLUSTER: ${indexed.length}\n\n` +
    `UTTERANCES (numbered for reference):\n${numbered}`;

  const recoveryTemplate: NoteTemplate = {
    id: 'recovery-speaker',
    name: 'Recovery: speaker',
    description: 'Internal — judges whether a speaker cluster contains 1 or 2 voices.',
    promptBody,
  };

  const { provider } = buildProvider(settings);
  let raw: string;
  try {
    raw = await provider.generateNote({
      transcript: { ...transcript, utterances: [] },
      template: recoveryTemplate,
      pattern: NEUTRAL_PATTERN,
      mode: 'ambient',
      speakerRoles: [],
    });
  } catch (err) {
    console.warn(`${RECOVERY_LOG_PREFIX} call failed for speaker ${speakerId}, keeping as is`, err);
    return { speakerId, decision: 'keepAsIs', reason: 'recovery call failed' };
  }

  let parsed: RecoveryResponse;
  try {
    parsed = JSON.parse(extractJson(raw)) as RecoveryResponse;
  } catch (err) {
    console.warn(`${RECOVERY_LOG_PREFIX} parse failed for speaker ${speakerId}, keeping as is`, {
      error: err,
      raw: raw.slice(0, 200),
    });
    return { speakerId, decision: 'keepAsIs', reason: 'recovery response unparseable' };
  }

  // Explicit keep verdict.
  if (parsed.keepAsIs === true) {
    return {
      speakerId,
      decision: 'keepAsIs',
      reason: (parsed.reason ?? '').trim() || undefined,
    };
  }

  // Validate split shape. Any defect → fall back to keep (safer).
  const rawSplits = parsed.splits ?? [];
  if (rawSplits.length < 2 || rawSplits.length > 2) {
    return {
      speakerId,
      decision: 'keepAsIs',
      reason: `recovery returned ${rawSplits.length} sub-speakers; need exactly 2`,
    };
  }

  // Translate per-speaker indices → global. Reject if any index is out of
  // range, duplicated across sub-speakers, or missing entirely.
  const allRowsExpected = new Set<number>(indexed.map((_, row) => row));
  const seenRows = new Set<number>();
  const splits: RecoverySplit[] = [];
  for (const s of rawSplits) {
    const role = (s.role ?? '').trim().toLowerCase() as RecoverySplit['role'];
    if (!(RECOVERY_VALID_ROLES as readonly string[]).includes(role)) {
      return { speakerId, decision: 'keepAsIs', reason: `invalid role: ${s.role}` };
    }
    const confidence = typeof s.confidence === 'number' ? s.confidence : 0;
    if (confidence < RECOVERY_CONFIDENCE_FLOOR) {
      return {
        speakerId,
        decision: 'keepAsIs',
        reason: `sub-speaker confidence ${confidence} below floor ${RECOVERY_CONFIDENCE_FLOOR}`,
      };
    }
    const rows = (s.indices ?? []).filter((i) => Number.isInteger(i) && allRowsExpected.has(i));
    for (const r of rows) {
      if (seenRows.has(r)) {
        return { speakerId, decision: 'keepAsIs', reason: `duplicate index ${r} across sub-speakers` };
      }
      seenRows.add(r);
    }
    if (rows.length === 0) {
      return { speakerId, decision: 'keepAsIs', reason: `sub-speaker has no valid indices` };
    }
    // Map per-speaker rows back to global transcript indices.
    const globalIndices = rows.map((row) => indexed[row]?.idx).filter((i): i is number => Number.isInteger(i));
    splits.push({
      role,
      indices: globalIndices.sort((a, b) => a - b),
      confidence,
      rationale: (s.rationale ?? '').trim() || undefined,
    });
  }
  // Confirm every per-speaker row was assigned.
  if (seenRows.size !== allRowsExpected.size) {
    return {
      speakerId,
      decision: 'keepAsIs',
      reason: `recovery skipped ${allRowsExpected.size - seenRows.size} utterance(s)`,
    };
  }

  return { speakerId, decision: 'split', splits };
}

/** Top-level recovery: given diarization hints and the transcript, evaluate
 * every candidate speaker and return a list of suggestions. Empty when no
 * banner condition fired. */
async function recoverMergedSpeakers(
  transcript: Transcript,
  hints: DiarizationHints,
  settings: Settings,
): Promise<RecoverySuggestion[]> {
  const { utteranceCountBySpeaker } = summarizeTranscriptSpeakers(transcript.utterances);
  const candidates = selectRecoveryCandidates(hints, utteranceCountBySpeaker);
  if (candidates.length === 0) return [];

  console.info(`${RECOVERY_LOG_PREFIX} evaluating ${candidates.length} candidate speaker(s)`, {
    candidates,
  });

  const suggestions: RecoverySuggestion[] = [];
  // Sequential — typical case is 1–2 candidates and Gemini's quota is per-call.
  for (const sid of candidates) {
    suggestions.push(await evaluateRecoveryForSpeaker(transcript, sid, settings));
  }
  return suggestions;
}

function allUtterancesSingleSegment(transcript: Transcript): PatientSegment {
  return {
    id: 'p0',
    patientLabel: 'Patient',
    visitType: 'other',
    includesPreventiveCare: false,
    acuteConcerns: [],
    chiefComplaint: '',
    relevantUtteranceIndices: transcript.utterances.map((_, i) => i),
  };
}

function filterTranscriptByIndices(transcript: Transcript, indices: number[]): Transcript {
  const sorted = [...indices].sort((a, b) => a - b);
  const utterances = sorted
    .map((i) => transcript.utterances[i])
    .filter((u): u is NonNullable<typeof u> => Boolean(u));
  return { ...transcript, utterances };
}

function patientHeader(seg: PatientSegment): string {
  const visitTypeLabel = seg.visitType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const tail = seg.acuteConcerns.length > 0 ? ` — ${seg.acuteConcerns.join(', ')}` : '';
  return `## ${seg.patientLabel} · ${visitTypeLabel}${tail}`;
}

function segmentContextPreamble(seg: PatientSegment): string {
  const lines = [
    `TARGET PATIENT: ${seg.patientLabel}`,
    `VISIT TYPE: ${seg.visitType}`,
    `INCLUDES PREVENTIVE CARE: ${seg.includesPreventiveCare ? 'YES' : 'NO'}`,
  ];
  if (seg.acuteConcerns.length > 0) {
    lines.push(`ACUTE CONCERNS: ${seg.acuteConcerns.join(', ')}`);
  }
  if (seg.chiefComplaint) lines.push(`CHIEF COMPLAINT: ${seg.chiefComplaint}`);
  lines.push(
    'The transcript below has been filtered to utterances about this patient only. Do not import history, exam findings, or plan items from any other patient. If a statement could refer to a sibling, prefer omission.',
  );
  return lines.join('\n');
}

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

SENSITIVE-CONTENT FLAG (always run this check):
If the transcript discusses suicidality, self-harm, abuse (physical / sexual / emotional / neglect), substance use, sexual activity, eating-disorder behaviors, custody conflicts, intimate partner violence, or other content a parent or chart-recipient should NOT see by default — output exactly ONE line at the end of the issues list:
- 🟡 (sensitive content) [one short phrase naming the topic, e.g., "suicidality discussed", "substance use disclosed"]
This line surfaces the topic so the physician reviews before sharing. Do not redact or omit anything from the actual note — that's the physician's call.

RULES:
- Be conservative. Do not nitpick style or wording.
- Charitable interpretation: assume the physician heard correctly and the transcript is the noisy artifact, NOT the source of truth.
- If there are no meaningful issues AND no sensitive content, return exactly: "No issues found."
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
- (sensitive content)

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
 * QA pass. Run a separate LLM call whose only job is to flag
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

// ---------------------------------------------------------------------------
// Quote capture — verbatim parent / child quotes worth preserving
// ---------------------------------------------------------------------------

const QUOTE_CAPTURE_PROMPT = `You are reviewing a pediatric visit transcript and extracting VERBATIM quotes worth preserving in clinical documentation.

What qualifies as a quote worth capturing:
- A patient or parent statement that captures concern in their own words ("I just don't feel like myself anymore")
- A self-disclosure of safety-relevant content (suicidality, abuse, substance use) — verbatim language is medicolegally important
- A description of symptoms in concrete, specific phrasing the physician will want preserved verbatim
- A child's statement that's clinically meaningful (developmental observation, behavioral disclosure, refusal)
- A caregiver dynamic statement worth preserving exactly ("She tells me what to say")

What does NOT qualify:
- Routine review-of-systems answers
- Generic reassurance from physician or parent
- Filler talk
- Anything paraphrased — only verbatim quotes
- The physician's own statements (this is for patient/parent voice)

HARD RULES:
- Output verbatim ONLY. No paraphrase, no summary.
- Maximum 5 quotes. Better 1-2 sharp quotes than 5 mediocre ones.
- Each quote attributed to who said it: Parent / Patient / Sibling / Other.
- The transcript may have STT errors — if a quote is garbled in a clinically important way, OMIT it rather than guess.
- If nothing qualifies, return exactly: "No quotes captured."

OUTPUT — markdown bullet list, one quote per bullet:
- **Parent:** "exact quoted text here"
- **Patient:** "exact quoted text"`;

export interface QuoteCaptureInput {
  transcript: Transcript;
  mode: RecordingMode;
  settings: Settings;
  speakerRoles?: SpeakerRoleAssignment[];
}

export async function captureQuotes(input: QuoteCaptureInput): Promise<string> {
  const quoteTemplate: NoteTemplate = {
    id: 'quote-capture',
    name: 'Quote Capture',
    description: 'Internal — verbatim quote extraction.',
    promptBody: QUOTE_CAPTURE_PROMPT,
  };
  const { provider } = buildProvider(input.settings);
  const out = await provider.generateNote({
    transcript: input.transcript,
    template: quoteTemplate,
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
 * Enrichment pass scoped to clinical pearls only — 0-3 brief
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
  /**
   * When the note covers multiple patients in one concatenated string
   * (sections separated by horizontal rules), set this so the tweak prompt
   * tells the LLM to preserve every patient's section instead of
   * collapsing to a single primary patient. Only relevant for the "All
   * combined" tab in multi-patient view; one-of-many tweaks pre-scope the
   * note + transcript to the active patient before calling this, so they
   * don't need this flag.
   */
  noteCoversMultiplePatients?: boolean;
}

/**
 * Note revision pass. Take an existing note + the transcript +
 * a free-form physician instruction ("shorten the assessment", "rewrite
 * the plan as a numbered list", "fix the dose to mg/kg") and return a
 * revised note. The transcript still gates fabrication.
 *
 * For a single-patient tweak inside a multi-patient recording, the caller
 * pre-scopes the inputs: pass that segment's note chunk as `note` and the
 * filtered transcript as `transcript` (use `filterTranscriptForSegment`).
 * Leave `noteCoversMultiplePatients` false in that case — the LLM should
 * treat its inputs as a single-patient note.
 */
export async function tweakNote(input: TweakNoteInput): Promise<string> {
  const scopeRule = input.noteCoversMultiplePatients
    ? "- The note covers MULTIPLE patients separated by '---' horizontal rules. Preserve every patient's section header and content unless the instruction explicitly targets every patient (e.g., 'add return precautions to all plans'). Single-patient instructions like 'fix the dose' apply only to the patient that section is about — leave the other patients' sections untouched."
    : "- Keep the note scoped to this encounter's primary patient.";
  const tweakTemplate: NoteTemplate = {
    id: 'tweak',
    name: 'Tweak',
    description: 'Internal — physician-directed revision.',
    promptBody: `You are revising an existing pediatric outpatient note based on a physician instruction.
Keep the note faithful to the transcript.

HARD RULES:
- Do not invent history, exam findings, vitals, or diagnoses not supported by the transcript.
${scopeRule}
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

/**
 * Convenience wrapper around `filterTranscriptByIndices` for callers that
 * have a PatientSegment but not the indices array directly. Used by the
 * multi-patient tabbed Review to pre-scope the transcript before tweak /
 * pearls / quotes calls so the LLM only sees one patient's utterances.
 */
export function filterTranscriptForSegment(
  transcript: Transcript,
  segment: { relevantUtteranceIndices: number[] },
): Transcript {
  return filterTranscriptByIndices(transcript, segment.relevantUtteranceIndices);
}

// Re-export composeNotePrompt for tests / dev tooling
export { composeNotePrompt };
