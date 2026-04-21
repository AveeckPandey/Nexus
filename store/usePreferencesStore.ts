import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ColorMode = 'light' | 'dark';
export type BackgroundTheme = 'sand' | 'mint' | 'dusk' | 'graphite';

interface PreferencesState {
  colorMode: ColorMode;
  backgroundTheme: BackgroundTheme;
  setColorMode: (mode: ColorMode) => void;
  toggleColorMode: () => void;
  setBackgroundTheme: (theme: BackgroundTheme) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      colorMode: 'light',
      backgroundTheme: 'sand',
      setColorMode: (colorMode) => set({ colorMode }),
      toggleColorMode: () =>
        set((state) => ({
          colorMode: state.colorMode === 'dark' ? 'light' : 'dark',
        })),
      setBackgroundTheme: (backgroundTheme) => set({ backgroundTheme }),
    }),
    {
      name: 'nexus-preferences',
    }
  )
);
