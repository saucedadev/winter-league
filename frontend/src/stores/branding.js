import { defineStore } from 'pinia';
import { api } from '../api/client';

const CACHE_KEY = 'winterleague:branding';
export const DEFAULT_APP_NAME = 'Winter League';
const DEFAULT_FAVICON = '/favicon.svg';

function applyFavicon(logo) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = logo || DEFAULT_FAVICON;
  link.type = logo ? logo.slice(5, logo.indexOf(';')) : 'image/svg+xml';
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}

// Sitewide app name + logo, set by a System Admin on the Branding page.
// Cached locally so the name doesn't flash on load; the server is the source of truth.
export const useBrandingStore = defineStore('branding', {
  state: () => {
    const c = readCache();
    return { appName: c.appName || DEFAULT_APP_NAME, logo: c.logo || null, pageTitle: '' };
  },
  actions: {
    init() {
      applyFavicon(this.logo);
      this.applyTitle();
      api.get('/settings/branding').then(({ data }) => this.apply(data.branding)).catch(() => {});
    },
    apply(b) {
      this.appName = b.appName || DEFAULT_APP_NAME;
      this.logo = b.logo || null;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ appName: this.appName, logo: this.logo })); } catch { /* quota: the logo is optional */ }
      applyFavicon(this.logo);
      this.applyTitle();
    },
    setPageTitle(title) { this.pageTitle = title || ''; this.applyTitle(); },
    applyTitle() { document.title = this.pageTitle ? `${this.pageTitle} · ${this.appName}` : this.appName; },
    async save(branding) {
      const { data } = await api.put('/settings/branding', branding);
      this.apply(data.branding);
      return data.branding;
    },
  },
});
