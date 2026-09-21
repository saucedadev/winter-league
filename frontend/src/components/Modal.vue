<script setup>
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  wide: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);
const panel = ref(null);
let lastFocus = null;

function onKey(e) { if (e.key === 'Escape') emit('close'); }
onMounted(async () => {
  lastFocus = document.activeElement;
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  await nextTick();
  panel.value?.querySelector('input:not([type=hidden]), select, textarea, button')?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
  lastFocus?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div class="absolute inset-0 bg-black/45" @click="emit('close')" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="props.title"
        class="relative bg-surface text-text w-full rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl max-h-[92vh] flex flex-col"
        :class="props.wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'"
      >
        <div class="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 class="text-base font-semibold">{{ props.title }}</h2>
          <button class="btn-ghost rounded-md" aria-label="Close" @click="emit('close')">✕</button>
        </div>
        <div class="px-5 py-4 overflow-y-auto"><slot /></div>
        <div v-if="$slots.footer" class="px-5 py-3 border-t border-border flex flex-wrap justify-end gap-2"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>
