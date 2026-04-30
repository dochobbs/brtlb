import {
  createAnthropicProvider,
  createGeminiApiKeyProvider,
  createOpenAiCompatibleProvider,
  type LlmProvider,
} from '@brtlb/pipeline';
import type { Settings } from '../store';

/**
 * Meta-prompt that turns a clinician's rough description into a structured
 * brtlb-style template body. Bakes in the same fabrication rules,
 * consistency check, and house style we use for the built-in templates so
 * custom templates inherit the safety floor by construction.
 */
const POLISH_META_PROMPT = `You are a pediatric medical-scribe prompt engineer. The clinician below has described, in rough English, the kind of note they want to generate. Rewrite their description into a polished, production-grade prompt body in the brtlb house style.

OUTPUT REQUIREMENTS — your rewritten prompt MUST include all of these blocks:

1. Opening line that frames the role: "You are an expert pediatric medical scribe…" with a one-sentence description of the visit type.
2. DOCUMENTATION PRINCIPLES (5 numbered items): document only what was discussed/observed; be specific only when the transcript supports it; use parent's wording when clarifying; keep scoped to this child; prefer omission over fabrication.
3. FABRICATION RULES — bullet list, MUST include:
   - Never invent vitals, durations, dosages, screening results, milestones, exam findings, or vaccines.
   - Never invent anatomic location or laterality. Match the transcript exactly; omit if unclear.
   - Do not narrow a diagnosis past what the transcript supports. (Add 1–2 concrete examples relevant to the visit type the clinician described, if appropriate.)
   - Plus any visit-specific "never invent" items (e.g., screening tool scores for behavioral, procedural steps for procedures).
4. ENCOUNTER FRAMING — short note about handling combined visits if relevant to this template (e.g., well-child plus acute).
5. MULTI-PATIENT SAFETY — one or two lines: ignore sibling/parent symptoms unless they explain this child's care; prefer neutral wording when ambiguous.
6. FORMAT RULES — list of sections with bold markdown headers (e.g., **Subjective**, **Exam**, **Assessment**, **Plan**). Each section says briefly what to put in it. Use the clinician's section preferences from their description; if they didn't specify, pick sensible defaults for the visit type.
7. CONSISTENCY CHECK BEFORE FINALIZING — short bullet list of checks: anatomic locations match across sections; every bolded abnormal exam finding appears in Assessment or is flagged incidental/stable; no diagnosis more specific than the transcript; Plan and Anticipatory Guidance don't duplicate.
8. ATTRIBUTION — one line: use the speaker labels provided; flag weight-based dosing for clinician verification rather than computing it.
9. Final line: "Return the note as markdown."

STYLE GUIDANCE for the prompt you produce:
- Confident, experienced voice. Imperative mood. No hedging.
- Use **bold** for section headers.
- No emojis.
- Roughly 2,000–4,500 characters total — long enough to be specific, short enough not to bloat latency.
- Do NOT include the transcript itself, the patient name, or anything PHI-shaped.
- Do NOT echo back this meta-prompt.

Output ONLY the rewritten prompt body — no preamble like "Here is the prompt:", no commentary, no markdown code fences.`;

function buildProvider(settings: Settings): LlmProvider {
  if (settings.provider === 'anthropic') {
    return createAnthropicProvider({
      kind: 'anthropic',
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
    });
  }
  if (settings.provider === 'gemini-api-key') {
    return createGeminiApiKeyProvider({
      kind: 'gemini-api-key',
      apiKey: settings.geminiApiKey,
      model: settings.geminiModel,
      maxOutputTokens: 4096,
    });
  }
  return createOpenAiCompatibleProvider({
    kind: 'openai-compatible',
    apiKey: settings.openaiApiKey,
    model: settings.openaiModel,
    maxTokens: 4096,
    ...(settings.openaiBaseUrl ? { baseUrl: settings.openaiBaseUrl } : {}),
  });
}

/**
 * Returns the polished prompt text. Throws if the user has no LLM key
 * configured or the call fails.
 */
export async function polishTemplatePrompt(
  rough: string,
  settings: Settings,
  templateName: string,
): Promise<string> {
  if (!rough.trim()) throw new Error('Add some description before polishing.');

  // Soft check that an LLM is configured. We rely on the same provider the
  // user generates notes with so polishing costs are predictable.
  if (settings.provider === 'gemini-api-key' && !settings.geminiApiKey) {
    throw new Error('Add a Gemini API key in Settings before polishing.');
  }
  if (settings.provider === 'openai-compatible' && !settings.openaiApiKey) {
    throw new Error('Add an OpenAI key in Settings before polishing.');
  }
  if (settings.provider === 'anthropic' && !settings.anthropicApiKey) {
    throw new Error('Add an Anthropic key in Settings before polishing.');
  }

  const provider = buildProvider(settings);
  const userBlock = `TEMPLATE NAME: ${templateName.trim() || '(untitled)'}\n\nROUGH DESCRIPTION FROM CLINICIAN:\n${rough.trim()}`;

  // We piggy-back on generateNote so we hit the same provider path as note
  // generation. The "transcript" carries our meta-prompt + rough text; the
  // template body is the polish instructions; pattern is empty.
  const result = await provider.generateNote({
    transcript: {
      id: 'polish',
      recordingId: 'polish',
      utterances: [
        {
          speakerId: 'A',
          role: 'provider',
          startMs: 0,
          endMs: 1,
          text: userBlock,
          confidence: 1,
        },
      ],
      createdAt: new Date().toISOString(),
    },
    template: {
      id: 'template-polish',
      name: 'Template Polish',
      description: '',
      promptBody: POLISH_META_PROMPT,
    },
    pattern: { id: 'none', name: 'None', description: '', promptModifier: '' },
    mode: 'dictation',
    speakerRoles: [],
  });

  // Defensive cleanup: strip code fences and any leading "Here is…" preamble
  // some models slip in despite explicit instructions.
  return result
    .replace(/^```(?:markdown|md|text)?\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^\s*Here(?:'s| is)[^\n]*\n+/i, '')
    .trim();
}
