<script setup>
// Form field: System Admins choose which program a new record belongs to.
// Directors never see it — the server pins their records to their program.
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
const model = defineModel({ type: String, default: '' });
const auth = useAuthStore();
const ctx = useProgramContext();
</script>

<template>
  <div v-if="auth.isSuperAdmin">
    <label class="label" for="pp-program">Program</label>
    <select id="pp-program" v-model="model" class="input" required>
      <option value="" disabled>Choose a program</option>
      <option v-for="p in ctx.activePrograms" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
  </div>
</template>
