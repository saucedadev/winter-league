<script setup>
defineProps({ title: { type: String, required: true }, subtitle: String });
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-3 mb-5">
    <div class="min-w-0">
      <h1 class="text-2xl font-bold tracking-tight">{{ title }}</h1>
      <p v-if="subtitle" class="text-sm text-text-muted mt-1">{{ subtitle }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2"><slot /></div>
  </div>
</template>
