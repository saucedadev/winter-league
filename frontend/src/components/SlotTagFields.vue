<script setup>
import { computed } from 'vue';

// Day preferences: keep a game slot for Girls, Boys, or one division, as a
// priority (other games may use it if nothing else fits) or "only".
// v-model: { reservedFor: ''|'girls'|'boys'|'division', reservedDivisionId, reservedMode: 'prefer'|'only' }
const model = defineModel({ type: Object, required: true });
const props = defineProps({ divisions: { type: Array, default: () => [] }, idPrefix: { type: String, default: 'tag' } });

// One select for who the slot is for: '', 'girls', 'boys', or 'div:<id>'.
const who = computed({
  get: () => (model.value.reservedFor === 'division' ? `div:${model.value.reservedDivisionId || ''}` : model.value.reservedFor || ''),
  set: (v) => {
    const next = { ...model.value };
    if (v.startsWith('div:')) { next.reservedFor = 'division'; next.reservedDivisionId = v.slice(4); }
    else { next.reservedFor = v; next.reservedDivisionId = null; }
    if (next.reservedFor && !next.reservedMode) next.reservedMode = 'prefer';
    model.value = next;
  },
});
const setMode = (m) => { model.value = { ...model.value, reservedMode: m }; };
const label = computed(() => {
  if (!model.value.reservedFor) return '';
  if (model.value.reservedFor === 'division') return props.divisions.find((d) => d.id === model.value.reservedDivisionId)?.name || 'that division';
  return model.value.reservedFor === 'girls' ? 'girls’' : 'boys’';
});
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2">
    <div>
      <label class="label" :for="`${idPrefix}-who`">Keep for <span class="font-normal text-text-muted">(optional)</span></label>
      <select :id="`${idPrefix}-who`" v-model="who" class="input">
        <option value="">Any game</option>
        <option value="girls">Girls’ games</option>
        <option value="boys">Boys’ games</option>
        <optgroup label="One division">
          <option v-for="d in divisions" :key="d.id" :value="`div:${d.id}`">{{ d.name }}</option>
        </optgroup>
      </select>
    </div>
    <fieldset v-if="model.reservedFor">
      <legend class="label">How strictly?</legend>
      <div class="flex flex-col gap-1.5 text-sm">
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="radio" :name="`${idPrefix}-mode`" :checked="model.reservedMode !== 'only'" class="mt-1 accent-[var(--color-accent)]" @change="setMode('prefer')" />
          <span><strong>Priority</strong> <span class="text-text-muted">— {{ label }} games get it first; others only if nothing else fits.</span></span>
        </label>
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="radio" :name="`${idPrefix}-mode`" :checked="model.reservedMode === 'only'" class="mt-1 accent-[var(--color-accent)]" @change="setMode('only')" />
          <span><strong>Only</strong> <span class="text-text-muted">— no other games. If there aren’t enough {{ label }} games it stays empty.</span></span>
        </label>
      </div>
    </fieldset>
  </div>
</template>
