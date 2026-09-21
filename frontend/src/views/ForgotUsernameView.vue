<script setup>
import { ref } from 'vue';
import { api, errorMessage } from '../api/client';
import AuthShell from '../components/AuthShell.vue';

const email = ref('');
const done = ref('');
const error = ref('');
const busy = ref(false);
async function submit() {
  error.value = '';
  busy.value = true;
  try { done.value = (await api.post('/auth/forgot-username', { email: email.value })).data.message; }
  catch (err) { error.value = errorMessage(err); }
  finally { busy.value = false; }
}
</script>

<template>
  <AuthShell title="Forgot username" subtitle="We’ll email the username linked to your address.">
    <p v-if="done" class="text-sm">{{ done }}</p>
    <form v-else class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="label" for="email">Email</label>
        <input id="email" v-model="email" type="email" class="input" autocomplete="email" required />
      </div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button class="btn btn-primary w-full" :disabled="busy">Email my username</button>
    </form>
    <template #below><RouterLink to="/login" class="hover:text-text">Back to sign in</RouterLink></template>
  </AuthShell>
</template>
