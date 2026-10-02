import { defineStore } from 'pinia';
import { api } from '../api/client';
import { useAuthStore } from './auth';

const KEY = 'winterleague:program';

// Which program the screens are looking at.
//   System Admin: picks one program or "All programs" from the header.
//   Everyone else: locked to their own program (the server enforces this
//   too — this store only drives what the UI asks for).
// Guest programs are kept apart (guestPrograms): they have no gyms, slots,
// blackouts or accounts, so they never appear in program pickers.
export const useProgramContext = defineStore('programContext', {
  state: () => ({ programs: [], guestPrograms: [], selectedId: sessionStorage.getItem(KEY) || '', maxPrograms: 16, loaded: false }),
  getters: {
    programId() {
      const auth = useAuthStore();
      return auth.isSuperAdmin ? this.selectedId : auth.user?.programId || '';
    },
    current() { return this.programs.find((p) => p.id === this.programId) || null; },
    activePrograms: (s) => s.programs.filter((p) => p.isActive),
    query() { return this.programId ? { programId: this.programId } : {}; },
  },
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      const { data } = await api.get('/programs');
      this.programs = data.programs.filter((p) => !p.isGuest);
      this.guestPrograms = data.programs.filter((p) => p.isGuest);
      this.maxPrograms = data.maxPrograms;
      this.loaded = true;
      // Inactive programs aren't offered in any drop-down list, so a selection
      // left on one (it was just deactivated) goes back to "All programs".
      if (this.selectedId && !this.programs.some((p) => p.id === this.selectedId && p.isActive)) this.select('');
    },
    select(id) {
      this.selectedId = id || '';
      sessionStorage.setItem(KEY, this.selectedId);
    },
    reset() { this.$reset(); },
  },
});
