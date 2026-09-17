import type { Config } from 'tailwindcss';
import { heroui } from '@heroui/theme';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        neu: {
          bg: '#E0E5EC',
          card: '#E9EDF3',
          ink: '#2F343D',
          muted: '#8A8F98',
          accent: '#CC5500',
          accentDark: '#A34400',
        },
        whatsapp: {
          dark: '#E0E5EC',
          panel: '#E0E5EC',
          composer: '#E0E5EC',
          outgoing: '#CC5500',
          checkBlue: '#CC5500',
          checkGray: '#8A8F98',
        },
      },
      keyframes: {
        'typing-bounce': {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.5' },
          '30%': { transform: 'translateY(-4px)', opacity: '1' },
        },
      },
      animation: {
        'typing-bounce': 'typing-bounce 1.2s ease-in-out infinite',
      },
    },
  },
  darkMode: 'class',
  plugins: [heroui()],
};

export default config;
