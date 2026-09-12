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
        whatsapp: {
          dark: '#14092B',
          panel: '#1E1238',
          composer: '#2A1D4D',
          outgoing: '#7C3AED',
          checkBlue: '#53BDEB',
          checkGray: '#A79FC4',
        },
      },
    },
  },
  darkMode: 'class',
  plugins: [heroui()],
};

export default config;
