/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Utility UI: clean sans for buttons, labels, controls.
        sans: [
          '"Inter"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        // Editorial display: titles, headings, body when we want voice.
        display: [
          '"Fraunces"',
          'ui-serif',
          'Georgia',
          'Cambria',
          '"Times New Roman"',
          'Times',
          'serif',
        ],
        serif: [
          '"Fraunces"',
          'ui-serif',
          'Georgia',
          'Cambria',
          '"Times New Roman"',
          'Times',
          'serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      colors: {
        // Surfaces (warm parchment — softer)
        paper: {
          0: '#ede5d2',
          1: '#f2ead8',
          2: '#f7f0de',
          3: '#fbf6e8',
          4: '#fefbf1',
        },
        ink: {
          0: '#231a0e',
          1: '#322516',
          2: '#473722',
          3: '#574627', // contrast ≈ 6.4:1 on parchment (was #7a6644 ≈ 3.7)
          4: '#6e5b3a', // contrast ≈ 4.7:1 on parchment (was #a59076 ≈ 2.4)
          5: '#c8b693', // decoration only
        },
        rule: {
          1: 'rgba(50,37,22,0.07)',
          2: 'rgba(50,37,22,0.12)',
          3: 'rgba(50,37,22,0.20)',
          4: 'rgba(50,37,22,0.38)',
        },
        // Editorial category accents (slightly softened)
        cat: {
          deep: '#7e3a3e',
          deepSoft: 'rgba(126,58,62,0.10)',
          admin: '#2b4a6b',
          adminSoft: 'rgba(43,74,107,0.10)',
          break: '#b18133',
          breakSoft: 'rgba(177,129,51,0.12)',
          other: '#574a3a',
          otherSoft: 'rgba(87,74,58,0.08)',
        },
        seal: '#9c4634', // softer brick red
      },
      boxShadow: {
        page: '0 1px 0 rgba(254,251,241,0.6) inset, 0 1px 2px rgba(50,37,22,0.05), 0 14px 32px -24px rgba(50,37,22,0.22)',
        lift: '0 1px 0 rgba(254,251,241,0.7) inset, 0 24px 48px -28px rgba(50,37,22,0.32)',
        ring: '0 0 0 1px rgba(50,37,22,0.10)',
        stamp: '0 0 0 1px rgba(156,70,52,0.32), 0 6px 18px -8px rgba(156,70,52,0.38)',
      },
      borderRadius: {
        xl2: '14px',
        xl3: '18px',
        xl4: '22px',
        xl5: '28px',
      },
      letterSpacing: {
        masthead: '-0.04em',
        caps: '0.18em',
      },
      keyframes: {
        sealPulse: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.65', transform: 'scale(1.04)' },
        },
        inkRise: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        sealPulse: 'sealPulse 2.6s ease-in-out infinite',
        inkRise: 'inkRise 0.5s ease-out both',
      },
    },
  },
  plugins: [],
};
