<script setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, errorMessage } from '../api/client';
import AuthShell from '../components/AuthShell.vue';
import PasswordInput from '../components/PasswordInput.vue';

const route = useRoute();
const pw = ref('');
const pw2 = ref('');
const done = ref('');
const error = ref(route.query.token ? '' : 'This link is missing its reset token. Request a new link.');
const busy = ref(false);
async function submit() {
  error.value = '';
  if (pw.value !== pw2.value) { error.value = 'The two passwords don’t match.'; return; }
  busy.value = true;
  try { done.value = (await api.post('/auth/reset-password', { token: route.query.token, newPassword: pw.value })).data.message; }
  catch (err) { error.value = errorMessage(err); }
  finally { busy.value = false; }
}
</script>

<template>
  <AuthShell title="Choose a new password" subtitle="At least 10 characters, with a letter and a number.">
    <div v-if="done" class="space-y-4">
      <p class="text-sm">{{ done }}</p>
      <RouterLink to="/login" class="btn btn-primary w-full">Go to sign in</RouterLink>
    </div>
    <form v-else class="space-y-4" @submit.prevent="submit">
      <div><label class="label" for="pw">New password</label><PasswordInput id="pw" v-model="pw" autocomplete="new-password" /></div>
      <div><label class="label" for="pw2">Confirm new password</label><PasswordInput id="pw2" v-model="pw2" autocomplete="new-password" /></div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button class="btn btn-primary w-full" :disabled="busy || !route.query.token">Save password</button>
    </form>
  </AuthShell>
</template>
