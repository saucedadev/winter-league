import { defineStore } from 'pinia';
import { api } from '../api/client';
import { useAuthStore } from './auth';

// Number of change requests waiting on the signed-in user, for the nav badge.
export const useRequestBadge = defineStore('requestBadge', {
  state: () => ({ count: 0 }),
  actions: {
    async refresh() {
      const auth = useAuthStore();
      if (!auth.canManage) { this.count = 0; return; }
      try { this.count = (await api.get('/requests/count')).data.needsAction; } catch { /* badge is best-effort */ }
    },
  },
});
