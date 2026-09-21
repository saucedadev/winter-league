import { defineStore } from 'pinia';
import { api, TOKEN_KEY } from '../api/client';
import { ROLE_LABELS } from '../utils/format';

// The token lives in sessionStorage and travels as an Authorization
// header — not a cookie — so Safari's cross-site cookie blocking can't
// break sign-in (the lesson learned on Gym Hive).
export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, token: sessionStorage.getItem(TOKEN_KEY), loaded: false }),
  getters: {
    isAuthenticated: (s) => !!s.token && !!s.user,
    isSuperAdmin: (s) => s.user?.role === 'super_admin',
    isDirector: (s) => s.user?.role === 'program_director',
    canManage: (s) => ['super_admin', 'program_director'].includes(s.user?.role),
    roleLabel: (s) => ROLE_LABELS[s.user?.role] || '',
  },
  actions: {
    async init() {
      if (this.token && !this.user) {
        try {
          const { data } = await api.get('/auth/me');
          this.user = data.user;
        } catch {
          this.clear();
        }
      }
      this.loaded = true;
    },
    async login(username, password) {
      const { data } = await api.post('/auth/login', { username, password });
      this.token = data.token;
      this.user = data.user;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      return data.user;
    },
    async changePassword(currentPassword, newPassword) {
      const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
      this.user = data.user;
    },
    clear() {
      this.user = null;
      this.token = null;
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem('winterleague:program');
    },
  },
});
