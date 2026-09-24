<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../stores/toast';
import { longDate, todayISO, timestamp, leagueTimeZoneLabel } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import GameRow from '../components/GameRow.vue';
import RequestChangeModal from '../components/RequestChangeModal.vue';
import ScoreModal from '../components/ScoreModal.vue';

const auth = useAuthStore();
const toast = useToast();
const data = ref(null);
const loading = ref(true);
const today = todayISO();

const hasOwn = computed(() => ['league_coach', 'program_director'].includes(auth.user.role));
const mine = ref(hasOwn.value);
const divisionId = ref('');
const programId = ref('');
const teamId = ref('');
const route = useRoute();
// ?needsScore=1 (from the dashboard): show played games still waiting for a score.
const needsScore = ref(route.query.needsScore === '1');
const showPast = ref(needsScore.value);
watch(needsScore, (on) => { if (on) showPast.value = true; });

async function load() {
  loading.value = true;
  try { data.value = (await api.get('/schedule/games')).data; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);

const games = computed(() => data.value?.games || []);
const isMine = (g) => (auth.user.role === 'league_coach'
  ? [g.homeCoachId, g.awayCoachId].includes(auth.user.id)
  : [g.homeProgramId, g.awayProgramId].includes(auth.user.programId));
const myTeamIds = computed(() => {
  const ids = new Set();
  for (const g of games.value) {
    if (auth.user.role === 'league_coach') {
      if (g.homeCoachId === auth.user.id) ids.add(g.homeTeamId);
      if (g.awayCoachId === auth.user.id) ids.add(g.awayTeamId);
    } else if (auth.user.programId) {
      if (g.homeProgramId === auth.user.programId) ids.add(g.homeTeamId);
      if (g.awayProgramId === auth.user.programId) ids.add(g.awayTeamId);
    }
  }
  return [...ids];
});

const uniq = (arr, key, label) => [...new Map(arr.map((g) => [g[key], g[label]])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
const divisions = computed(() => {
  const m = new Map();
  for (const g of games.value) m.set(g.divisionId, { name: g.divisionName, sort: g.divisionSort });
  return [...m.entries()].sort((a, b) => a[1].sort - b[1].sort).map(([id, v]) => [id, v.name]);
});
const programs = computed(() => uniq(games.value.flatMap((g) => [
  { id: g.homeProgramId, name: g.homeProgramName }, { id: g.awayProgramId, name: g.awayProgramName }]), 'id', 'name'));
const teams = computed(() => uniq(games.value
  .filter((g) => !divisionId.value || g.divisionId === divisionId.value)
  .flatMap((g) => [{ id: g.homeTeamId, name: g.homeTeamName }, { id: g.awayTeamId, name: g.awayTeamName }]), 'id', 'name'));
watch(divisionId, () => { teamId.value = ''; });

// Played games you can score that don't have one yet (worked out by the server, in league time).
const awaitingScore = (g) => g.needsScore;
const scoreCount = computed(() => games.value.filter(awaitingScore).length);
const filtered = computed(() => games.value.filter((g) => (showPast.value || g.date >= today)
  && (!needsScore.value || awaitingScore(g))
  && (!mine.value || isMine(g))
  && (!divisionId.value || g.divisionId === divisionId.value)
  && (!programId.value || [g.homeProgramId, g.awayProgramId].includes(programId.value))
  && (!teamId.value || [g.homeTeamId, g.awayTeamId].includes(teamId.value))));
const pastCount = computed(() => games.value.filter((g) => g.date < today).length);
const byDate = computed(() => {
  const m = new Map();
  for (const g of filtered.value) { if (!m.has(g.date)) m.set(g.date, []); m.get(g.date).push(g); }
  return [...m.entries()];
});

const requesting = ref(null);
const scoring = ref(null);
async function onScored() { scoring.value = null; await load(); }
async function onCreated() { requesting.value = null; await load(); }
</script>

<template>
  <div>
    <PageHeader title="Schedule"
      :subtitle="data?.published ? `${data.season.name} · published ${timestamp(data.publishedAt)} · All times ${leagueTimeZoneLabel()}` : 'League games for the active season'">
      <RouterLink v-if="auth.isSuperAdmin" to="/schedule/builder" class="btn btn-secondary">Open schedule builder</RouterLink>
    </PageHeader>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!data?.published" title="The schedule hasn’t been published yet"
      :body="auth.isSuperAdmin ? 'Generate a draft in the schedule builder, review it, then publish it here for everyone.' : 'Games show up here as soon as the league publishes the season schedule.'">
      <RouterLink v-if="auth.isSuperAdmin" to="/schedule/builder" class="btn btn-primary">Go to schedule builder</RouterLink>
    </EmptyState>

    <template v-else>
      <div class="card card-blocky p-3 mb-4 flex flex-wrap items-center gap-2">
        <div v-if="hasOwn" class="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="group" aria-label="Which games">
          <button class="px-3 py-1.5" :class="mine ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" :aria-pressed="mine" @click="mine = true">{{ auth.user.role === 'league_coach' ? 'My teams' : 'My program' }}</button>
          <button class="px-3 py-1.5" :class="!mine ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" :aria-pressed="!mine" @click="mine = false">Whole league</button>
        </div>
        <select v-model="divisionId" class="input !w-auto" aria-label="Division">
          <option value="">All divisions</option>
          <option v-for="[id, name] in divisions" :key="id" :value="id">{{ name }}</option>
        </select>
        <select v-if="!mine" v-model="programId" class="input !w-auto" aria-label="Program">
          <option value="">All programs</option>
          <option v-for="[id, name] in programs" :key="id" :value="id">{{ name }}</option>
        </select>
        <select v-model="teamId" class="input !w-auto max-w-[14rem]" aria-label="Team">
          <option value="">All teams</option>
          <option v-for="[id, name] in teams" :key="id" :value="id">{{ name }}</option>
        </select>
        <label v-if="scoreCount || needsScore" class="text-sm flex items-center gap-2 ml-auto"><input v-model="needsScore" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Needs a score ({{ scoreCount }})</label>
        <label v-if="pastCount" class="text-sm flex items-center gap-2" :class="!(scoreCount || needsScore) && 'ml-auto'"><input v-model="showPast" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Show past games</label>
      </div>

      <p class="text-xs text-text-muted mb-2">{{ filtered.length }} game{{ filtered.length === 1 ? '' : 's' }}</p>
      <EmptyState v-if="!filtered.length && needsScore" title="Every played game has a score" body="Nothing is waiting for a final score." />
      <EmptyState v-else-if="!filtered.length" title="No games match" body="Try a different division or team, or switch to the whole league." />
      <section v-for="[date, list] in byDate" :key="date" class="mb-4">
        <h2 class="text-sm font-semibold mb-1.5" :class="date < today && 'text-text-muted'">{{ longDate(date) }}</h2>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="g in list" :key="g.id" class="px-4 py-2.5">
            <GameRow :game="g" :highlight-team-ids="myTeamIds" show-referees>
              <template #actions>
                <RouterLink v-if="g.hasOpenRequest && hasOwn && isMine(g)" to="/requests" class="btn btn-ghost text-xs">View request</RouterLink>
                <button v-else-if="g.canRequest" class="btn btn-secondary !py-1 !px-2.5 text-xs" @click="requesting = g">Request change</button>
                <button v-if="g.canScore" class="btn !py-1 !px-2.5 text-xs" :class="g.hasScore ? 'btn-ghost' : 'btn-primary'" @click="scoring = g">{{ g.hasScore ? 'Edit score' : 'Enter score' }}</button>
              </template>
            </GameRow>
          </li>
        </ul>
      </section>
    </template>

    <RequestChangeModal v-if="requesting" :game="requesting" @close="requesting = null" @created="onCreated" />
    <ScoreModal v-if="scoring" :game="scoring" @close="scoring = null" @saved="onScored" />
  </div>
</template>
