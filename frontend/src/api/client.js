import axios from 'axios';

// Local dev: '/api' is proxied to the backend by vite.config.js.
// Production: VITE_API_URL (set in Vercel) is the Render backend's URL + /api.
export const TOKEN_KEY = 'winterleague:token';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((cfg) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Registered by main.js once the router exists.
let onAuthProblem = () => {};
export const setAuthProblemHandler = (fn) => { onAuthProblem = fn; };

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    const code = err.response?.data?.code;
    // A rejected sign-in attempt (own form or portal pass) is shown on its own
    // page. Treating it as "session expired" would send the person back to the
    // portal, which would send them straight here again, in a loop.
    const isLogin = /\/auth\/(login|sso)/.test(err.config?.url || '');
    if (!isLogin && (status === 401 || code === 'MUST_CHANGE_PASSWORD')) onAuthProblem(status === 401 ? 'expired' : 'must-change');
    return Promise.reject(err);
  }
);

export const errorMessage = (err, fallback = 'Something went wrong. Try again.') =>
  err?.response?.data?.error || (err?.request && !err?.response ? 'Can’t reach the server. Check your connection and try again.' : fallback);
