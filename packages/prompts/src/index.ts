import soapTemplate from './templates/soap.json' with { type: 'json' };
import wellChildTemplate from './templates/well-child.json' with { type: 'json' };
import sickVisitTemplate from './templates/sick-visit.json' with { type: 'json' };
import followUpTemplate from './templates/follow-up.json' with { type: 'json' };
import adhdMedCheckTemplate from './templates/adhd-med-check.json' with { type: 'json' };
import procedureTemplate from './templates/procedure.json' with { type: 'json' };
import dictationTemplate from './templates/dictation.json' with { type: 'json' };
import narrativePattern from './patterns/narrative.json' with { type: 'json' };

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  promptBody: string;
}

export interface NotePattern {
  id: string;
  name: string;
  description: string;
  promptModifier: string;
}

const templates: ReadonlyArray<NoteTemplate> = [
  soapTemplate as NoteTemplate,
  wellChildTemplate as NoteTemplate,
  sickVisitTemplate as NoteTemplate,
  followUpTemplate as NoteTemplate,
  adhdMedCheckTemplate as NoteTemplate,
  procedureTemplate as NoteTemplate,
  dictationTemplate as NoteTemplate,
];
const patterns: ReadonlyArray<NotePattern> = [narrativePattern as NotePattern];

export function listTemplates(): ReadonlyArray<NoteTemplate> {
  return templates;
}

export function listPatterns(): ReadonlyArray<NotePattern> {
  return patterns;
}

export function getTemplate(id: string): NoteTemplate | undefined {
  return templates.find((t) => t.id === id);
}

export function getPattern(id: string): NotePattern | undefined {
  return patterns.find((p) => p.id === id);
}
