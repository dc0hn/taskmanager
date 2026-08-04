import { describe, it, expect } from 'vitest';
import { firstLink, hasNotes, linkify } from './utils/linkify';

// ============================================================================
// Notes are plain text and links are found at display time, so this is the only
// thing standing between what someone pasted and what they get to click. The
// property that matters most is at the bottom: segments must reproduce the input
// exactly, because that is what makes rendering them directly safe.
// ============================================================================

const links = (text: string) =>
  linkify(text)
    .filter((s) => s.kind === 'link')
    .map((s) => s.value);

describe('finding links', () => {
  it('finds a bare link', () => {
    expect(links('https://meet.google.com/abc-defg-hij')).toEqual([
      'https://meet.google.com/abc-defg-hij',
    ]);
  });

  it('finds a link inside a sentence', () => {
    expect(links('Standup is at https://zoom.us/j/123 every morning')).toEqual([
      'https://zoom.us/j/123',
    ]);
  });

  it('finds several', () => {
    expect(links('https://a.com and https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('keeps the query string, which is where meeting passwords live', () => {
    // Trimming this would produce a link that opens and then rejects you, which is
    // worse than one that visibly fails.
    expect(links('https://zoom.us/j/9?pwd=Aa1.Bb2')).toEqual([
      'https://zoom.us/j/9?pwd=Aa1.Bb2',
    ]);
  });

  it('leaves sentence punctuation out of the link', () => {
    expect(links('Call is on https://zoom.us/j/123.')).toEqual(['https://zoom.us/j/123']);
    expect(links('Use https://a.com, then https://b.com!')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('drops a wrapping bracket but keeps a balanced one', () => {
    // Wikipedia and Confluence both produce the second kind, and cutting the paren
    // gives a link that resolves to the wrong page rather than failing.
    expect(links('(see https://example.com/a)')).toEqual(['https://example.com/a']);
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });
});

describe('what is not a link', () => {
  it('ignores every scheme but http and https', () => {
    // The allowlist. `open` acts on all of these, and a note is text that can be
    // pasted from anywhere.
    for (const text of [
      'file:///Users/someone/.ssh/id_rsa',
      'mailto:someone@example.com',
      'ftp://example.com/x',
      'javascript:alert(1)',
      'zoommtg://zoom.us/join?confno=1',
    ]) {
      expect(links(text), text).toEqual([]);
    }
  });

  it('ignores something that merely mentions a domain', () => {
    expect(links('ask on zoom.us later')).toEqual([]);
  });

  it('stops at whitespace rather than swallowing the rest of the line', () => {
    expect(links('https://example.com and more words')).toEqual(['https://example.com']);
  });

  it('will not take a quote or an angle bracket into a link', () => {
    // These are the characters that would matter if a note ever reached an HTML
    // renderer. It does not, and this keeps it that way.
    expect(links('https://example.com"onmouseover=x')).toEqual(['https://example.com']);
    expect(links('https://example.com<script>')).toEqual(['https://example.com']);
  });
});

describe('segments', () => {
  it('reproduces the input exactly when joined', () => {
    // THE property. Segments are rendered straight into React nodes, so anything
    // dropped disappears from the note and anything invented appears in it.
    for (const text of [
      'plain text with no links at all',
      'https://a.com',
      'before https://a.com after',
      'https://a.com https://b.com',
      'trailing punctuation https://a.com.',
      '(https://a.com)',
      '',
      'https://en.wikipedia.org/wiki/Foo_(bar) done',
    ]) {
      expect(linkify(text).map((s) => s.value).join(''), text).toBe(text);
    }
  });

  it('returns one text segment when there is nothing to link', () => {
    expect(linkify('just a thought')).toEqual([
      { kind: 'text', value: 'just a thought' },
    ]);
  });

  it('returns nothing at all for an empty note', () => {
    expect(linkify('')).toEqual([]);
  });

  it('gives the punctuation back as text, not as part of the link', () => {
    expect(linkify('go to https://a.com.')).toEqual([
      { kind: 'text', value: 'go to ' },
      { kind: 'link', value: 'https://a.com', href: 'https://a.com' },
      { kind: 'text', value: '.' },
    ]);
  });
});

describe('hasNotes', () => {
  it('treats whitespace as empty', () => {
    expect(hasNotes('   \n  ')).toBe(false);
    expect(hasNotes('')).toBe(false);
    expect(hasNotes(undefined)).toBe(false);
    expect(hasNotes('x')).toBe(true);
  });
});

describe('firstLink', () => {
  it('takes the first, so the join button is predictable', () => {
    expect(firstLink('notes https://a.com then https://b.com')).toBe('https://a.com');
  });

  it('is null when there is nothing to open', () => {
    expect(firstLink('dial in from the office')).toBeNull();
    expect(firstLink(undefined)).toBeNull();
    expect(firstLink('')).toBeNull();
  });
});
