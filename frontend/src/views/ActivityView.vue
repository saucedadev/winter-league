<script setup>
import { onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import { timestamp } from '../utils/format';
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
    <PageHeader title="Activity" :subtitle="auth.isSuperAdmin ? 'Every change made across the league, newest first.' : 'Changes made to your program, newest first.'" />

    <div class="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filter activity">
      <button class="rounded-full border px-3 py-1 text-sm" :class="!category ? 'bg-accent text-accent-contrast border-accent' : 'border-border'" @click="category = ''">All</button>
      <button v-for="c in chips" :key="c" class="rounded-full border px-3 py-1 text-sm"
        :class="category === c ? 'bg-accent text-accent-contrast border-accent' : 'border-border'" @click="category = c">{{ CATEGORY_LABELS[c] }}</button>
    </div>

    <ol class="card card-blocky divide-y divide-border">
      <li v-for="e in entries" :key="e.id" class="px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
        <time class="text-text-muted w-32 shrink-0">{{ timestamp(e.createdAt) }}</time>
        <p class="flex-1 min-w-[14rem]">{{ e.details }}</p>
        <p class="text-text-muted">{{ e.actorName }}<template v-if="auth.isSuperAdmin && e.shortCode"> · {{ e.shortCode }}</template></p>
      </li>
      <li v-if="!entries.length && !loading" class="px-4 py-8 text-center text-sm text-text-muted">No activity recorded yet.</li>
    </ol>
    <div v-if="hasMore" class="mt-4 text-center"><button class="btn btn-secondary" :disabled="loading" @click="load(true)">Show older</button></div>
  </div>
</template>
