<script setup>
import { ref } from 'vue';
import { api, errorMessage } from '../api/client';
import AuthShell from '../components/AuthShell.vue';

const username = ref('');
const done = ref('');
const error = ref('');
const busy = ref(false);
async function submit() {
  error.value = '';
  busy.value = true;
  try { done.value = (await api.post('/auth/forgot-password', { username: username.value.trim() })).data.message; }
  catch (err) { error.value = errorMessage(err); }
  finally { busy.value = false; }
}
</script>

<template>
  <AuthShell title="Reset password" subtitle="We’ll email a reset link to the address on your account.">
    <p v-if="done" class="text-sm">{{ done }}</p>
    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="label" for="username">Username</label>
        <input id="username" v-model="username" class="input" autocomplete="username" autocapitalize="none" required />
      </div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button class="btn btn-primary w-full" :disabled="busy">Email reset link</button>
    </form>
    <template #below><RouterLink to="/login" class="hover:text-text">Back to sign in</RouterLink></template>
  </AuthShell>
</template>
