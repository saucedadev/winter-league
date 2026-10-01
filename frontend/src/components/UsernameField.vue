<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api/client';

// The username on Add user / Edit account.
//   New account: filled in live from the first and last name, as the app
//   would generate it. Locked until the admin clicks "Edit username".
//   Existing account: shows the current username, locked until the admin
//   clicks "Change username". A changed username is checked as they type.
// v-model = the username; v-model:unlocked = whether the admin is editing it
// (only then is it sent, so a locked field always means "generate" / "keep").
const username = defineModel({ type: String, default: '' });
const unlocked = defineModel('unlocked', { type: Boolean, default: false });
// True while an edited username is known to be unusable (taken / badly formed).
const invalid = defineModel('invalid', { type: Boolean, default: false });
const props = defineProps({
  isNew: { type: Boolean, default: true },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  original: { type: String, default: '' },   // existing accounts
  excludeId: { type: String, default: '' },
});

let timer = null;
onBeforeUnmount(() => clearTimeout(timer));
const debounce = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 300); };

// New account: live preview of the generated username while locked.
async function suggest() {
  if (!props.isNew || unlocked.value) return;
  if (!props.firstName.trim() && !props.lastName.trim()) { username.value = ''; return; }
  try {
    const { data } = await api.get('/users/username-suggestion', { params: { firstName: props.firstName, lastName: props.lastName } });
    if (!unlocked.value) username.value = data.username;
  } catch { /* the preview is only a convenience */ }
}
watch(() => [props.firstName, props.lastName], () => debounce(suggest), { immediate: true });

// While editing: instant check (format and not already taken).
const check = ref({ state: '', message: '' }); // state: '' | 'checking' | 'ok' | 'bad'
watch(username, (u) => {
  if (!unlocked.value) { check.value = { state: '', message: '' }; return; }
  if (!props.isNew && u.trim().toLowerCase() === props.original) { check.value = { state: '', message: 'That’s their current username.' }; return; }
  check.value = { state: 'checking', message: 'Checking…' };
  debounce(async () => {
    try {
      const { data } = await api.get('/users/username-check', { params: { username: u, excludeId: props.excludeId } });
      check.value = data.ok ? { state: 'ok', message: `“${data.username}” is available.` } : { state: 'bad', message: data.message };
    } catch { check.value = { state: '', message: '' }; }
  });
});

function unlock() { unlocked.value = true; }
function relock() {
  unlocked.value = false;
  check.value = { state: '', message: '' };
  if (props.isNew) suggest(); else username.value = props.original;
}
watch([check, unlocked], () => { invalid.value = unlocked.value && (check.value.state === 'bad' || !username.value.trim()); }, { deep: true });
</script>

<template>
  <div>
    <div class="flex items-end justify-between gap-2">
      <label class="label" for="uf-username">Username</label>
      <button v-if="!unlocked" type="button" class="text-xs font-medium underline mb-1" :aria-label="isNew ? 'Edit username' : 'Change username'" @click="unlock">
        🔒 {{ isNew ? 'Edit username' : 'Change username' }}
      </button>
      <button v-else type="button" class="text-xs font-medium underline mb-1" @click="relock">
        {{ isNew ? 'Use the suggested username' : 'Keep the current username' }}
      </button>
    </div>
    <input id="uf-username" v-model="username" class="input font-mono" :readonly="!unlocked" :aria-readonly="!unlocked"
      :class="!unlocked && '!bg-background !text-text-muted cursor-not-allowed'" autocomplete="off" spellcheck="false" autocapitalize="none"
      maxlength="30" :placeholder="isNew ? 'Filled in from the first and last name' : ''" />
    <p v-if="unlocked && check.message" class="text-xs mt-1 font-medium" :class="check.state === 'bad' ? 'text-danger' : check.state === 'ok' ? 'text-success' : 'text-text-muted'">{{ check.message }}</p>
    <p v-if="!unlocked" class="text-xs text-text-muted mt-1">{{ isNew ? 'Created from the first and last name. Click Edit username to fix a typo or choose a different one.' : 'They sign in with this. Click Change username only to fix a mistake.' }}</p>
    <p v-else-if="!isNew" class="text-xs mt-1">⚠ They’ll sign in with the new username from now on. Their password doesn’t change, and they’re emailed the new username.</p>
  </div>
</template>
