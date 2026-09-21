<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { dateRange, longDate, timestamp } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import GameRow from '../components/GameRow.vue';
import PlacementPicker from '../components/PlacementPicker.vue';

const toast = useToast();
const overview = ref(null);
const loading = ref(true);
const rules = ref(null);
const generating = ref(false);

const RULE_FIELDS = [
  { key: 'gamesPerTeam', label: 'Games per team', help: 'Regular-season target for every team.', min: 1, max: 40 },
  { key: 'gameMinutes', label: 'Game length (minutes)', help: 'Each game slot is split into back-to-back games of this length.', min: 30, max: 180 },
  { key: 'maxTravelMiles', label: 'Travel cap (miles)', help: 'Straight-line distance from the away program to the gym.', min: 1, max: 500 },
  { key: 'minDaysBetween', label: 'Days between games', help: '1 = not on the same day; 2 = at least one day off in between.', min: 1, max: 7 },
  { key: 'maxGamesPerWeek', label: 'Games per week', help: 'Most games one team plays Monday–Sunday.', min: 1, max: 7 },
];

async function loadOverview() {
  const { data } = await api.get('/schedule/overview');
  overview.value = data;
  if (!rules.value) rules.value = { ...data.rules };
  if (!view.value || (view.value === 'draft' && !data.draft) || (view.value === 'published' && !data.published)) {
    view.value = data.draft ? 'draft' : data.published ? 'published' : null;
  }
}
onMounted(async () => {
  try { await loadOverview(); await loadGames(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
});

// ---- which run we're looking at ----
const view = ref(null); // 'draft' | 'published'
const run = computed(() => overview.value?.[view.value] || null);
const games = ref([]);
const gamesLoading = ref(false);
async function loadGames() {
  if (!run.value) { games.value = []; return; }
  gamesLoading.value = true;
  try { games.value = (await api.get(`/schedule/runs/${run.value.id}/games`)).data.games; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { gamesLoading.value = false; }
}
function setView(v) { if (view.value !== v) { view.value = v; loadGames(); } }

// ---- generate ----
const confirmRegenerate = ref(false);
async function generate() {
  confirmRegenerate.value = false;
  generating.value = true;
  try {
    const { data } = await api.post('/schedule/generate', { rules: rules.value });
    const s = data.draft.summary;
    toast.success(`Draft ready: ${s.scheduledGames} games placed${s.unscheduledGames ? `, ${s.unscheduledGames} to place by hand` : ''}.`);
    await loadOverview();
    view.value = 'draft';
    await loadGames();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { generating.value = false; }
}
const REMATCH_OPTIONS = [1, 2, 3, 4, 5, 6];
const rulesDirty = computed(() => overview.value && (
  RULE_FIELDS.some((f) => Number(rules.value?.[f.key]) !== overview.value.rules[f.key])
  || (rules.value?.maxVsSameOpponent ?? null) !== (overview.value.rules.maxVsSameOpponent ?? null)
  || !!rules.value?.allowSameProgram !== !!overview.value.rules.allowSameProgram));

// ---- live summary (recomputed from the games, so it reflects edits) ----
const stats = computed(() => {
  const placed = games.value.filter((g) => g.status === 'scheduled');
  const teams = new Map();
  const t = (id, name, division) => { if (!teams.has(id)) teams.set(id, { id, name, division, home: 0, away: 0 }); return teams.get(id); };
  for (const g of placed) { t(g.homeTeamId, g.homeTeamName, g.divisionName).home++; t(g.awayTeamId, g.awayTeamName, g.divisionName).away++; }
  for (const g of games.value) { t(g.homeTeamId, g.homeTeamName, g.divisionName); t(g.awayTeamId, g.awayTeamName, g.divisionName); }
  const list = [...teams.values()].map((x) => ({ ...x, games: x.home + x.away, gap: x.home - x.away }));
  const miles = placed.map((g) => g.travelMiles).filter((m) => m != null);
  const dates = placed.map((g) => g.date).sort();
  return {
    placed: placed.length,
    unplaced: games.value.filter((g) => g.status === 'unscheduled').length,
    cancelled: games.value.filter((g) => g.status === 'cancelled').length,
    conflicts: placed.filter((g) => g.hasBlackoutConflict).length,
    teams: list,
    balanced: list.filter((x) => Math.abs(x.gap) <= 1).length,
    maxTravel: miles.length ? Math.max(...miles) : null,
    avgTravel: miles.length ? Math.round((miles.reduce((a, b) => a + b, 0) / miles.length) * 10) / 10 : null,
    first: dates[0], last: dates.at(-1),
  };
});
const target = computed(() => run.value?.rules?.gamesPerTeam || 0);

// ---- list filters ----
const tab = ref('date');
const divisionFilter = ref('');
const divisions = computed(() => [...new Map(games.value.map((g) => [g.divisionId, g.divisionName])).entries()]);
const LIMIT_STEP = 150;
const limit = ref(LIMIT_STEP);
watch([tab, divisionFilter, view], () => { limit.value = LIMIT_STEP; });
const scoped = computed(() => games.value.filter((g) => !divisionFilter.value || g.divisionId === divisionFilter.value));
const unplacedList = computed(() => scoped.value.filter((g) => g.status === 'unscheduled'));
const placedList = computed(() => scoped.value.filter((g) => g.status !== 'unscheduled'));
const byDate = computed(() => {
  const m = new Map();
  for (const g of placedList.value.slice(0, limit.value)) { if (!m.has(g.date)) m.set(g.date, []); m.get(g.date).push(g); }
  return [...m.entries()];
});
const balanceRows = computed(() => stats.value.teams
  .filter((x) => !divisionFilter.value || games.value.some((g) => g.divisionId === divisionFilter.value && (g.homeTeamId === x.id || g.awayTeamId === x.id)))
  .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.games - b.games || a.name.localeCompare(b.name)));

// ---- edits ----
const editing = ref(null);
const choice = ref(null);
const saving = ref(false);
const editError = ref('');
function openEdit(g) { editing.value = g; choice.value = null; editError.value = ''; }
async function update(g, body, msg) {
  saving.value = true;
  editError.value = '';
  try {
    const { data } = await api.put(`/schedule/games/${g.id}`, body);
    const i = games.value.findIndex((x) => x.id === g.id);
    if (i >= 0) games.value[i] = data.game;
    const refs = data.referees;
    const refNote = refs && (refs.kept || refs.removed)
      ? ` Referees: ${refs.kept ? `${refs.kept} kept and notified` : ''}${refs.kept && refs.removed ? ', ' : ''}${refs.removed ? `${refs.removed} removed and notified` : ''}.` : '';
    toast.success(msg + refNote + (data.warnings?.length ? ` Note: ${data.warnings.join(' ')}` : ''));
    editing.value = null;
    if (body.courtId) games.value.sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.startTime || '').localeCompare(b.startTime || ''));
  } catch (err) {
    if (editing.value) editError.value = errorMessage(err); else toast.error(errorMessage(err));
  } finally { saving.value = false; }
}
const saveMove = () => update(editing.value, { courtId: choice.value.courtId, date: choice.value.date, startTime: choice.value.startTime, endTime: choice.value.endTime },
  editing.value.status === 'unscheduled' ? 'Game placed.' : 'Game moved.');

// ---- publish / discard ----
const confirmPublish = ref(false);
const confirmDiscard = ref(false);
const busy = ref(false);
async function publish() {
  busy.value = true;
  try {
    const { data } = await api.post(`/schedule/runs/${overview.value.draft.id}/publish`, { replace: !!overview.value.published });
    const r = data.referees || {};
    toast.success(`Schedule published. Everyone can see it now.${r.carried || r.dropped ? ` ${r.carried} referee assignment${r.carried === 1 ? '' : 's'} carried over${r.dropped ? `; ${r.dropped} need reassigning` : ''}.` : ''}`);
    confirmPublish.value = false;
    await loadOverview();
    view.value = 'published';
    await loadGames();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}
async function discard() {
  busy.value = true;
  try {
    await api.delete(`/schedule/runs/${overview.value.draft.id}`);
    toast.success('Draft discarded.');
    confirmDiscard.value = false;
    view.value = null;
    await loadOverview();
    await loadGames();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}
const publishMessage = computed(() => {
  const s = stats.value;
  let m = `${s.placed} games will be visible to every coach, director, and referee.`;
  if (s.unplaced) m += ` ${s.unplaced} unplaced pairing${s.unplaced === 1 ? '' : 's'} will be left off.`;
  if (overview.value?.published) m += ' This replaces the current published schedule, and any open change requests on it are cancelled.';
  const n = overview.value?.assignedAhead || 0;
  if (overview.value?.published && n) m += ` ${n} upcoming referee assignment${n === 1 ? '' : 's'} carry over only to games that didn’t change (same teams, date, time, and court). The rest need reassigning.`;
  return m;
});
</script>

<template>
  <div>
    <PageHeader title="Schedule builder" :subtitle="overview?.season ? `${overview.season.name} · ${dateRange(overview.season.startDate, overview.season.endDate)}` : 'Generate, review, and publish the season schedule'">
      <RouterLink to="/schedule" class="btn btn-secondary">View published schedule</RouterLink>
    </PageHeader>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!overview?.season" title="No active season" body="Set up the season under League setup before building a schedule.">
      <RouterLink to="/league" class="btn btn-primary">League setup</RouterLink>
    </EmptyState>

    <template v-else>
      <!-- Rules + generate -->
      <section class="card p-5 mb-5">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 class="font-semibold">Matchmaker rules</h2>
            <p class="text-sm text-text-muted">The matchmaker only pairs teams in the same division and only uses open weeknight and weekend game slots. It never books a court twice, schedules on a blackout day, or goes over the opponent limits below.</p>
          </div>
          <button class="btn btn-primary shrink-0" :disabled="generating" @click="overview.draft ? (confirmRegenerate = true) : generate()">
            {{ generating ? 'Building…' : overview.draft ? 'Regenerate draft' : 'Generate draft' }}
          </button>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div v-for="f in RULE_FIELDS" :key="f.key">
            <label class="label" :for="`rule-${f.key}`">{{ f.label }}</label>
            <input :id="`rule-${f.key}`" v-model.number="rules[f.key]" type="number" :min="f.min" :max="f.max" class="input" />
            <p class="text-xs text-text-muted mt-1">{{ f.help }}</p>
          </div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mt-4 pt-4 border-t border-border">
          <div>
            <label class="label" for="rule-maxVsSameOpponent">Most games against the same opponent</label>
            <select id="rule-maxVsSameOpponent" v-model="rules.maxVsSameOpponent" class="input">
              <option v-for="n in REMATCH_OPTIONS" :key="n" :value="n">{{ n }}</option>
              <option :value="null">No limit</option>
            </select>
            <p class="text-xs text-text-muted mt-1">2 lets each pair meet home and away. In small divisions a low limit can leave teams short of games; the notes will say so.</p>
          </div>
          <div class="sm:col-span-1 lg:col-span-2">
            <p class="label" id="rule-sameProgram-label">Teams from the same program can play each other</p>
            <button type="button" role="switch" :aria-checked="!!rules.allowSameProgram" aria-labelledby="rule-sameProgram-label"
              class="inline-flex items-center gap-3 py-1.5" @click="rules.allowSameProgram = !rules.allowSameProgram">
              <span class="relative w-11 h-6 rounded-full transition-colors" :class="rules.allowSameProgram ? 'bg-accent' : 'bg-border'">
                <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow transition-transform" :class="rules.allowSameProgram && 'translate-x-5'" />
              </span>
              <span class="text-sm font-semibold">{{ rules.allowSameProgram ? 'On' : 'Off' }}</span>
            </button>
            <p class="text-xs text-text-muted mt-1">Off: a program’s own teams (e.g. its Competitive and Developmental 6th Grade Girls) never play each other.</p>
          </div>
        </div>
        <p v-if="rulesDirty" class="text-xs mt-3 font-medium">Changed rules are saved when you generate.</p>
      </section>

      <!-- Which run -->
      <div v-if="overview.draft || overview.published" class="flex flex-wrap items-center gap-3 mb-4">
        <div v-if="overview.draft && overview.published" class="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="group" aria-label="Schedule version">
          <button class="px-3 py-1.5" :class="view === 'draft' ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" :aria-pressed="view === 'draft'" @click="setView('draft')">Draft</button>
          <button class="px-3 py-1.5" :class="view === 'published' ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" :aria-pressed="view === 'published'" @click="setView('published')">Published</button>
        </div>
        <p class="text-sm text-text-muted">
          <template v-if="view === 'draft'">Draft generated {{ timestamp(run.createdAt) }}. Only System Admins can see it.</template>
          <template v-else>Published {{ timestamp(run.publishedAt) }}. Edits here go live immediately and are logged.</template>
          <RouterLink v-if="overview.openRequests" to="/requests" class="underline ml-1">{{ overview.openRequests }} open change request{{ overview.openRequests === 1 ? '' : 's' }}</RouterLink>
        </p>
        <div v-if="view === 'draft'" class="flex gap-2 ml-auto">
          <button class="btn btn-secondary" @click="confirmDiscard = true">Discard draft</button>
          <button class="btn btn-primary" :disabled="!stats.placed" @click="confirmPublish = true">Publish schedule</button>
        </div>
      </div>

      <EmptyState v-if="!run" title="No schedule yet"
        body="Check the rules above, then generate a draft. Nothing is visible to coaches or directors until you publish it." />

      <template v-else>
        <!-- Summary -->
        <div class="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-5">
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Games placed</p><p class="text-2xl font-bold">{{ stats.placed }}</p><p class="text-xs text-text-muted">{{ stats.unplaced ? `${stats.unplaced} still to place` : 'Every pairing placed' }}</p></div>
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Home/away balance</p><p class="text-2xl font-bold">{{ stats.balanced }}<span class="text-sm font-medium text-text-muted"> / {{ stats.teams.length }}</span></p><p class="text-xs text-text-muted">teams within one game of 50/50</p></div>
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Longest trip</p><p class="text-2xl font-bold">{{ stats.maxTravel ?? '—' }}<span v-if="stats.maxTravel != null" class="text-sm font-medium text-text-muted"> mi</span></p><p class="text-xs text-text-muted">average {{ stats.avgTravel ?? '—' }} mi · cap {{ run.rules.maxTravelMiles }}</p></div>
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Season span</p><p class="text-base font-bold mt-1.5">{{ stats.first ? dateRange(stats.first, stats.last) : '—' }}</p><p class="text-xs text-text-muted">{{ run.rules.gamesPerTeam }} games per team target</p></div>
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Needs attention</p><p class="text-2xl font-bold">{{ stats.conflicts + stats.unplaced }}</p><p class="text-xs text-text-muted">{{ stats.conflicts }} blackout conflict{{ stats.conflicts === 1 ? '' : 's' }} · {{ stats.unplaced }} unplaced</p></div>
        </div>

        <section v-if="run.warnings?.length" class="card card-blocky p-4 mb-5">
          <h2 class="font-semibold text-sm mb-2">Notes from the matchmaker</h2>
          <ul class="space-y-1.5">
            <li v-for="w in run.warnings" :key="w" class="text-sm flex gap-2"><span class="w-1.5 h-1.5 rounded-full bg-warning mt-2 shrink-0" aria-hidden="true" />{{ w }}</li>
          </ul>
        </section>

        <!-- Games -->
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <div class="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="tablist">
            <button role="tab" class="px-3 py-1.5" :aria-selected="tab === 'date'" :class="tab === 'date' ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="tab = 'date'">By date</button>
            <button role="tab" class="px-3 py-1.5" :aria-selected="tab === 'unplaced'" :class="tab === 'unplaced' ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="tab = 'unplaced'">Unplaced ({{ stats.unplaced }})</button>
            <button role="tab" class="px-3 py-1.5" :aria-selected="tab === 'balance'" :class="tab === 'balance' ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="tab = 'balance'">Team balance</button>
          </div>
          <select v-model="divisionFilter" class="input !w-auto" aria-label="Division">
            <option value="">All divisions</option>
            <option v-for="[id, name] in divisions" :key="id" :value="id">{{ name }}</option>
          </select>
        </div>
        <p v-if="gamesLoading" class="text-sm text-text-muted">Loading games…</p>

        <template v-else-if="tab === 'date'">
          <EmptyState v-if="!placedList.length" title="No placed games" body="Nothing in this division has been placed yet." />
          <section v-for="[date, list] in byDate" :key="date" class="mb-4">
            <h3 class="text-sm font-semibold mb-1.5">{{ longDate(date) }}</h3>
            <ul class="card card-blocky divide-y divide-border">
              <li v-for="g in list" :key="g.id" class="px-4 py-2.5">
                <GameRow :game="g" show-travel>
                  <template #actions>
                    <button v-if="g.status === 'scheduled'" class="btn btn-ghost text-xs" @click="openEdit(g)">Move</button>
                    <button v-if="g.status === 'scheduled'" class="btn btn-ghost text-xs" :disabled="saving" title="Swap home and away" @click="update(g, { action: 'flip' }, 'Home and away swapped.')">Flip</button>
                    <button v-if="view === 'draft'" class="btn btn-ghost text-xs" :disabled="saving" @click="update(g, { action: 'unschedule' }, 'Moved to unplaced.')">Unplace</button>
                    <button v-else-if="g.status === 'scheduled'" class="btn btn-ghost text-xs hover:!text-danger" :disabled="saving" @click="update(g, { action: 'cancel' }, 'Game cancelled.')">Cancel</button>
                    <button v-else-if="g.status === 'cancelled'" class="btn btn-ghost text-xs" :disabled="saving" @click="update(g, { action: 'restore' }, 'Game restored.')">Restore</button>
                  </template>
                </GameRow>
              </li>
            </ul>
          </section>
          <div v-if="placedList.length > limit" class="text-center">
            <button class="btn btn-secondary" @click="limit += LIMIT_STEP">Show more ({{ placedList.length - limit }} left)</button>
          </div>
        </template>

        <template v-else-if="tab === 'unplaced'">
          <EmptyState v-if="!unplacedList.length" title="Everything is placed" body="Every pairing in this view has a date, time, and court." />
          <ul v-else class="card card-blocky divide-y divide-border">
            <li v-for="g in unplacedList" :key="g.id" class="px-4 py-2.5">
              <GameRow :game="g">
                <template #actions><button class="btn btn-secondary !py-1 !px-2.5 text-xs" @click="openEdit(g)">Place game</button></template>
              </GameRow>
            </li>
          </ul>
        </template>

        <div v-else class="card card-blocky overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-text-muted border-b border-border">
              <th class="px-4 py-2 font-medium">Team</th><th class="px-4 py-2 font-medium">Division</th>
              <th class="px-4 py-2 font-medium text-right">Games</th><th class="px-4 py-2 font-medium text-right">Home</th><th class="px-4 py-2 font-medium text-right">Away</th>
            </tr></thead>
            <tbody>
              <tr v-for="t in balanceRows" :key="t.id" class="border-b border-border last:border-0">
                <td class="px-4 py-2 font-medium">{{ t.name }}</td>
                <td class="px-4 py-2 text-text-muted">{{ t.division }}</td>
                <td class="px-4 py-2 text-right tabular-nums" :class="t.games < target && 'font-bold'">{{ t.games }}<span v-if="t.games < target" class="text-xs font-medium text-text-muted"> of {{ target }}</span></td>
                <td class="px-4 py-2 text-right tabular-nums" :class="Math.abs(t.gap) > 1 && 'font-bold'">{{ t.home }}</td>
                <td class="px-4 py-2 text-right tabular-nums" :class="Math.abs(t.gap) > 1 && 'font-bold'">{{ t.away }}</td>
              </tr>
            </tbody>
          </table>
          <p class="px-4 py-2 text-xs text-text-muted border-t border-border">Bold rows are more than one game off 50/50 or short of the target. Use Flip or Move on their games to even them out.</p>
        </div>
      </template>
    </template>

    <Modal v-if="editing" :title="editing.status === 'unscheduled' ? 'Place game' : 'Move game'" wide @close="editing = null">
      <div class="space-y-4">
        <div class="rounded-lg border border-border p-3">
          <p v-if="editing.date" class="text-xs text-text-muted mb-1">Currently {{ longDate(editing.date) }}</p>
          <GameRow :game="editing" compact />
        </div>
        <PlacementPicker v-model="choice" :game="editing" />
        <p v-if="editError" class="text-sm text-danger" role="alert">{{ editError }}</p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="editing = null">Cancel</button>
        <button class="btn btn-primary" :disabled="!choice || saving" @click="saveMove">{{ saving ? 'Saving…' : editing.status === 'unscheduled' ? 'Place game' : 'Move game' }}</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="confirmRegenerate" title="Regenerate the draft?" confirm-label="Regenerate" tone="primary" :busy="generating"
      message="This builds a fresh draft from the current rules, gym slots, and blackouts. Any edits you made to the current draft are lost. The published schedule isn’t affected."
      @confirm="generate" @close="confirmRegenerate = false" />
    <ConfirmDialog v-if="confirmPublish" title="Publish this schedule?" confirm-label="Publish schedule" tone="primary" :busy="busy" :message="publishMessage"
      @confirm="publish" @close="confirmPublish = false" />
    <ConfirmDialog v-if="confirmDiscard" title="Discard the draft?" confirm-label="Discard draft" :busy="busy"
      message="The draft and any edits to it are deleted. The published schedule isn’t affected." @confirm="discard" @close="confirmDiscard = false" />
  </div>
</template>
