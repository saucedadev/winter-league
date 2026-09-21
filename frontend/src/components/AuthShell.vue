<script setup>
import BrandMark from './BrandMark.vue';
defineProps({ title: String, subtitle: String });
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="flex justify-center mb-6"><BrandMark :size="40" class="text-2xl" /></div>
      <div class="card p-6">
        <h1 v-if="title" class="text-xl font-bold">{{ title }}</h1>
        <p v-if="subtitle" class="text-sm text-text-muted mt-1 mb-4">{{ subtitle }}</p>
        <slot />
      </div>
      <div class="mt-4 text-center text-sm text-text-muted"><slot name="below" /></div>
    </div>
  </div>
</template>
