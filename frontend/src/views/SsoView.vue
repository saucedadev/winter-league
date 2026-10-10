<script setup>
// /sso: where the Hub Portal sends people, with a one-time sign-in pass in
// the address fragment (#token=...&next=/some/page). The fragment never
// reaches any server; this page reads it, wipes it from the address bar, and
// trades it for a normal Winter League session.
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { errorMessage } from '../api/client';
import { portalEnabled, portalUrl } from '../utils/portal';
import AuthShell from '../components/AuthShell.vue';

const router = useRouter();
const auth = useAuthStore();
const error = ref('');

onMounted(async () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(null, '', window.location.pathname);
  const token = params.get('token');
  const next = params.get('next') || '/';
  if (!token) {
    error.value = 'This page is for signing in from the portal, and no sign-in pass came with it.';
    return;
  }
  try {
    await auth.loginWithPass(token);
    // Only follow paths inside this app.
    router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  } catch (err) {
    error.value = errorMessage(err, 'Signing in through the portal didn’t work. Try again from the portal.');
  }
});
</script>

<template>
  <AuthShell :title="error ? 'That didn’t work' : 'Signing you in…'" subtitle="">
    <p v-if="!error" class="text-sm text-text-muted" role="status">One moment while we open your league.</p>
    <template v-else>
      <p class="text-sm text-danger" role="alert">{{ error }}</p>
      <a v-if="portalEnabled" :href="portalUrl" class="btn btn-primary w-full mt-4">Back to the portal</a>
      <RouterLink v-else to="/login" class="btn btn-primary w-full mt-4">Go to sign in</RouterLink>
    </template>
  </AuthShell>
</template>
