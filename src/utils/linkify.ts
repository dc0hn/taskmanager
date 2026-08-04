// ============================================================================
// Finding links in a note
//
// Notes are stored as PLAIN TEXT and links are found at display time. The obvious
// alternative — storing markup, or converting to HTML on save — would mean a note is
// a document that can contain elements, and every future reader of that field would
// have to be trusted to render it safely. Keeping the stored form inert means the
// worst a note can do is look wrong.
//
// So nothing here produces HTML. `linkify` returns SEGMENTS, and the component maps
// them to React nodes, which escapes the text for free. There is no path from a note
// to `dangerouslySetInnerHTML`, and there should never be one.
// ============================================================================

export interface TextSegment {
  kind: 'text';
  value: string;
}

export interface LinkSegment {
  kind: 'link';
  /** What to show — the original text, untouched. */
  value: string;
  /** Where it goes. Vetted again in Rust before anything is opened. */
  href: string;
}

export type Segment = TextSegment | LinkSegment;

/**
 * The matcher. Deliberately dull.
 *
 * Only `http://` and `https://`, and it is worth being explicit about why: a note is
 * text a person pasted, and a scheme like `file://` or an app's custom handler would
 * hand the operating system something that opens a document or launches a program.
 * Every meeting link in practice — Zoom, Meet, Teams, Webex — is https, so the
 * restriction costs nothing real and removes the whole category.
 *
 * No nested quantifiers, so there is no input that makes this backtrack badly. The
 * character class simply runs until it hits whitespace or something that cannot be
 * inside a URL.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * Characters that are common sentence punctuation AND legal in a URL.
 *
 * "The call is at https://zoom.us/j/123." should not link the full stop. Trailing
 * punctuation is trimmed back off the match, but only from the end, so a trailing
 * slash or a query string survives intact.
 */
const TRAILING = /[.,;:!?]+$/;

/**
 * Trim a bracket from the end only when it has no opener inside the match.
 *
 * A wrapped link — "(see https://example.com/a)" — must not keep the closing paren,
 * while a link that legitimately contains a balanced pair must. Confluence and
 * Wikipedia URLs both do this, and cutting them produces a link that resolves to the
 * wrong page rather than one that visibly fails.
 */
function trimUnbalanced(url: string, open: string, close: string): string {
  let out = url;
  while (out.endsWith(close)) {
    const opens = out.split(open).length - 1;
    const closes = out.split(close).length - 1;
    if (opens >= closes) break;
    out = out.slice(0, -1);
  }
  return out;
}

function tidy(match: string): string {
  let url = match.replace(TRAILING, '');
  url = trimUnbalanced(url, '(', ')');
  url = trimUnbalanced(url, '[', ']');
  return url;
}

/**
 * Split text into runs of plain text and links, in order.
 *
 * Every character of the input appears in exactly one segment, so joining the values
 * back together reproduces the original exactly. That property is what makes this safe
 * to render directly: nothing is dropped, nothing is invented, and a note that
 * contains no links comes back as a single text segment.
 */
export function linkify(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  // `matchAll` rather than a loop over `exec`, which needs the regex's `lastIndex`
  // reset by hand and shares that state across calls when the pattern is module-level.
  for (const match of text.matchAll(URL_PATTERN)) {
    const at = match.index ?? 0;
    const raw = match[0];
    const href = tidy(raw);

    if (at > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, at) });
    }
    segments.push({ kind: 'link', value: href, href });

    // The punctuation `tidy` trimmed is text, not part of the link, so it goes back.
    cursor = at + href.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }
  return segments;
}

/** Whether a note holds anything at all. Whitespace is not content. */
export function hasNotes(notes: string | undefined): boolean {
  return typeof notes === 'string' && notes.trim().length > 0;
}

/** The first link in a note, for the one-click join. */
export function firstLink(notes: string | undefined): string | null {
  if (!notes) return null;
  for (const s of linkify(notes)) {
    if (s.kind === 'link') return s.href;
  }
  return null;
}
