// Single source of truth for color palettes — identical to Gym Hive's so
// the two apps read as siblings. Structural roles per theme: header,
// background, surface, text/textMuted, border, accent/accentContrast.
//
// Category + status colors are deliberately NOT themed: they carry
// meaning (what kind of gym time a block is), and that meaning must not
// change when a System Admin switches themes.
export const palette = {
  themes: {
    light: {
      label: 'Light Mode', header: '#FFFFFF', headerText: '#36454F', background: '#F8F9FA', surface: '#FFFFFF',
      text: '#36454F', textMuted: '#6B7280', border: '#E2E8F0', accent: '#2F6A87', accentContrast: '#FFFFFF', isDark: false,
    },
    dark: {
      label: 'Dark Mode', header: '#242440', headerText: '#F1F5F9', background: '#1A1A2E', surface: '#242440',
      text: '#F1F5F9', textMuted: '#94A3B8', border: '#33334D', accent: '#2F6A87', accentContrast: '#FFFFFF', isDark: true,
    },
    regalOpulence: {
      label: 'Regal Opulence', header: '#B22222', headerText: '#FFFDD0', background: '#FFFDD0', surface: '#FFFFFF',
      text: '#0F5257', textMuted: '#6B8E8A', border: '#E5D9B6', accent: '#D4AF37', accentContrast: '#0F5257', isDark: false,
    },
    midnightNoir: {
      label: 'Midnight Noir', header: '#B22222', headerText: '#F5F5F7', background: '#1C1C1C', surface: '#2A2A2A',
      text: '#F5F5F7', textMuted: '#708090', border: '#3A3A3A', accent: '#B22222', accentContrast: '#F5F5F7', isDark: true,
    },
  },
  status: { success: '#10B981', danger: '#E63946', warning: '#EA6C36', pending: '#F1C40F', unavailable: '#3C4142' },
  categories: { PRACTICE: '#047857', WEEKNIGHT_GAME: '#2563EB', WEEKEND_GAME_BLOCK: '#7C3AED' },
  defaultTheme: 'light',
};
