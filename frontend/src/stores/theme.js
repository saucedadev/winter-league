import { defineStore } from 'pinia';
import { palette } from '../theme/palette';
import { api } from '../api/client';

const STORAGE_KEY = 'winterleague:theme';

function apply(themeId) {
  const theme = palette.themes[themeId] || palette.themes[palette.defaultTheme];
  document.documentElement.setAttribute('data-theme', themeId);
  document.documentElement.classList.toggle('dark', !!theme.isDark);
}

// Sitewide theme chosen by a System Admin (same model as Gym Hive).
// The server is the source of truth; localStorage only avoids a flash.
export const useThemeStore = defineStore('theme', {
  state: () => ({ activeTheme: palette.defaultTheme }),
  getters: {
    themeList: () => Object.entries(palette.themes).map(([id, t]) => ({ id, label: t.label })),
  },
  actions: {
    init() {
      const cached = localStorage.getItem(STORAGE_KEY);
      this.activeTheme = palette.themes[cached] ? cached : palette.defaultTheme;
      apply(this.activeTheme);
      api.get('/settings/theme').then(({ data }) => {
        if (palette.themes[data.theme]) {
          this.activeTheme = data.theme;
          apply(data.theme);
          localStorage.setItem(STORAGE_KEY, data.theme);
        }
      }).catch(() => {});
    },
    async setTheme(themeId) {
      const previous = this.activeTheme;
      this.activeTheme = themeId;
      apply(themeId);
      try {
        await api.put('/settings/theme', { theme: themeId });
        localStorage.setItem(STORAGE_KEY, themeId);
      } catch (err) {
        this.activeTheme = previous;
        apply(previous);
        throw err;
      }
    },
  },
});
