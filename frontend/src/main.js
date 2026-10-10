import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { setAuthProblemHandler } from './api/client';
import { portalEnabled, signInThroughPortal } from './utils/portal';
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';
import { useBrandingStore } from './stores/branding';
import { useProgramContext } from './stores/programContext';
import './theme/theme.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

useThemeStore().init();
useBrandingStore().init();

setAuthProblemHandler((kind) => {
  const auth = useAuthStore();
  if (kind === 'must-change') return router.push({ name: 'change-password' });
  // Session ended: sign in again through the portal (which usually hands
  // straight back) and return to the same page.
  if (portalEnabled) {
    auth.forgetStoredSession();
    return signInThroughPortal(router.currentRoute.value.fullPath);
  }
  auth.clear();
  useProgramContext().reset();
  if (router.currentRoute.value.name !== 'login') router.push({ name: 'login', query: { expired: '1' } });
});

app.mount('#app');
