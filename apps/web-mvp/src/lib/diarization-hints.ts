/**
 * Diarization quality hints derived from the AssemblyAI transcript + the
 * stage-1 identify response. Surfaced in the Review screen as banners so
 * silent diarization failures (the same-gender / merged-speaker class) become
 * visible to the clinician before they trust the note.
 *
 * See docs/design-diarization-banners.md for the design and the validation
 * eval at eval-fixtures/diarization-validation/eval_banners.py.
 */

export type CollapseReason = 'low_conf' | 'omitted' | 'other_role_substantive';

export interface DiarizationCollapseSuspect {
  speakerId: string;
  reason: CollapseReason;
}

export interface DiarizationHints {
  /** Banner 1: AssemblyAI returned suspiciously few unique speakers. */
  lowSpeakerCount: boolean;
  /** Banner 2: one of the returned speakers likely contains multiple voices. */
  collapseSuspected: DiarizationCollapseSuspect[];
}

export const EMPTY_DIARIZATION_HINTS: DiarizationHints = {
  lowSpeakerCount: false,
  collapseSuspected: [],
};

/** A single entry from the identify LLM's raw `speakers` array, BEFORE the
 * confidence/role filter. */
export interface RawIdentifySpeaker {
  speakerId: string;
  role: string; // raw lowercase — may not be a valid SpeakerRole
  confidence: number;
}

export interface ComputeDiarizationHintsInput {
  /** Distinct speakerIds present in the AssemblyAI transcript. */
  transcriptSpeakerIds: string[];
  /** Utterance count per speakerId. Filler-only speakers (< 3 utts) don't
   * trigger banners regardless of identify behavior. */
  utteranceCountBySpeaker: ReadonlyMap<string, number>;
  /** What we sent AssemblyAI as `speakers_expected`. 0 / omitted means we
   * didn't hint. Production hardcodes 4 at pipeline-browser.ts. */
  speakersExpectedHint: number;
  /** Number of patients identify resolved confidently (post 0.6 filter). */
  identifiedPatientCount: number;
  /** Speakers identify kept after its own filter. We need this to detect
   * the "other-role-substantive" case. */
  keptSpeakers: ReadonlyArray<{ speakerId: string; role: string }>;
  /** Raw speakers array from identify, BEFORE filtering. Used to detect
   * low-conf drops and silent omissions. */
  rawIdentifySpeakers: ReadonlyArray<RawIdentifySpeaker>;
}

const SUBSTANTIVE_UTTERANCE_FLOOR = 3;
const HINT_GAP_FLOOR = 2;
const PATIENTS_MULTI_FLOOR = 2;
const CONFIDENCE_FLOOR = 0.6;

export function computeDiarizationHints(input: ComputeDiarizationHintsInput): DiarizationHints {
  const detected = input.transcriptSpeakerIds.length;

  // === Banner 1: count anomaly ===
  // Two OR'd triggers; either fires.
  const hintGap =
    input.speakersExpectedHint > 0 &&
    input.speakersExpectedHint - detected >= HINT_GAP_FLOOR;
  const patientsFloor =
    input.identifiedPatientCount >= PATIENTS_MULTI_FLOOR &&
    detected < input.identifiedPatientCount + 1;
  const lowSpeakerCount = hintGap || patientsFloor;

  // === Banner 2: within-count merge suspected ===
  const collapseSuspected: DiarizationCollapseSuspect[] = [];
  const transcriptSpeakerSet = new Set(input.transcriptSpeakerIds);
  const returnedIdSet = new Set(input.rawIdentifySpeakers.map((s) => s.speakerId));

  // (1) Low-confidence drops — speaker in transcript, ≥3 utts, conf < floor.
  for (const raw of input.rawIdentifySpeakers) {
    if (
      raw.confidence < CONFIDENCE_FLOOR &&
      transcriptSpeakerSet.has(raw.speakerId) &&
      (input.utteranceCountBySpeaker.get(raw.speakerId) ?? 0) >= SUBSTANTIVE_UTTERANCE_FLOOR
    ) {
      collapseSuspected.push({ speakerId: raw.speakerId, reason: 'low_conf' });
    }
  }

  // (2) Silent omissions — speakerId in transcript with ≥3 utts but absent
  // from identify's response entirely.
  for (const sid of input.transcriptSpeakerIds) {
    if (
      !returnedIdSet.has(sid) &&
      (input.utteranceCountBySpeaker.get(sid) ?? 0) >= SUBSTANTIVE_UTTERANCE_FLOOR
    ) {
      collapseSuspected.push({ speakerId: sid, reason: 'omitted' });
    }
  }

  // (3) "Other" role with ≥3 utterances. In a peds visit, "other" should be
  // a 1–2 line cameo (front-desk / MA). A substantial "other" cluster is
  // nearly always a collapse fragment or unexpected participant.
  for (const kept of input.keptSpeakers) {
    if (
      kept.role === 'other' &&
      (input.utteranceCountBySpeaker.get(kept.speakerId) ?? 0) >= SUBSTANTIVE_UTTERANCE_FLOOR
    ) {
      collapseSuspected.push({
        speakerId: kept.speakerId,
        reason: 'other_role_substantive',
      });
    }
  }

  return { lowSpeakerCount, collapseSuspected };
}

/** Convenience: derive utterance counts and unique speakerIds from a
 * Transcript so callers don't have to. */
export function summarizeTranscriptSpeakers(utterances: ReadonlyArray<{ speakerId: string }>): {
  transcriptSpeakerIds: string[];
  utteranceCountBySpeaker: Map<string, number>;
} {
  const counts = new Map<string, number>();
  for (const u of utterances) {
    if (!u.speakerId) continue;
    counts.set(u.speakerId, (counts.get(u.speakerId) ?? 0) + 1);
  }
  return {
    transcriptSpeakerIds: [...counts.keys()].sort(),
    utteranceCountBySpeaker: counts,
  };
}
