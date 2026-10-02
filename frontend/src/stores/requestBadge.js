import { defineStore } from 'pinia';
import { api } from '../api/client';
import { useAuthStore } from './auth';

// Number of requests waiting on the signed-in user, for the nav badge:
// game changes to decide, plus rule requests to answer (league) or questions
// to reply to (director).
export const useRequestBadge = defineStore('requestBadge', {
  state: () => ({ games: 0, rules: 0 }),
  getters: { count: (s) => s.games + s.rules },
  actions: {
    async refresh() {
      const auth = useAuthStore();
      if (!auth.canManage) { this.games = 0; this.rules = 0; return; }
      // Best-effort: a failed count leaves the last value in place.
      const [games, rules] = await Promise.allSettled([api.get('/requests/count'), api.get('/rule-requests/count')]);
      if (games.status === 'fulfilled') this.games = games.value.data.needsAction;
      if (rules.status === 'fulfilled') this.rules = rules.value.data.needsAction;
    },
  },
});
