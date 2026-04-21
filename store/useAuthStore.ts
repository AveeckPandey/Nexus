import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id?: string;
  username: string;
  email: string;
  image?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (user: User) => void;
  setProfileImage: (image: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setAuth: (user) => set({ user, isAuthenticated: true }),
      setProfileImage: (image) =>
        set((state) => ({
          user: state.user ? { ...state.user, image } : state.user,
        })),
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'nexus-auth', // This saves the user state in LocalStorage
    }
  )
);
