import { create } from 'zustand';

export type ThemeId = 'default-dark' | 'kimbie-dark' | 'solarized-dark' | 'solarized-light' | 'monokai-dimmed';

export const THEMES: { id: ThemeId; label: string; dark: boolean }[] = [
  { id: 'default-dark', label: 'Default Dark', dark: true },
  { id: 'kimbie-dark', label: 'Kimbie Dark', dark: true },
  { id: 'solarized-dark', label: 'Solarized Dark', dark: true },
  { id: 'solarized-light', label: 'Solarized Light', dark: false },
  { id: 'monokai-dimmed', label: 'Monokai Dimmed', dark: true },
];

const KEY = 'rpe.theme';

function initial(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    /* storage blocked */
  }
  return 'default-dark';
}

/** Put the theme on <html> so the CSS variables switch. */
export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
}

export const useTheme = create<{ theme: ThemeId; setTheme: (t: ThemeId) => void }>((set) => ({
  theme: initial(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage blocked */
    }
    applyTheme(theme);
    set({ theme });
  },
}));

export const isDarkTheme = (id: ThemeId) => THEMES.find((t) => t.id === id)?.dark ?? true;
