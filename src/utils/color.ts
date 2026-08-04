import type { CategoryDef } from '../types';
import { UNKNOWN_CATEGORY } from '../types';

// ============================================================================
// Colour derivation
//
// A category stores exactly one colour: its accent. Every other shade the UI
// needs is computed from it here. That is what makes user-defined categories
// safe — whatever accent someone picks, the derived block fill stays dark enough
// to sit on the near-black surface and the derived text stays light enough to
// read on that fill. There is no way to configure an unreadable block.
// ============================================================================

export interface CategoryColors {
  /** Bar, dot, border, active label. The stored accent, unmodified. */
  accent: string;
  /** Block / chip background — accent at low alpha over the dark surface. */
  fill: string;
  /** Slightly stronger fill, for hover and active chips. */
  fillStrong: string;
  /** Hairline border in the accent's hue. */
  line: string;
  /** Readable title text on `fill`. Accent lifted toward white. */
  text: string;
  /** Dimmer companion to `text`, for times and metadata. */
  textDim: string;
  /** Glow used on the active/selected state. */
  glow: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const FALLBACK: Rgb = { r: 139, g: 147, b: 167 };

/** Parse #rgb / #rrggbb. Anything unparseable falls back to neutral slate. */
export function hexToRgb(hex: string): Rgb {
  if (typeof hex !== 'string') return FALLBACK;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return FALLBACK;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix toward white by `amount` (0..1). */
function lighten(rgb: Rgb, amount: number): Rgb {
  return {
    r: rgb.r + (255 - rgb.r) * amount,
    g: rgb.g + (255 - rgb.g) * amount,
    b: rgb.b + (255 - rgb.b) * amount,
  };
}

/** Relative luminance, per WCAG. Used to normalise text lift across hues. */
export function luminance(rgb: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

/**
 * Derive the full shade set from a single accent.
 *
 * The text lift is luminance-aware rather than a fixed percentage: a dark violet
 * needs a much bigger push toward white than an already-bright yellow to land at
 * comparable readability. Without this, `#facc15` text comes out glaring while
 * `#8b7cf6` text comes out muddy.
 */
export function deriveCategoryColors(accent: string): CategoryColors {
  const rgb = hexToRgb(accent);
  const lum = luminance(rgb);

  // Bright accents (yellow, lime) need almost no lift; dark ones need a lot.
  const lift = Math.max(0.12, Math.min(0.62, 0.62 - lum * 0.9));
  const text = rgbToHex(lighten(rgb, lift));
  const textDim = rgbToHex(lighten(rgb, lift * 0.55));

  const { r, g, b } = rgb;
  return {
    accent,
    // Category colour is ANNOTATION, not decoration. These fills are deliberately
    // faint — a block should read as tinted paper with a coloured margin rule, so
    // that amber (the one signal colour) stays the loudest thing on screen. At
    // the previous 0.16/0.26 the grid became a stack of coloured slabs and the
    // now-line had to compete with them.
    fill: `rgba(${r}, ${g}, ${b}, 0.075)`,
    fillStrong: `rgba(${r}, ${g}, ${b}, 0.16)`,
    line: `rgba(${r}, ${g}, ${b}, 0.28)`,
    text,
    textDim,
    glow: `rgba(${r}, ${g}, ${b}, 0.22)`,
  };
}

/**
 * Resolve a category id against the live list. An id that no longer exists (the
 * category was deleted while blocks still referenced it) resolves to a neutral
 * placeholder rather than throwing or dropping the record.
 */
export function resolveCategory(
  id: string | undefined,
  categories: CategoryDef[]
): CategoryDef {
  if (!id) return UNKNOWN_CATEGORY;
  return categories.find((c) => c.id === id) ?? UNKNOWN_CATEGORY;
}

/** Memoised colour lookup, keyed by accent so it survives category reordering. */
const colorCache = new Map<string, CategoryColors>();

export function colorsFor(accent: string): CategoryColors {
  const hit = colorCache.get(accent);
  if (hit) return hit;
  const derived = deriveCategoryColors(accent);
  colorCache.set(accent, derived);
  return derived;
}

/** Convenience: resolve a category id straight to its colours. */
export function categoryColors(
  id: string | undefined,
  categories: CategoryDef[]
): CategoryColors {
  return colorsFor(resolveCategory(id, categories).accent);
}

/**
 * Turn a label into a stable, collision-free category id.
 * "Music practice" -> "music-practice", then "-2", "-3" on collision.
 */
export function slugifyCategoryId(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'category';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 999; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
