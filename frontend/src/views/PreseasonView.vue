<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useRequestBadge } from '../stores/requestBadge';
import { dateRange, longDate, monthDay, timeRange, timestamp, weekday } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';

// Preseason: before the regular season, teams that are ready arrange
// scrimmages and joint practices with each other. A director opens their teams,
// finds an open team (same division, optionally one grade either side), picks a
// time when one program has open preseason gym time and both teams are free,
// and asks. The other director accepts or declines. The league sees it all.
const toast = useToast();
const auth = useAuthStore();
const ctx = useProgramContext();
const badge = useRequestBadge();
const isDirector = computed(() => auth.user?.role === 'program_director');
const isAdmin = computed(() => auth.isSuperAdmin);
// A director, or a System Admin who picked one program in the header, arranges games.
const canArrange = computed(() => isDirector.value || (isAdmin.value && !!ctx.programId));

const info = ref(null);
const events = ref([]);
const loading = ref(true);
async function load() {
  loading.value = true;
  try {
    const params = isAdmin.value && ctx.programId ? { programId: ctx.programId } : {};
    const [o, e] = await Promise.all([api.get('/preseason', { params }), api.get('/preseason/events', { params })]);
    info.value = o.data;
    events.value = e.data.events;
    if (!myTeamId.value || !openTeams.value.some((t) => t.id === myTeamId.value)) myTeamId.value = openTeams.value[0]?.id || '';
  } catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);
watch(() => ctx.programId, () => { opponents.value = null; times.value = null; load(); });
const refresh = async () => { await load(); badge.refresh(); if (myTeamId.value) loadBoard(); };

const win = computed(() => info.value?.window);
const isOpen = computed(() => !!info.value?.isOpen);

// ---- your teams ----
const teams = computed(() => info.value?.teams || []);
const openTeams = computed(() => teams.value.filter((t) => t.preseasonOpen));
const busyTeams = ref(false);
async function setOpen(payload, open) {
  busyTeams.value = true;
  try {
    await api.put('/preseason/teams', { ...payload, open, ...(isAdmin.value ? { programId: ctx.programId } : {}) });
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busyTeams.value = false; }
}

// ---- find an opponent ----
const myTeamId = ref('');
const wider = ref(false);
const opponents = ref(null);
const boardLoading = ref(false);
async function loadBoard() {
  if (!myTeamId.value) { opponents.value = null; return; }
  boardLoading.value = true;
  try { opponents.value = (await api.get('/preseason/board', { params: { teamId: myTeamId.value, wider: wider.value ? 1 : 0 } })).data.opponents; }
  catch (err) { opponents.value = null; toast.error(errorMessage(err)); }
  finally { boardLoading.value = false; }
}
watch([myTeamId, wider], () => { times.value = null; loadBoard(); });
const myTeam = computed(() => teams.value.find((t) => t.id === myTeamId.value));

const times = ref(null); // { opponent, kind, list, more }
const timesLoading = ref(false);
async function showTimes(o, kind = 'scrimmage') {
  timesLoading.value = true;
  try {
    const { data } = await api.get('/preseason/times', { params: { teamId: myTeamId.value, opponentId: o.id, kind } });
    times.value = { opponent: o, kind, list: data.times, more: data.more };
  } catch (err) { toast.error(errorMessage(err)); }
  finally { timesLoading.value = false; }
}
const timesByDay = computed(() => {
  const m = new Map();
  for (const t of times.value?.list || []) { if (!m.has(t.date)) m.set(t.date, []); m.get(t.date).push(t); }
  return [...m.entries()];
});

// ---- request ----
const asking = ref(null); // { time, refereesWanted, note }
const askError = ref('');
const saving = ref(false);
async function sendRequest() {
  askError.value = '';
  saving.value = true;
  const t = asking.value.time;
  try {
    await api.post('/preseason/requests', {
      teamId: myTeamId.value, opponentId: times.value.opponent.id, kind: times.value.kind,
      slotId: t.slotId, date: t.date, startTime: t.startTime, endTime: t.endTime, refereesWanted: asking.value.refereesWanted, note: asking.value.note,
    });
    toast.success(`Request sent to ${times.value.opponent.programName}. You’ll get an email when they answer.`);
    asking.value = null;
    times.value = null;
    await refresh();
  } catch (err) { askError.value = errorMessage(err); }
  finally { saving.value = false; }
}

// ---- requests and arranged events ----
const waiting = computed(() => events.value.filter((e) => e.status === 'requested' && e.needsMe));
const sent = computed(() => events.value.filter((e) => e.status === 'requested' && !e.needsMe));
const arranged = computed(() => events.value.filter((e) => e.status === 'accepted'));
const history = computed(() => events.value.filter((e) => ['declined', 'withdrawn', 'cancelled'].includes(e.status)));
const refsOnly = ref(false);
const arrangedShown = computed(() => arranged.value.filter((e) => !refsOnly.value || e.refereesWanted));

const answering = ref(null); // { e, decision, note }
const acting = ref('');
async function respond() {
  const a = answering.value;
  saving.value = true;
  try {
    await api.post(`/preseason/events/${a.e.id}/respond`, { decision: a.decision, note: a.note, ...(isAdmin.value ? { programId: ctx.programId } : {}) });
    toast.success(a.decision === 'accept' ? 'Accepted. It’s on both teams’ schedules.' : 'Declined. They’ve been told.');
    answering.value = null;
    await refresh();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}
async function withdraw(e) {
  acting.value = e.id;
  try { await api.post(`/preseason/events/${e.id}/withdraw`); toast.success('Request withdrawn.'); await refresh(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { acting.value = ''; }
}
const cancelling = ref(null); // { e, reason }
async function cancelEvent() {
  saving.value = true;
  try {
    await api.post(`/preseason/events/${cancelling.value.e.id}/cancel`, { reason: cancelling.value.reason });
    toast.success('Cancelled. The other program has been told.');
    cancelling.value = null;
    await refresh();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}
const ourSide = (e) => (auth.user?.programId === e.hostProgramId || ctx.programId === e.hostProgramId ? 'host' : 'visitor');
const opponentOf = (e) => (ourSide(e) === 'host' ? `${e.visitorTeamName} (${e.visitorProgramName})` : `${e.hostTeamName} (${e.hostProgramName})`);
const ourTeamOf = (e) => (ourSide(e) === 'host' ? e.hostTeamName : e.visitorTeamName);
</script>

<template>
  <div>
    <PageHeader title="Preseason"
      :subtitle="win ? `Scrimmages and joint practices before the regular season: ${dateRange(win.first, win.last)}. They don’t count toward standings, games per team, or home/away balance.` : 'Scrimmages and joint practices before the regular season.'" />

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!win" title="No preseason this season"
      :body="isAdmin ? 'Add a “Preseason opens” date to the season under League setup. Programs can then add gym time from that date and arrange scrimmages.' : 'The league hasn’t set up a preseason for this season.'">
      <RouterLink v-if="isAdmin" to="/league" class="btn btn-primary">League setup</RouterLink>
    </EmptyState>

    <div v-else class="space-y-5">
      <div v-if="!isOpen" class="card card-blocky border-l-4 border-l-warning px-4 py-3 text-sm">The preseason ended on {{ longDate(win.last) }}. What was arranged is listed below.</div>
      <div v-else-if="isAdmin && !ctx.programId" class="card card-blocky border-l-4 border-l-accent px-4 py-3 text-sm">
        {{ info.openTeams }} team{{ info.openTeams === 1 ? ' is' : 's are' }} open for preseason. Directors arrange scrimmages themselves; you see everything here and can cancel. Choose a program in the header to arrange one on its behalf.
      </div>

      <!-- Your teams -->
      <section v-if="canArrange && isOpen" class="card card-blocky p-4">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <h2 class="font-semibold mr-auto">Your teams</h2>
          <button class="btn btn-secondary !py-1 text-sm" :disabled="busyTeams || teams.every((t) => t.preseasonOpen)" @click="setOpen({ all: true }, true)">Open all</button>
          <button class="btn btn-ghost !py-1 text-sm" :disabled="busyTeams || !openTeams.length" @click="setOpen({ all: true }, false)">Close all</button>
        </div>
        <p class="text-sm text-text-muted mb-3">Open a team when it’s ready for scrimmages (tryouts done, roster set). Other programs can then find it and ask. Closing a team doesn’t cancel anything already arranged.</p>
        <ul class="flex flex-wrap gap-2">
          <li v-for="t in teams" :key="t.id">
            <button class="badge !text-sm !py-1 !px-3 cursor-pointer" :class="t.preseasonOpen ? 'bg-success text-black' : 'badge-outline'" :aria-pressed="t.preseasonOpen" :disabled="busyTeams"
              @click="setOpen({ teamIds: [t.id] }, !t.preseasonOpen)">{{ t.name }}{{ t.preseasonOpen ? ' · open ✓' : '' }}</button>
          </li>
        </ul>
      </section>

      <!-- Waiting for you -->
      <section v-if="waiting.length" class="space-y-2">
        <h2 class="font-semibold">{{ isAdmin && ctx.current ? `Waiting for ${ctx.current.name}’s answer` : 'Waiting for your answer' }}</h2>
        <article v-for="e in waiting" :key="e.id" class="card p-4 border-2 !border-accent">
          <p class="font-semibold">{{ e.kindLabel }}: {{ ourTeamOf(e) }} vs {{ opponentOf(e) }}</p>
          <p class="text-sm">{{ longDate(e.date) }}, {{ timeRange(e.startTime, e.endTime) }} · {{ e.venueName }} – {{ e.courtName }} <span class="text-text-muted">({{ ourSide(e) === 'host' ? 'your gym' : 'their gym' }})</span></p>
          <p class="text-xs text-text-muted mt-1">Asked by {{ e.requestedByName }} {{ timestamp(e.requestedAt) }}<template v-if="e.refereesWanted"> · they’d like referees</template></p>
          <p v-if="e.note" class="text-sm mt-1 italic">“{{ e.note }}”</p>
          <div class="flex flex-wrap justify-end gap-2 mt-3">
            <button class="btn btn-secondary" @click="answering = { e, decision: 'decline', note: '' }">Decline</button>
            <button class="btn btn-primary" @click="answering = { e, decision: 'accept', note: '' }">Accept</button>
          </div>
        </article>
      </section>

      <!-- Find an opponent -->
      <section v-if="canArrange && isOpen" class="card card-blocky p-4">
        <h2 class="font-semibold mb-3">Find an opponent</h2>
        <p v-if="!openTeams.length" class="text-sm text-text-muted">Open one of your teams above first.</p>
        <template v-else>
          <div class="flex flex-wrap items-end gap-3 mb-3">
            <div><label class="label" for="ps-team">Your team</label>
              <select id="ps-team" v-model="myTeamId" class="input !w-auto"><option v-for="t in openTeams" :key="t.id" :value="t.id">{{ t.name }}</option></select></div>
            <label class="flex items-center gap-2 text-sm pb-2"><input v-model="wider" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Include teams one grade up or down</label>
          </div>
          <p v-if="boardLoading" class="text-sm text-text-muted">Looking…</p>
          <p v-else-if="opponents && !opponents.length" class="text-sm text-text-muted">No other {{ wider ? 'nearby-grade' : myTeam?.divisionName }} team is open for preseason yet. Check back later, or include teams one grade up or down.</p>
          <ul v-else-if="opponents" class="divide-y divide-border rounded-lg border border-border">
            <li v-for="o in opponents" :key="o.id" class="px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span class="flex-1 min-w-[12rem]"><span class="font-medium">{{ o.name }}</span> <span class="text-text-muted">· {{ o.programName }}</span>
                <span class="block text-xs text-text-muted">{{ o.divisionName }}{{ o.sameDivision ? '' : ' (different grade)' }}<template v-if="o.miles != null"> · about {{ o.miles }} mi away</template><template v-if="o.withYou"> · {{ o.withYou }} already arranged with you</template></span></span>
              <button class="btn btn-secondary !py-1" :disabled="timesLoading" @click="showTimes(o, 'scrimmage')">Find times</button>
            </li>
          </ul>
        </template>
      </section>

      <!-- Suggested times -->
      <section v-if="times" class="card card-blocky p-4">
        <div class="flex flex-wrap items-center gap-3 mb-2">
          <h2 class="font-semibold mr-auto">Times for {{ myTeam?.name }} and {{ times.opponent.name }}</h2>
          <div class="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="tablist" aria-label="Kind">
            <button v-for="[k, l] in [['scrimmage', 'Scrimmage'], ['joint_practice', 'Joint practice']]" :key="k" role="tab" class="px-3 py-1.5" :aria-selected="times.kind === k"
              :class="times.kind === k ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="showTimes(times.opponent, k)">{{ l }}</button>
          </div>
          <button class="btn btn-ghost" @click="times = null">Close</button>
        </div>
        <p class="text-sm text-text-muted mb-3">Open preseason {{ times.kind === 'joint_practice' ? 'gym time (game or practice)' : 'game time' }} at either program, on days neither team has another preseason event or a blackout. Add more gym time under Gym slots to see more.</p>
        <p v-if="!times.list.length" class="text-sm">No open times yet. Either program can add preseason gym time under <RouterLink to="/slots" class="underline">Gym slots</RouterLink> (dates before {{ longDate(info.season.startDate) }}).</p>
        <div v-else class="space-y-3">
          <div v-for="[day, list] in timesByDay" :key="day">
            <p class="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">{{ weekday(day, 'long') }}, {{ monthDay(day) }}</p>
            <ul class="divide-y divide-border rounded-lg border border-border">
              <li v-for="t in list" :key="`${t.slotId}-${t.startTime}`" class="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span class="w-36 font-medium">{{ timeRange(t.startTime, t.endTime) }}</span>
                <span class="flex-1 min-w-[12rem]">{{ t.venueName }} – {{ t.courtName }} <span class="text-text-muted">· {{ t.host === 'you' ? 'your gym' : 'their gym' }}<template v-if="t.visitorMiles != null">, {{ t.host === 'you' ? 'they travel' : 'you travel' }} {{ t.visitorMiles }} mi</template></span></span>
                <button class="btn btn-primary !py-1" @click="asking = { time: t, refereesWanted: false, note: '' }; askError = ''">Ask</button>
              </li>
            </ul>
          </div>
          <p v-if="times.more" class="text-xs text-text-muted">And {{ times.more }} more later in the preseason.</p>
        </div>
      </section>

      <!-- Sent -->
      <section v-if="sent.length" class="space-y-2">
        <h2 class="font-semibold">{{ isAdmin && !ctx.programId ? 'Waiting for an answer' : 'Sent, waiting for an answer' }}</h2>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="e in sent" :key="e.id" class="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span class="flex-1 min-w-[14rem]"><span class="font-medium">{{ e.kindLabel }}: {{ e.hostTeamName }} vs {{ e.visitorTeamName }}</span>
              <span class="block text-xs text-text-muted">{{ longDate(e.date) }}, {{ timeRange(e.startTime, e.endTime) }} · {{ e.venueName }} – {{ e.courtName }} · asked by {{ e.requestedByName }}</span></span>
            <button v-if="e.actions.includes('withdraw')" class="btn btn-ghost" :disabled="acting === e.id" @click="withdraw(e)">Withdraw</button>
          </li>
        </ul>
      </section>

      <!-- Arranged -->
      <section class="space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="font-semibold mr-auto">Arranged</h2>
          <label v-if="!isDirector" class="flex items-center gap-2 text-sm"><input v-model="refsOnly" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Only those wanting referees</label>
        </div>
        <p v-if="!arrangedShown.length" class="text-sm text-text-muted">Nothing arranged yet.</p>
        <ul v-else class="card card-blocky divide-y divide-border">
          <li v-for="e in arrangedShown" :key="e.id" class="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span class="w-40 font-medium">{{ weekday(e.date) }} {{ monthDay(e.date) }}<span class="block text-xs font-normal text-text-muted">{{ timeRange(e.startTime, e.endTime) }}</span></span>
            <span class="flex-1 min-w-[14rem]">
              <span class="badge badge-outline mr-1">Preseason · {{ e.kindLabel }}</span>
              <span class="font-medium">{{ e.hostTeamName }}</span> vs <span class="font-medium">{{ e.visitorTeamName }}</span>
              <span class="block text-xs text-text-muted">{{ e.venueName }} – {{ e.courtName }}<template v-if="e.venueAddress"> · {{ e.venueAddress }}</template> · {{ e.hostProgramName }} hosts{{ e.refereesWanted ? ' · referees wanted' : '' }}</span>
            </span>
            <button v-if="e.actions.includes('cancel')" class="btn btn-ghost" @click="cancelling = { e, reason: '' }">Cancel…</button>
          </li>
        </ul>
      </section>

      <details v-if="history.length" class="card card-blocky px-4 py-3 text-sm">
        <summary class="cursor-pointer font-medium">Declined, withdrawn, and cancelled ({{ history.length }})</summary>
        <ul class="mt-2 space-y-1.5">
          <li v-for="e in history" :key="e.id">
            <span class="badge badge-outline mr-1">{{ e.statusLabel }}</span>{{ e.kindLabel }}: {{ e.hostTeamName }} vs {{ e.visitorTeamName }}, {{ monthDay(e.date) }} {{ timeRange(e.startTime, e.endTime) }}
            <span v-if="e.decisionNote" class="text-text-muted italic"> “{{ e.decisionNote }}”</span>
          </li>
        </ul>
      </details>
    </div>

    <!-- Ask -->
    <Modal v-if="asking" :title="`Ask ${times.opponent.programName}`" @close="asking = null">
      <div class="space-y-3 text-sm">
        <p class="font-medium">{{ times.kind === 'scrimmage' ? 'Scrimmage' : 'Joint practice' }}: {{ myTeam?.name }} and {{ times.opponent.name }}</p>
        <p>{{ longDate(asking.time.date) }}, {{ timeRange(asking.time.startTime, asking.time.endTime) }}<br />{{ asking.time.venueName }} – {{ asking.time.courtName }} ({{ asking.time.host === 'you' ? 'your gym' : 'their gym' }})</p>
        <label class="flex items-start gap-2"><input v-model="asking.refereesWanted" type="checkbox" class="w-4 h-4 mt-0.5 accent-[var(--color-accent)]" />
          <span>We’d like referees<span class="block text-xs text-text-muted">If they accept, the referee assignor is told. Referees for preseason games are arranged directly with the assignor; they aren’t on the league’s assignment board or payouts.</span></span></label>
        <div><label class="label" for="ps-note">Note <span class="font-normal text-text-muted">(optional)</span></label>
          <input id="ps-note" v-model="asking.note" class="input" maxlength="400" placeholder="e.g. Happy to run it as two halves with a coaches’ chat after" /></div>
        <p class="text-xs text-text-muted">{{ times.opponent.programName }}’s director is emailed and accepts or declines. Until then the time is held for you.</p>
        <p v-if="askError" class="text-danger" role="alert">{{ askError }}</p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="asking = null">Cancel</button>
        <button class="btn btn-primary" :disabled="saving" @click="sendRequest">{{ saving ? 'Sending…' : 'Send request' }}</button>
      </template>
    </Modal>

    <!-- Accept / decline -->
    <Modal v-if="answering" :title="answering.decision === 'accept' ? 'Accept this request?' : 'Decline this request?'" @close="answering = null">
      <p class="text-sm mb-3">{{ answering.e.kindLabel }}: {{ ourTeamOf(answering.e) }} vs {{ opponentOf(answering.e) }}, {{ longDate(answering.e.date) }}, {{ timeRange(answering.e.startTime, answering.e.endTime) }}, {{ answering.e.venueName }}.</p>
      <label class="label" for="ps-answer">Note for them <span v-if="answering.decision === 'accept'" class="font-normal text-text-muted">(optional)</span></label>
      <input id="ps-answer" v-model="answering.note" class="input" maxlength="400" :placeholder="answering.decision === 'accept' ? 'e.g. See you there' : 'e.g. We have practice then; could you do Saturday morning?'" />
      <template #footer>
        <button class="btn btn-secondary" @click="answering = null">Back</button>
        <button class="btn" :class="answering.decision === 'accept' ? 'btn-primary' : 'btn-danger'" :disabled="saving || (answering.decision === 'decline' && answering.note.trim().length < 3)" @click="respond">
          {{ answering.decision === 'accept' ? 'Accept' : 'Decline' }}</button>
      </template>
    </Modal>

    <!-- Cancel -->
    <Modal v-if="cancelling" title="Cancel this?" @close="cancelling = null">
      <p class="text-sm mb-3">{{ cancelling.e.kindLabel }}: {{ cancelling.e.hostTeamName }} vs {{ cancelling.e.visitorTeamName }}, {{ longDate(cancelling.e.date) }}. The other program is emailed{{ cancelling.e.refereesWanted ? ', and so is the referee assignor' : '' }}.</p>
      <label class="label" for="ps-cancel">Reason</label>
      <input id="ps-cancel" v-model="cancelling.reason" class="input" maxlength="400" placeholder="e.g. Gym closed for repairs" />
      <template #footer>
        <button class="btn btn-secondary" @click="cancelling = null">Keep it</button>
        <button class="btn btn-danger" :disabled="saving || cancelling.reason.trim().length < 3" @click="cancelEvent">Cancel it</button>
      </template>
    </Modal>
  </div>
</template>
