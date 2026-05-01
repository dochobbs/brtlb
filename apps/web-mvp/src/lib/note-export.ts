export interface NoteSection {
  /** Section heading text - "HPI", "Exam", "Plan", etc. */
  label: string;
  /** Section body without the heading line. */
  body: string;
}

/**
 * Split a markdown note into discrete sections by heading. Recognizes both
 * `## Heading` and `**Heading**` styles since brtlb's templates use a mix.
 * Sections without bodies are skipped. Returns an empty array if no headings
 * were detected.
 */
export function splitNoteIntoSections(md: string): NoteSection[] {
  if (!md.trim()) return [];
  const lines = md.split('\n');
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;

  const hashHeading = /^#{1,3}\s+(.+?)\s*$/;
  const boldHeading = /^\s*\*\*([^*\n]+?)\*\*\s*$/;

  for (const line of lines) {
    const hashMatch = hashHeading.exec(line);
    const boldMatch = boldHeading.exec(line);
    const match = hashMatch ?? boldMatch;
    if (match) {
      if (current && current.body.trim()) sections.push(current);
      current = { label: match[1]!.trim(), body: '' };
      continue;
    }
    if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current && current.body.trim()) sections.push(current);

  return sections.map((s) => ({ label: s.label, body: s.body.replace(/^\n+|\n+$/g, '') }));
}

/**
 * Lightweight markdown to HTML for clipboard rich-text. Subset only:
 * bold, italic, lists, headings, line breaks. Enough to preserve bolded
 * abnormal exam findings when pasted into rich-text-aware destinations.
 */
export function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<![*])\*([^*\n]+?)\*(?![*])/g, '<em>$1</em>');
  html = html.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (_match, group: string) => {
    const items = group
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^- /, '')}</li>`)
      .join('');
    return `\n<ul>${items}</ul>`;
  });
  html = html.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (_match, group: string) => {
    const items = group
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `\n<ol>${items}</ol>`;
  });
  html = html
    .split(/\n{2,}/)
    .map((para) => {
      if (/^\s*<(h\d|ul|ol|li|p|blockquote|hr)/i.test(para)) return para;
      const trimmed = para.trim();
      if (!trimmed) return '';
      return `<p>${trimmed.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');

  return html;
}

/**
 * Best-effort markdown to plain text for the clipboard plain fallback and
 * for .txt downloads. Strips markdown sigils, leaves words intact.
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[a-zA-Z0-9]*\n?/g, '')
    .replace(/`/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<![*])\*([^*\n]+?)\*(?![*])/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Copy the note to the clipboard with BOTH HTML and plain-text payloads.
 * EHRs that accept formatted paste keep the bold; everything else falls
 * back to plain text. Returns true on success.
 */
export async function copyNoteRich(md: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  const html = markdownToHtml(md);
  const plain = markdownToPlainText(md);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch {
      // Fall through to plain-text path
    }
  }
  if (navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(plain);
    return true;
  }
  return false;
}

/**
 * Build a mailto: URL with the note pre-filled as the body. Subject is the
 * visit label when available. Mailto bodies have practical length limits
 * (~2000 chars across clients), longer notes may be truncated by the OS
 * mail handler.
 */
export function mailtoForNote(note: string, subject: string, recipient = ''): string {
  const cleanSubject = subject.trim() || 'brtlb visit note';
  const plain = markdownToPlainText(note);
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(cleanSubject)}&body=${encodeURIComponent(plain)}`;
}
