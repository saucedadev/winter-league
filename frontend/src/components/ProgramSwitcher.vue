<script setup>
import { useProgramContext } from '../stores/programContext';
const ctx = useProgramContext();
</script>

<template>
  <label class="flex items-center gap-2 text-sm">
    <span class="sr-only">Program</span>
    <select :value="ctx.selectedId" class="rounded-lg border border-border bg-surface text-text pl-2 pr-7 py-1.5 max-w-[11rem]"
      aria-label="Program" @change="ctx.select($event.target.value)">
      <option value="">All programs</option>
      <!-- Active programs only; an inactive one comes back when it's reactivated (Programs page). -->
      <option v-for="p in ctx.activePrograms" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
  </label>
</template>
