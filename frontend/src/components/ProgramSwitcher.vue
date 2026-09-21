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
      <option v-for="p in ctx.programs" :key="p.id" :value="p.id">{{ p.name }}{{ p.isActive ? '' : ' (inactive)' }}</option>
    </select>
  </label>
</template>
