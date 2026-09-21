<script setup>
import { ref } from 'vue';
const model = defineModel({ type: String, default: '' });
defineProps({ id: String, autocomplete: { type: String, default: 'current-password' } });
const shown = ref(false);
</script>

<template>
  <div class="relative">
    <input :id="id" v-model="model" :type="shown ? 'text' : 'password'" :autocomplete="autocomplete" class="input pr-16" required />
    <button type="button" class="absolute inset-y-0 right-0 px-3 text-xs font-medium text-text-muted hover:text-text"
      :aria-label="shown ? 'Hide password' : 'Show password'" @click="shown = !shown">{{ shown ? 'Hide' : 'Show' }}</button>
  </div>
</template>
