<script setup>
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';

// League Admin on a program's page with "All programs" picked: offer to work
// as one program, so the page shows only its records and changes are logged
// as on behalf of it. The page still works across all programs without it.
defineProps({ what: { type: String, default: 'records' } });
const auth = useAuthStore();
const ctx = useProgramContext();
</script>

<template>
  <div v-if="auth.isSuperAdmin && !ctx.programId && ctx.activePrograms.length" class="card card-blocky px-4 py-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
    <label for="help-program" class="font-medium">Helping a program with its {{ what }}?</label>
    <select id="help-program" class="input !w-auto !py-1" :value="''" @change="ctx.select($event.target.value)">
      <option value="" disabled>Choose the program…</option>
      <option v-for="p in ctx.activePrograms" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <span class="text-text-muted">You’ll see only its {{ what }}, and changes are logged as on behalf of it.</span>
  </div>
</template>
