<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { addDays, dateRange, longDate, startOfWeek, todayISO } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import GameRow from '../components/GameRow.vue';
import RefSlotModal from '../components/RefSlotModal.vue';

const toast = useToast();
const data = ref(null);
const loading = ref(true);
const weekStart = ref(startOfWeek(todayISO()));
const onlyOpen = ref(false);
const weekEnd = computed(() => addDays(weekStart.value, 6));

async function load() {
  loading.value = true;
  try { data.value = (await api.get('/referees/games', { params: { from: weekStart.value, to: weekEnd.value } })).data; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
// Start on the first week that actually has games (the season may not have begun).
onMounted(async () => {
  try {
    const all = (await api.get('/referees/games')).data;
    if (all.published && all.games.length && all.games[0].date > weekEnd.value) weekStart.value = startOfWeek(all.games[0].date);
  } catch { /* fall through to load() */ }
  await load();
});
function shiftWeek(n) { weekStart.value = addDays(weekStart.value, n * 7); load(); }
function thisWeek() { weekStart.value = startOfWeek(todayISO()); load(); }

const games = computed(() => (data.value?.games || []).filter((g) => !onlyOpen.value || g.assignments.some((a) => !a.refereeId)));
const byDate = computed(() => {
  const m = new Map();
  for (const g of games.value) { if (!m.has(g.date)) m.set(g.date, []); m.get(g.date).push(g); }
  return [...m.entries()];
});
const weekSlots = computed(() => (data.value?.games || []).flatMap((g) => g.assignments));
const weekOpen = computed(() => weekSlots.value.filter((a) => !a.refereeId).length);

const editing = ref(null);
function onSaved(game) {
  const i = data.value.games.findIndex((g) => g.id === game.id);
  if (i >= 0) data.value.games[i] = game;
  editing.value = null;
  refreshCounts();
}
async function refreshCounts() {
  try { data.value.upcoming = (await api.get('/referees/games', { params: { from: '9999-12-31' } })).data.upcoming; } catch { /* counts are cosmetic */ }
}

const fillScope = ref(null); // 'week' | 'all'
const filling = ref(false);
async function autoFill() {
  filling.value = true;
  try {
    const body = fillScope.value === 'week' ? { from: weekStart.value, to: weekEnd.value } : {};
    const { data: r } = await api.post('/referees/auto-fill', body);
    toast.success(r.filled ? `Filled ${r.filled} slot${r.filled === 1 ? '' : 's'}.${r.stillOpen ? ` ${r.stillOpen} still need someone. Nobody free fits them without a conflict.` : ''}` : r.stillOpen ? `Nobody free fits the ${r.stillOpen} open slot${r.stillOpen === 1 ? '' : 's'} without a conflict.` : 'Every slot is already filled.');
    fillScope.value = null;
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { filling.value = false; }
}

const pillClass = (a) => (!a.refereeId ? 'border-dashed border-border text-text-muted'
  : a.status === 'checked_in' ? 'border-success' : a.status === 'no_show' ? 'border-danger' : 'border-border');
const today = computed(() => data.value?.today || todayISO());
</script>

<template>
  <div>
    <PageHeader title="Referee assignments"
      :subtitle="data?.published ? `${data.upcoming.slots - data.upcoming.open} of ${data.upcoming.slots} upcoming referee slots filled · ${data.settings.refereesPerGame} per game` : 'Put referees on published games'">
      <template v-if="data?.published">
        <button class="btn btn-secondary" :disabled="!weekOpen" @click="fillScope = 'week'">Auto-fill this week</button>
        <button class="btn btn-primary" :disabled="!data.upcoming.open" @click="fillScope = 'all'">Auto-fill all upcoming</button>
      </template>
    </PageHeader>

    <p v-if="loading && !data" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!data?.published" title="No published schedule yet" body="Referee slots appear here as soon as the league publishes the season schedule." />

    <template v-else>
      <div class="card card-blocky p-3 mb-4 flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-1">
          <button class="btn btn-ghost" aria-label="Previous week" @click="shiftWeek(-1)">‹</button>
          <span class="text-sm font-semibold min-w-[10rem] text-center">{{ dateRange(weekStart, weekEnd) }}</span>
          <button class="btn btn-ghost" aria-label="Next week" @click="shiftWeek(1)">›</button>
        </div>
        <button class="btn btn-ghost text-sm" @click="thisWeek">This week</button>
        <label class="text-sm flex items-center gap-2"><input v-model="onlyOpen" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Only games needing referees</label>
        <p class="text-sm ml-auto" :class="weekOpen ? 'font-semibold' : 'text-text-muted'">{{ weekOpen ? `${weekOpen} open slot${weekOpen === 1 ? '' : 's'} this week` : 'This week is fully covered' }}</p>
      </div>

      <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
      <EmptyState v-else-if="!games.length" :title="onlyOpen ? 'Every game this week has referees' : 'No games this week'" body="Use the arrows to move between weeks." />
      <section v-for="[date, list] in byDate" :key="date" class="mb-4">
        <h2 class="text-sm font-semibold mb-1.5">{{ longDate(date) }}<span v-if="date < today" class="text-text-muted font-normal"> · played</span></h2>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="g in list" :key="g.id" class="px-4 py-2.5 flex flex-wrap items-center gap-3">
            <GameRow :game="g" compact class="flex-1 min-w-[16rem]" />
            <div class="flex flex-wrap gap-2">
              <button v-for="a in g.assignments" :key="a.id" class="rounded-lg border-2 px-2.5 py-1 text-xs text-left min-w-[8.5rem] hover:bg-background" :class="pillClass(a)"
                :aria-label="a.refereeId ? `Referee ${a.position}: ${a.refereeName}. Change` : `Referee ${a.position}: open. Assign`" @click="editing = { slot: a, game: g }">
                <span class="block text-[0.625rem] uppercase tracking-wide text-text-muted">Referee {{ a.position }}</span>
                <span class="block font-semibold truncate">{{ a.refereeName || 'Assign' }}</span>
                <span v-if="a.status === 'checked_in'" class="block text-[0.6875rem]">✓ Worked</span>
                <span v-else-if="a.status === 'no_show'" class="block text-[0.6875rem]">No-show</span>
              </button>
            </div>
          </li>
        </ul>
      </section>
      <p class="text-xs text-text-muted mt-2">Manage the roster and pay rates on <RouterLink to="/referees" class="underline">Referees</RouterLink>.</p>
    </template>

    <RefSlotModal v-if="editing" :slot="editing.slot" :game="editing.game" :today="today" @close="editing = null" @saved="onSaved" />
    <ConfirmDialog v-if="fillScope" tone="primary" :busy="filling" :confirm-label="filling ? 'Filling…' : 'Auto-fill'"
      :title="fillScope === 'week' ? 'Auto-fill this week?' : 'Auto-fill every upcoming game?'"
      message="Open slots are filled with whoever has the fewest games so far. Nobody is double-booked, put on a day they marked unavailable, or given back-to-back games at different gyms. Referees get an email for each new game. Slots already filled aren’t changed."
      @confirm="autoFill" @close="fillScope = null" />
  </div>
</template>
