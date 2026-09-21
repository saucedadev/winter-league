// Color palettes. The first four match Gym Hive's so the two apps read as
// siblings; Pacific Youth Conference is Winter League's own. (theme.css holds
// the actual CSS variables; keep the two in step.) Structural roles per theme: header,
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
    // Coastal/nautical: navy header, sand page, teal actions, sunset-orange
    // highlights on the header, and a gold hairline for a championship touch.
    // Teal is #007A7A (not #008080) so it passes AA as link text on sand;
    // orange only ever sits on navy, with navy text on it.
    pacificYouthConference: {
      label: 'Pacific Youth Conference', header: '#003366', headerText: '#F5F5DC', background: '#F5F5DC', surface: '#FFFDF7',
      text: '#003366', textMuted: '#4F6A7E', border: '#E4DDC3', accent: '#007A7A', accentContrast: '#FFFFFF',
      headerAccent: '#FF6F61', headerAccentContrast: '#003366', headerBorder: '#D4AF37', isDark: false,
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
