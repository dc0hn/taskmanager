/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      colors: {
        // Surfaces
        bg: {
          0: '#08090d',
          1: '#0d0f15',
          2: '#13161f',
          3: '#1a1e2a',
        },
        line: {
          1: 'rgba(255,255,255,0.06)',
          2: 'rgba(255,255,255,0.10)',
          3: 'rgba(255,255,255,0.18)',
        },
        fg: {
          0: '#f8fafc',
          1: '#e5e7eb',
          2: '#cbd5e1',
          3: '#94a3b8',
          4: '#64748b',
          5: '#475569',
        },
        // Category accents (vibrant but tuned for dark)
        cat: {
          deep: '#8b5cf6',
          deepGlow: 'rgba(139,92,246,0.35)',
          admin: '#22d3ee',
          adminGlow: 'rgba(34,211,238,0.35)',
          break: '#f59e0b',
          breakGlow: 'rgba(245,158,11,0.35)',
          other: '#94a3b8',
          otherGlow: 'rgba(148,163,184,0.30)',
        },
        rose: {
          DEFAULT: '#fb7185',
        },
      },
      boxShadow: {
        soft: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)',
        lift: '0 1px 0 rgba(255,255,255,0.06) inset, 0 16px 48px rgba(0,0,0,0.55)',
        ring: '0 0 0 1px rgba(255,255,255,0.06)',
        glow: '0 0 0 1px rgba(139,92,246,0.45), 0 8px 32px rgba(139,92,246,0.30)',
      },
      borderRadius: {
        xl2: '20px',
        xl3: '28px',
        xl4: '36px',
        xl5: '44px',
      },
      backgroundImage: {
        'gradient-radial':
          'radial-gradient(ellipse at top left, rgba(139,92,246,0.10), transparent 50%), radial-gradient(ellipse at bottom right, rgba(34,211,238,0.06), transparent 55%)',
        'grid-fade':
          'linear-gradient(to bottom, rgba(255,255,255,0.04), transparent 60%)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.08)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.4s ease-in-out infinite',
        pulseSoft: 'pulseSoft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
