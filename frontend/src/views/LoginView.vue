<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { errorMessage } from '../api/client';
import AuthShell from '../components/AuthShell.vue';
import PasswordInput from '../components/PasswordInput.vue';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const error = ref(route.query.expired ? 'Your session ended. Sign in again.' : '');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const user = await auth.login(username.value.trim(), password.value);
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    router.push(user.mustChangePassword ? { name: 'change-password' } : next);
  } catch (err) {
    error.value = errorMessage(err, 'Sign-in failed. Try again.');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthShell title="Sign in" subtitle="League scheduling for program directors, coaches, and officials.">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="label" for="username">Username</label>
        <input id="username" v-model="username" class="input" autocomplete="username" autocapitalize="none" required />
      </div>
      <div>
        <label class="label" for="password">Password</label>
        <PasswordInput id="password" v-model="password" />
      </div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <button type="submit" class="btn btn-primary w-full" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
    </form>
    <template #below>
      <RouterLink to="/forgot-username" class="hover:text-text">Forgot username</RouterLink>
      <span class="mx-2">·</span>
      <RouterLink to="/forgot-password" class="hover:text-text">Forgot password</RouterLink>
    </template>
  </AuthShell>
</template>
