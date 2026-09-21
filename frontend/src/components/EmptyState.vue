<script setup>
defineProps({ title: { type: String, required: true }, body: String });
</script>

<template>
  <div class="card px-6 py-10 text-center">
    <p class="font-semibold">{{ title }}</p>
    <p v-if="body" class="text-sm text-text-muted mt-1 max-w-md mx-auto">{{ body }}</p>
    <div v-if="$slots.default" class="mt-4 flex justify-center gap-2"><slot /></div>
  </div>
</template>
