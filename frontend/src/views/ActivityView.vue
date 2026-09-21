<script setup>
import { onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import { ROLE_LABELS, timestamp } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';

const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();
const entries = ref([]);
const hasMore = ref(false);
const category = ref('');
const loading = ref(false);

const CATEGORY_LABELS = { slot: 'Gym slots', blackout: 'Blackouts', venue: 'Venues', team: 'Teams', program: 'Programs', season: 'Seasons', division: 'Divisions', user: 'Users', schedule: 'Schedule', request: 'Change requests', referee: 'Referees' };
const chips = auth.isSuperAdmin ? Object.keys(CATEGORY_LABELS) : ['slot', 'blackout', 'venue', 'team', 'request'];

// Beside the name: the person's own program (as it was when they acted), or
// their role for league-wide accounts, e.g. "Misty Sauceda · GYB",
// "Grace Kim · System Admin".
function actorTag(e) {
  if (e.actorProgramCode) return e.actorProgramCode;
  return e.actorRole ? ROLE_LABELS[e.actorRole] : '';
}
// "Involves" line: always when more than one program is involved; for a
// System Admin also when it's one program (they see every program's activity).
const showInvolves = (e) => e.programs.length > 1 || (auth.isSuperAdmin && e.programs.length === 1);

async function load(more = false) {
  loading.value = true;
  try {
    const params = { ...ctx.query, ...(category.value ? { category: category.value } : {}), ...(more ? { before: entries.value.at(-1)?.createdAt } : {}) };
    const { data } = await api.get('/activity', { params });
    entries.value = more ? [...entries.value, ...data.entries] : data.entries;
    hasMore.value = data.hasMore;
  } catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(() => load());
watch(category, () => load());
</script>

<template>
  <div>
    <PageHeader title="Activity" :subtitle="auth.isSuperAdmin ? 'Every change made across the league, newest first.' : 'Changes involving your program, including ones made by other programs and the league, newest first.'" />

    <div class="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filter activity">
      <button class="rounded-full border px-3 py-1 text-sm" :class="!category ? 'bg-accent text-accent-contrast border-accent' : 'border-border'" @click="category = ''">All</button>
      <button v-for="c in chips" :key="c" class="rounded-full border px-3 py-1 text-sm"
        :class="category === c ? 'bg-accent text-accent-contrast border-accent' : 'border-border'" @click="category = c">{{ CATEGORY_LABELS[c] }}</button>
    </div>

    <ol class="card card-blocky divide-y divide-border">
      <li v-for="e in entries" :key="e.id" class="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
        <time class="text-text-muted w-32 shrink-0">{{ timestamp(e.createdAt) }}</time>
        <div class="flex-1 min-w-[14rem]">
          <p>{{ e.details }}</p>
          <p v-if="showInvolves(e)" class="text-xs text-text-muted mt-0.5">Involves: {{ e.programs.map((p) => p.name).join(', ') }}</p>
        </div>
        <p class="text-text-muted">{{ e.actorName }}<template v-if="actorTag(e)"> · <span :title="e.actorProgramName || undefined">{{ actorTag(e) }}</span></template></p>
      </li>
      <li v-if="!entries.length && !loading" class="px-4 py-8 text-center text-sm text-text-muted">No activity recorded yet.</li>
    </ol>
    <div v-if="hasMore" class="mt-4 text-center"><button class="btn btn-secondary" :disabled="loading" @click="load(true)">Show older</button></div>
  </div>
</template>
