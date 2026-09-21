<script setup>
import { useToast } from '../stores/toast';
const toast = useToast();
</script>

<template>
  <div class="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-[60] flex flex-col gap-2 items-stretch sm:items-end pointer-events-none" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="t in toast.items"
        :key="t.id"
        class="pointer-events-auto card card-blocky px-4 py-3 text-sm flex items-start gap-3 sm:max-w-sm border-l-4"
        :class="t.kind === 'error' ? 'border-l-danger' : 'border-l-success'"
        role="status"
      >
        <span class="flex-1">{{ t.message }}</span>
        <button class="text-text-muted hover:text-text" aria-label="Dismiss" @click="toast.dismiss(t.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
