<script setup>
import { computed } from 'vue';
import { useBrandingStore } from '../stores/branding';

// The app's logo + name, from the sitewide Branding settings.
//   No uploaded logo -> the built-in mark (Gym Hive's hexagon with a snowflake).
//   name/logo props override the store (used for the Branding page preview).
const props = defineProps({
  size: { type: Number, default: 28 },
  showWord: { type: Boolean, default: true },
  onHeader: { type: Boolean, default: false },
  name: { type: String, default: null },
  logo: { type: String, default: undefined }, // undefined = use the store; null = force the built-in mark
});
const branding = useBrandingStore();
const appName = computed(() => props.name ?? branding.appName);
const logoSrc = computed(() => (props.logo !== undefined ? props.logo : branding.logo));
</script>

<template>
  <span class="inline-flex items-center gap-2 select-none min-w-0">
    <img v-if="logoSrc" :src="logoSrc" alt="" aria-hidden="true" class="shrink-0 object-contain" :style="{ height: `${size}px`, maxWidth: `${size * 4}px` }" />
    <svg v-else :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
      <path d="M16 2l12.1 7v14L16 30 3.9 23V9z" :fill="onHeader ? 'var(--color-header-accent)' : 'var(--color-accent)'" />
      <g :stroke="onHeader ? 'var(--color-header-accent-contrast)' : 'var(--color-accent-contrast)'" stroke-width="2" stroke-linecap="round">
        <path d="M16 8.5v15M9.5 12.25l13 7.5M22.5 12.25l-13 7.5" />
        <path d="M13.8 9.6L16 11.4l2.2-1.8M13.8 22.4L16 20.6l2.2 1.8" stroke-width="1.5" />
      </g>
    </svg>
    <!-- In the header a long name wraps to two lines instead of crowding the nav. -->
    <span v-if="showWord" class="font-bold tracking-tight min-w-0"
      :class="onHeader ? 'text-base leading-tight line-clamp-2 max-w-[10.5rem]' : 'leading-tight'">{{ appName }}</span>
  </span>
</template>
