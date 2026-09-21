<script setup>
import { useThemeStore } from '../stores/theme';
import { useToast } from '../stores/toast';
import { errorMessage } from '../api/client';

const theme = useThemeStore();
const toast = useToast();
async function onChange(e) {
  try {
    await theme.setTheme(e.target.value);
  } catch (err) {
    toast.error(errorMessage(err, 'Couldn’t change the theme.'));
  }
}
</script>

<template>
  <select :value="theme.activeTheme" class="text-sm rounded-lg border border-border bg-surface text-text pl-2 pr-7 py-1.5"
    aria-label="Sitewide color theme" title="Changes the color theme for everyone" @change="onChange">
    <option v-for="t in theme.themeList" :key="t.id" :value="t.id">{{ t.label }}</option>
  </select>
</template>
