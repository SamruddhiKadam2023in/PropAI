/** @type {import('tailwindcss').Config} */

// Semantic colors resolve to CSS variables defined once in src/index.css
// (:root = light, .dark = dark). Change a value there and every component follows.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#4F46E5', hover: '#4338CA', light: '#EEF2FF' },

        page: token('page'),
        overlay: token('overlay'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2'), 3: token('surface-3') },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        fg: { DEFAULT: token('fg'), muted: token('fg-muted'), subtle: token('fg-subtle') },

        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          on: token('accent-on'),
          text: token('accent-text'),
          soft: token('accent-soft'),
        },
        success: { DEFAULT: token('success'), hover: token('success-hover'), soft: token('success-soft'), fg: token('success-fg') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft'), fg: token('warning-fg') },
        danger:  { DEFAULT: token('danger'), hover: token('danger-hover'), soft: token('danger-soft'), fg: token('danger-fg') },
        info:    { DEFAULT: token('info'), soft: token('info-soft'), fg: token('info-fg') },
        violet:  { DEFAULT: token('violet'), soft: token('violet-soft'), fg: token('violet-fg') },
      },
    },
  },
  plugins: [],
}
