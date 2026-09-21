<script setup>
// Sibling mark to Gym Hive's: the hive's hexagon, with a snowflake inside.
defineProps({ size: { type: Number, default: 28 }, showWord: { type: Boolean, default: true }, onHeader: { type: Boolean, default: false } });
</script>

<template>
  <span class="inline-flex items-center gap-2 select-none">
    <svg :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2l12.1 7v14L16 30 3.9 23V9z" :fill="onHeader ? 'var(--color-header-accent)' : 'var(--color-accent)'" />
      <g :stroke="onHeader ? 'var(--color-header-accent-contrast)' : 'var(--color-accent-contrast)'" stroke-width="2" stroke-linecap="round">
        <path d="M16 8.5v15M9.5 12.25l13 7.5M22.5 12.25l-13 7.5" />
        <path d="M13.8 9.6L16 11.4l2.2-1.8M13.8 22.4L16 20.6l2.2 1.8" stroke-width="1.5" />
      </g>
    </svg>
    <span v-if="showWord" class="font-bold tracking-tight text-lg leading-none">winter league</span>
  </span>
</template>
