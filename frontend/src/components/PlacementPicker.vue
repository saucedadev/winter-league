<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { longDate, time12 } from '../utils/format';

// Lists every open game window this game could move to (already filtered
// server-side by all scheduling rules). v-model is the chosen option.
const props = defineProps({ game: { type: Object, required: true }, modelValue: Object });
const emit = defineEmits(['update:modelValue']);

const options = ref([]);
const loading = ref(true);
const error = ref('');
const venueFilter = ref('');

onMounted(async () => {
  try { options.value = (await api.get(`/schedule/games/${props.game.id}/options`)).data.options; }
  catch (err) { error.value = errorMessage(err); }
  finally { loading.value = false; }
});

const venues = computed(() => [...new Map(options.value.map((o) => [o.venueId, o.venueName])).entries()]);
const grouped = computed(() => {
  const out = new Map();
  for (const o of options.value) {
    if (venueFilter.value && o.venueId !== venueFilter.value) continue;
    if (!out.has(o.date)) out.set(o.date, []);
    out.get(o.date).push(o);
  }
  return [...out.entries()];
});
const key = (o) => `${o.courtId}|${o.date}|${o.startTime}`;
const selectedKey = computed(() => (props.modelValue ? key(props.modelValue) : ''));
</script>

<template>
  <div>
    <p v-if="loading" class="text-sm text-text-muted">Finding open times…</p>
    <p v-else-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    <p v-else-if="!options.length" class="text-sm text-text-muted">
      No open game windows fit both teams. Programs can add weeknight or weekend game slots, or try a swap instead.
    </p>
    <template v-else>
      <div class="flex items-center justify-between gap-2 mb-2">
        <p class="text-xs text-text-muted">{{ options.length }} open time{{ options.length === 1 ? '' : 's' }} that fit both teams</p>
        <select v-if="venues.length > 1" v-model="venueFilter" class="input !w-auto !py-1 text-xs" aria-label="Filter by venue">
          <option value="">All venues</option>
          <option v-for="[id, name] in venues" :key="id" :value="id">{{ name }}</option>
        </select>
      </div>
      <div class="max-h-72 overflow-y-auto border border-border rounded-lg divide-y divide-border" role="radiogroup" aria-label="Open game times">
        <div v-for="[date, list] in grouped" :key="date">
          <p class="px-3 py-1.5 text-xs font-semibold bg-background sticky top-0">{{ longDate(date) }}</p>
          <label v-for="o in list" :key="key(o)"
            class="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-background"
            :class="selectedKey === key(o) && 'bg-background'">
            <input type="radio" name="placement" class="mt-1 accent-[var(--color-accent)]" :checked="selectedKey === key(o)" @change="emit('update:modelValue', o)" />
            <span class="text-sm min-w-0">
              <span class="font-medium">{{ time12(o.startTime) }}</span>
              <span class="text-text-muted"> · {{ o.venueName }} – {{ o.courtName }}</span>
              <span v-if="o.flip" class="flex items-center gap-1.5 text-xs font-medium"><span class="w-1.5 h-1.5 rounded-full bg-warning" aria-hidden="true" />{{ game.awayTeamName }} would become the home team</span>
              <span v-if="o.overTravelCap" class="flex items-center gap-1.5 text-xs font-medium"><span class="w-1.5 h-1.5 rounded-full bg-danger" aria-hidden="true" />{{ o.travelMiles }} miles: over the travel cap</span>
            </span>
          </label>
        </div>
      </div>
    </template>
  </div>
</template>
