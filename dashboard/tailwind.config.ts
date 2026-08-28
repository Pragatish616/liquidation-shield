import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07080a',
          900: '#0c0e12',
          800: '#13161c',
          700: '#1b1f27',
          600: '#262b35',
          500: '#3a4150',
        },
        paper: {
          100: '#f5f6f8',
          300: '#c7cbd4',
          500: '#8b92a1',
        },
        signal: {
          DEFAULT: '#3E7BFA',
          dim: '#2C5BC4',
        },
        safe: '#2FD97C',
        warn: '#F5A524',
        danger: '#F0475E',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        panel: '18px',
        control: '10px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.04) inset, 0 20px 50px -25px rgba(0,0,0,0.6)',
      },
      maxWidth: {
        shell: '1440px',
      },
    },
  },
  plugins: [],
};
export default config;
