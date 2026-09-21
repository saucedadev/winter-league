<script setup>
import Modal from './Modal.vue';
defineProps({
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmLabel: { type: String, default: 'Delete' },
  busy: { type: Boolean, default: false },
  tone: { type: String, default: 'danger' }, // 'danger' | 'primary'
});
defineEmits(['confirm', 'close']);
</script>

<template>
  <Modal :title="title" @close="$emit('close')">
    <p class="text-sm leading-relaxed">{{ message }}</p>
    <slot />
    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn" :class="tone === 'primary' ? 'btn-primary' : 'btn-danger'" :disabled="busy" @click="$emit('confirm')">{{ busy ? 'Working…' : confirmLabel }}</button>
    </template>
  </Modal>
</template>
