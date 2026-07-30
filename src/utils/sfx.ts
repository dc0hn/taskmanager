// ============================================================================
// sfx — chiptune blips, synthesised at runtime
//
// No audio files anywhere. The CSP forbids external assets, and bundling even
// small samples would put megabytes into an app whose entire selling point is
// being a few hundred kilobytes that works offline. So every sound here is a
// square wave built by WebAudio at the moment it plays — a few lines of maths
// instead of an asset pipeline.
//
// Square waves are also the honest choice for the look we're going for: an 8-bit
// readout should sound like one, and a square oscillator IS the NES sound.
//
// Silent until switched on. A desktop tool that sits open all day must never make
// a noise the user did not ask for, and the first tick of a block should not
// announce itself in a meeting.
// ============================================================================

let ctx: AudioContext | null = null;
let enabled = false;

export function setSfxEnabled(on: boolean): void {
  enabled = on;
  // Don't construct an AudioContext until sound is actually wanted — browsers
  // count them as a resource and some warn about unused ones.
  if (!on && ctx) {
    void ctx.close().catch(() => {});
    ctx = null;
  }
}

export function isSfxEnabled(): boolean {
  return enabled;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // Autoplay policy suspends a context created before a gesture; resuming is
    // harmless when it is already running.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

interface Note {
  /** Hertz. */
  freq: number;
  /** Seconds from the start of the sequence. */
  at: number;
  /** Seconds. */
  dur: number;
  gain?: number;
  type?: OscillatorType;
}

/**
 * Play a short sequence.
 *
 * Each note gets its own oscillator and gain, with a fast attack and an
 * exponential release — a raw square with no envelope clicks audibly at both ends.
 */
function play(notes: Note[]): void {
  const ac = audio();
  if (!ac) return;
  try {
    const now = ac.currentTime;
    for (const n of notes) {
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.type = n.type ?? 'square';
      osc.frequency.value = n.freq;

      const start = now + n.at;
      const peak = (n.gain ?? 0.06);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(peak, start + 0.006);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);

      osc.connect(amp).connect(ac.destination);
      osc.start(start);
      osc.stop(start + n.dur + 0.02);
    }
  } catch {
    // Audio is a garnish. It never interrupts anything.
  }
}

// Note frequencies, so the sequences below read musically rather than numerically.
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.5;
const G6 = 1568.0;
const A4 = 440.0;

/** A single completed block. Deliberately tiny — this fires many times a day. */
export function sfxComplete(): void {
  play([
    { freq: G5, at: 0, dur: 0.05, gain: 0.05 },
    { freq: C6, at: 0.05, dur: 0.07, gain: 0.05 },
  ]);
}

/**
 * Combo step. Pitch rises with the run, so the sound itself tells you the streak
 * is climbing without anyone having to read a number.
 */
export function sfxCombo(run: number): void {
  const step = Math.min(Math.max(run, 1), 5);
  play([{ freq: C6 * Math.pow(1.12, step), at: 0, dur: 0.05, gain: 0.045 }]);
}

/** A level gained, without the takeover. */
export function sfxLevel(): void {
  play([
    { freq: C5, at: 0, dur: 0.07 },
    { freq: E5, at: 0.07, dur: 0.07 },
    { freq: G5, at: 0.14, dur: 0.07 },
    { freq: C6, at: 0.21, dur: 0.13 },
  ]);
}

/** An arc capstone — every tenth level. A fifth above the ordinary fanfare. */
export function sfxMilestone(): void {
  play([
    { freq: C5, at: 0, dur: 0.08 },
    { freq: G5, at: 0.08, dur: 0.08 },
    { freq: C6, at: 0.16, dur: 0.08 },
    { freq: E6, at: 0.24, dur: 0.08 },
    { freq: G6, at: 0.32, dur: 0.22 },
  ]);
}

/** Completing a 60-level cycle. The longest sound in the app, and the rarest. */
export function sfxPrestige(): void {
  play([
    { freq: C5, at: 0, dur: 0.1 },
    { freq: E5, at: 0.1, dur: 0.1 },
    { freq: G5, at: 0.2, dur: 0.1 },
    { freq: C6, at: 0.3, dur: 0.1 },
    { freq: E6, at: 0.4, dur: 0.1 },
    { freq: G6, at: 0.5, dur: 0.32, gain: 0.07 },
    // A triangle underneath thickens it without turning the square wave to mush.
    { freq: C5, at: 0.5, dur: 0.32, gain: 0.05, type: 'triangle' },
  ]);
}

/** Day cleared. Two rising thirds, warmer than the level fanfare. */
export function sfxDayCleared(): void {
  play([
    { freq: E5, at: 0, dur: 0.08, type: 'triangle', gain: 0.06 },
    { freq: G5, at: 0.08, dur: 0.08, type: 'triangle', gain: 0.06 },
    { freq: C6, at: 0.16, dur: 0.18, type: 'triangle', gain: 0.06 },
  ]);
}

/** Spending brass. A low mechanical clunk, not a chime. */
export function sfxSpend(): void {
  play([
    { freq: A4, at: 0, dur: 0.05, gain: 0.05, type: 'triangle' },
    { freq: A4 / 2, at: 0.05, dur: 0.09, gain: 0.05, type: 'triangle' },
  ]);
}
