<script setup>
import { computed } from 'vue';
import { divisionsLabel } from '../utils/divisionsLabel';

// Day preferences: keep a game slot for any mix of divisions (e.g. 4th–6th
// Grade Boys and Girls), as a priority (other games may use it if nothing else
// fits) or "only".
// v-model: { reservedDivisionIds: [id, ...], reservedMode: 'prefer'|'only' }
const model = defineModel({ type: Object, required: true });
const props = defineProps({ divisions: { type: Array, default: () => [] }, idPrefix: { type: String, default: 'tag' } });

const selected = computed(() => new Set(model.value.reservedDivisionIds || []));
const setIds = (ids) => { model.value = { ...model.value, reservedDivisionIds: [...new Set(ids)], reservedMode: model.value.reservedMode || 'prefer' }; };
const toggle = (id) => { const s = new Set(selected.value); s.has(id) ? s.delete(id) : s.add(id); setIds([...s]); };
// Select the whole group, or clear it if it's all selected already.
function toggleGroup(list) {
  const ids = list.map((d) => d.id);
  const all = ids.every((id) => selected.value.has(id));
  setIds(all ? [...selected.value].filter((id) => !ids.includes(id)) : [...selected.value, ...ids]);
}
const setMode = (m) => { model.value = { ...model.value, reservedMode: m }; };

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
// Grade rows × gender columns; divisions without a grade are listed after.
const GENDERS = [['boys', 'Boys'], ['girls', 'Girls'], ['coed', 'Coed']];
const columns = computed(() => GENDERS.filter(([g]) => props.divisions.some((d) => d.gender === g && d.grade)));
const rows = computed(() => {
  const grades = [...new Set(props.divisions.filter((d) => d.grade).map((d) => String(d.grade)))]
    .sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  return grades.map((grade) => ({
    grade,
    label: /^\d+$/.test(grade) ? `${ordinal(Number(grade))} grade` : grade,
    cells: columns.value.map(([g]) => props.divisions.find((d) => String(d.grade) === grade && d.gender === g) || null),
  }));
});
const ungraded = computed(() => props.divisions.filter((d) => !d.grade));
const ofGender = (g) => props.divisions.filter((d) => d.gender === g);
const label = computed(() => divisionsLabel([...selected.value], props.divisions));
const any = computed(() => selected.value.size > 0);
</script>

<template>
  <div class="space-y-3">
    <fieldset>
      <legend class="label">Keep for <span class="font-normal text-text-muted">(optional; tick any mix of divisions)</span></legend>
      <div class="flex flex-wrap gap-1.5 mb-2">
        <button v-for="[g, name] in columns" :key="g" type="button" class="btn btn-secondary !py-1 !px-2.5 text-xs" @click="toggleGroup(ofGender(g))">All {{ name.toLowerCase() }}</button>
        <button type="button" class="btn btn-ghost !py-1 !px-2.5 text-xs" :disabled="!any" @click="setIds([])">Clear</button>
      </div>
      <table v-if="rows.length" class="text-sm">
        <thead>
          <tr>
            <th class="sr-only">Grade</th>
            <th v-for="[g, name] in columns" :key="g" class="px-2 pb-1 font-medium text-text-muted text-center">
              <button type="button" class="hover:underline" :title="`Select every ${name.toLowerCase()} division`" @click="toggleGroup(ofGender(g))">{{ name }}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.grade">
            <th scope="row" class="pr-3 py-1 text-left font-normal">
              <button type="button" class="hover:underline" :title="`Select all of ${r.label}`" @click="toggleGroup(r.cells.filter(Boolean))">{{ r.label }}</button>
            </th>
            <td v-for="(d, i) in r.cells" :key="i" class="px-2 py-1 text-center">
              <input v-if="d" :id="`${idPrefix}-d-${d.id}`" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
                :checked="selected.has(d.id)" :aria-label="d.name" @change="toggle(d.id)" />
              <span v-else class="text-text-muted" aria-hidden="true">–</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="ungraded.length" class="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-sm">
        <label v-for="d in ungraded" :key="d.id" class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" :checked="selected.has(d.id)" @change="toggle(d.id)" />{{ d.name }}
        </label>
      </div>
      <p class="text-xs mt-2" :class="any ? 'font-medium' : 'text-text-muted'">{{ any ? `Kept for: ${label}` : 'Any game can use these slots.' }}</p>
    </fieldset>
    <fieldset v-if="any">
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
