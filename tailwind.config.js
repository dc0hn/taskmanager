/** @type {import('tailwindcss').Config} */

// ============================================================================
// "Instrument" — warm graphite chassis, bone action, one amber signal.
//
// The legacy token NAMES (paper-*, ink-*, rule-*) are kept and remapped onto the
// new palette on purpose: every existing `bg-paper-2` / `text-ink-2` in the
// components picks up the new direction without a find-and-replace across twenty
// files. New work should prefer the semantic names — chassis, bone, signal.
// ============================================================================

const chassis = {
  0: '#0d0d0c',
  1: '#131312',
  2: '#191918',
  3: '#21211f',
  4: '#2a2a27',
  5: '#35342f',
};

const bone = {
  0: '#f5f2ec',
  1: '#ddd8ce',
  2: '#a8a29a',
  3: '#8b857c', // AA floor for small text
  4: '#5c5750', // decoration only
  5: '#3d3a35',
};

const rules = {
  1: 'rgba(245,242,236,0.055)',
  2: 'rgba(245,242,236,0.095)',
  3: 'rgba(245,242,236,0.16)',
  4: 'rgba(245,242,236,0.30)',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        sans: [
          '"Instrument Sans Variable"',
          '"Instrument Sans"',
          '-apple-system',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono Variable"',
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },

      fontSize: {
        nano: ['0.625rem', { lineHeight: '1.3', letterSpacing: '0.02em' }],
        micro: ['0.6875rem', { lineHeight: '1.35' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.5' }],
        body: ['0.875rem', { lineHeight: '1.5' }],
        heading: ['1rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        title: ['1.1875rem', { lineHeight: '1.2', letterSpacing: '-0.015em' }],
        'display-sm': ['1.875rem', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
        display: ['2.75rem', { lineHeight: '0.98', letterSpacing: '-0.025em' }],
      },

      colors: {
        chassis,
        bone,
        signal: {
          DEFAULT: '#ffb01f',
          bright: '#ffc65a',
          dim: 'rgba(255,176,31,0.13)',
          line: 'rgba(255,176,31,0.40)',
        },
        action: {
          DEFAULT: '#f0ece3',
          hover: '#fffdf8',
          ink: '#14140f',
        },
        good: { DEFAULT: '#6fbf8b', soft: 'rgba(111,191,139,0.13)' },
        bad: { DEFAULT: '#e0685f', soft: 'rgba(224,104,95,0.13)' },
        flag: { DEFAULT: '#e8944a', soft: 'rgba(232,148,74,0.13)' },

        // --- legacy aliases, remapped --------------------------------------
        paper: chassis,
        ink: bone,
        rule: rules,
        // `accent` used to be blue; it now resolves to bone so any stragglers
        // inherit the new action colour rather than reintroducing the blue.
        accent: {
          DEFAULT: '#f0ece3',
          bright: '#fffdf8',
          deep: '#ddd8ce',
          soft: 'rgba(245,242,236,0.10)',
          line: 'rgba(245,242,236,0.22)',
        },
        now: {
          DEFAULT: '#ffb01f',
          soft: 'rgba(255,176,31,0.13)',
          line: 'rgba(255,176,31,0.40)',
        },
        warn: {
          DEFAULT: '#ffb01f',
          soft: 'rgba(255,176,31,0.13)',
          line: 'rgba(255,176,31,0.40)',
        },
      },

      // Radii stay small. Nothing here should read as a pill or a SaaS card.
      borderRadius: {
        xs: '3px',
        sm: '4px',
        DEFAULT: '5px',
        md: '5px',
        lg: '6px',
        xl: '6px',
        xl3: '5px',
        xl4: '6px',
        xl5: '6px',
        xl6: '8px',
      },

      boxShadow: {
        // No ambient card shadows — depth comes from rules and surface steps.
        raised:
          '0 1px 0 rgba(245,242,236,0.03) inset, 0 24px 60px -24px rgba(0,0,0,0.9)',
        drag: '0 18px 40px -14px rgba(0,0,0,0.85)',
        card: 'none',
        lift: '0 24px 60px -24px rgba(0,0,0,0.9)',
        nav: 'none',
      },

      letterSpacing: {
        masthead: '-0.025em',
        legend: '0.14em',
      },

      transitionTimingFunction: {
        // Fast out, settle in. Entrances use `out`; exits go quicker.
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        inout: 'cubic-bezier(0.65, 0, 0.35, 1)',
        snap: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },

      keyframes: {
        signalPulse: {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '0.12', transform: 'scale(2.2)' },
        },
        /*
         * The boot sequence's two primitives. Both are STEPPED rather than eased: an
         * 8-bit mark is struck or it is not, and a rule is drawn in cells. A fade here
         * would read as a modern splash screen wearing pixel art.
         */
        bootCell: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        bootRule: {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },

      animation: {
        signalPulse: 'signalPulse 2.8s cubic-bezier(0.4,0,0.6,1) infinite',
        nowPulse: 'signalPulse 2.8s cubic-bezier(0.4,0,0.6,1) infinite',
        // Declared as utilities rather than written inline, because Tailwind only emits
        // the @keyframes a generated class actually references — an inline `animation:`
        // shorthand would have been purged and the boot sequence would simply not run.
        // Each element sets its own `animationDelay`; the rest is shared.
        bootCell: 'bootCell 1ms steps(1, end) both',
        bootRule: 'bootRule 260ms steps(8, end) both',
      },
    },
  },
  plugins: [],
};
