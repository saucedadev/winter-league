<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../stores/toast';
import { errorMessage } from '../api/client';
import AuthShell from '../components/AuthShell.vue';
import PasswordInput from '../components/PasswordInput.vue';

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const forced = computed(() => auth.user?.mustChangePassword);
const current = ref('');
const pw = ref('');
const pw2 = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  if (pw.value !== pw2.value) { error.value = 'The two new passwords don’t match.'; return; }
  busy.value = true;
  try {
    await auth.changePassword(current.value, pw.value);
    toast.success('Password changed.');
    router.push('/');
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthShell :title="forced ? 'Set your password' : 'Change password'"
    :subtitle="forced ? 'You signed in with a temporary password. Choose your own to continue.' : 'At least 10 characters, with a letter and a number.'">
    <form class="space-y-4" @submit.prevent="submit">
      <div><label class="label" for="cur">{{ forced ? 'Temporary password' : 'Current password' }}</label><PasswordInput id="cur" v-model="current" /></div>
      <div><label class="label" for="pw">New password</label><PasswordInput id="pw" v-model="pw" autocomplete="new-password" /></div>
      <div><label class="label" for="pw2">Confirm new password</label><PasswordInput id="pw2" v-model="pw2" autocomplete="new-password" /></div>
      <p v-if="forced" class="text-xs text-text-muted">At least 10 characters, with a letter and a number.</p>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button class="btn btn-primary w-full" :disabled="busy">{{ busy ? 'Saving…' : 'Save password' }}</button>
    </form>
    <template #below>
      <RouterLink v-if="!forced" to="/" class="hover:text-text">Cancel</RouterLink>
      <button v-else class="hover:text-text" @click="auth.clear(); router.push('/login')">Sign out</button>
    </template>
  </AuthShell>
</template>
