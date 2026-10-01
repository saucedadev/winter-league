<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../stores/toast';
import { longDate, timestamp } from '../utils/format';
import { downloadSchedule, slug } from '../utils/scheduleCsv';
import { useBrandingStore } from '../stores/branding';
import { todayISO } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';
import GameRow from '../components/GameRow.vue';

// A Program Director reviews the shared draft: their own program's games
// only, read-only. They sign off, or flag a game that doesn't work.
const auth = useAuthStore();
const toast = useToast();
const data = ref(null);
const loading = ref(true);
async function load() {
  loading.value = true;
  try { data.value = (await api.get('/schedule/draft-review')).data; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);

// Download the program's draft games as a CSV file.
const branding = useBrandingStore();
function downloadCsv() {
  downloadSchedule(`${slug(branding.appName)}-draft-schedule-${slug(auth.user.programName || 'my-program')}-${todayISO()}.csv`, data.value.games, { withTravel: true });
}
const byDate = computed(() => {
  const m = new Map();
  for (const g of data.value?.games || []) { const k = g.date || 'unplaced'; if (!m.has(k)) m.set(k, []); m.get(k).push(g); }
  return [...m.entries()];
});
const myTeamIds = computed(() => [...new Set((data.value?.games || []).flatMap((g) => [
  g.homeProgramId === auth.user.programId ? g.homeTeamId : null, g.awayProgramId === auth.user.programId ? g.awayTeamId : null]).filter(Boolean))]);
const openFlagFor = (g) => (data.value?.flags || []).find((f) => f.gameId === g.id && f.status === 'open');
const STATUS_STYLE = { signed_off: 'bg-success text-black', flagged: 'bg-unavailable text-white', waiting: 'bg-pending text-black' };

// ---- sign off ----
const signing = ref(false);
const signNote = ref('');
const busy = ref(false);
async function signOff() {
  busy.value = true;
  try {
    const { data: d } = await api.post('/schedule/draft-review/sign-off', { note: signNote.value.trim() });
    toast.success(d.remaining ? 'Signed off. Thanks! The league will publish once every program has signed off.' : 'Signed off. Every program has now signed off.');
    signing.value = false;
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}

// ---- flag a game ----
const flagging = ref(null);
const flagNote = ref('');
const flagError = ref('');
async function flag() {
  busy.value = true;
  flagError.value = '';
  try {
    await api.post('/schedule/draft-review/flags', { gameId: flagging.value.id, note: flagNote.value.trim() });
    toast.success('Game flagged. The league has been told.');
    flagging.value = null;
    await load();
  } catch (err) { flagError.value = errorMessage(err); }
  finally { busy.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Draft review" subtitle="Check your program’s games in the draft schedule before the league publishes it." />
    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!data?.shared" title="Nothing to review right now"
      body="When the league shares a draft schedule, your program’s games appear here for you to sign off. You’ll get an email." />

    <template v-else>
      <section class="card p-5 mb-5" :class="data.review.status === 'waiting' && 'ring-2 ring-accent'">
        <div class="flex flex-wrap items-start gap-3">
          <div class="flex-1 min-w-[16rem]">
            <p class="flex items-center gap-2 mb-1"><span class="badge" :class="STATUS_STYLE[data.review.status]">{{ data.review.statusLabel }}</span>
              <span v-if="data.run.deadline" class="text-sm" :class="data.run.deadlinePassed ? 'text-danger font-medium' : 'text-text-muted'">Please respond by {{ longDate(data.run.deadline) }}{{ data.run.deadlinePassed ? ' (passed)' : '' }}</span></p>
            <p v-if="data.review.status === 'waiting' && data.review.resetReason" class="text-sm"><strong>A game changed since your review:</strong> {{ data.review.resetReason }} Please check your games again.</p>
            <p v-else-if="data.review.status === 'waiting'" class="text-sm">Look through your games below. If they all work, sign off. If one doesn’t, flag it with a note and the league will look at it.</p>
            <p v-else-if="data.review.status === 'signed_off'" class="text-sm">Signed off {{ data.review.onBehalf ? 'by the league on your program’s behalf' : `by ${data.review.decidedByName}` }} · {{ timestamp(data.review.decidedAt) }}. If the league changes one of your games, you’ll be asked to review again.</p>
            <p v-else class="text-sm">You flagged a game. The league will fix it or reply. When your games work, sign off.</p>
            <p class="text-xs text-text-muted mt-1">This is a draft: only you and the league can see it. Coaches and referees see the schedule once it’s published.</p>
          </div>
          <button v-if="data.review.status !== 'signed_off'" class="btn btn-primary shrink-0" @click="signing = true; signNote = ''">Sign off</button>
        </div>
      </section>

      <section v-if="data.flags.length" class="card card-blocky p-4 mb-5">
        <h2 class="font-semibold text-sm mb-2">Your flags</h2>
        <ul class="space-y-2 text-sm">
          <li v-for="f in data.flags" :key="f.id">
            <span class="badge badge-outline mr-1">{{ f.status === 'open' ? 'Open' : 'Resolved' }}</span>
            <span class="font-medium">{{ f.gameLabel }}</span>: “{{ f.note }}”
            <span v-if="f.status === 'resolved'" class="block text-xs text-text-muted ml-1">Resolved{{ f.resolvedByName ? ` by ${f.resolvedByName}` : '' }}{{ f.resolutionNote ? `: ${f.resolutionNote}` : '' }}</span>
          </li>
        </ul>
      </section>

      <div class="flex flex-wrap items-center gap-2 mb-2">
        <p class="text-xs text-text-muted">{{ data.games.length }} game{{ data.games.length === 1 ? '' : 's' }} involving your program</p>
        <button class="btn btn-secondary ml-auto" :disabled="!data.games.length" title="Download your program’s draft games as a spreadsheet file" @click="downloadCsv">Download CSV</button>
      </div>
      <section v-for="[date, list] in byDate" :key="date" class="mb-4">
        <h2 class="text-sm font-semibold mb-1.5">{{ date === 'unplaced' ? 'Not placed yet' : longDate(date) }}</h2>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="g in list" :key="g.id" class="px-4 py-2.5">
            <GameRow :game="g" :highlight-team-ids="myTeamIds" show-travel>
              <template #actions>
                <span v-if="openFlagFor(g)" class="badge bg-unavailable text-white" :title="openFlagFor(g).note">Flagged</span>
                <button v-else class="btn btn-ghost text-xs" @click="flagging = g; flagNote = ''; flagError = ''">Flag</button>
              </template>
            </GameRow>
          </li>
        </ul>
      </section>
    </template>

    <Modal v-if="signing" title="Sign off your program’s games?" @close="signing = false">
      <p class="text-sm mb-3">You’re confirming your program’s {{ data.games.length }} games work as they are in the draft.{{ data.flags.some((f) => f.status === 'open') ? ' Your open flags will be withdrawn.' : '' }}</p>
      <label class="label" for="sign-note">Note for the league (optional)</label>
      <textarea id="sign-note" v-model="signNote" rows="2" class="input" maxlength="300" />
      <template #footer>
        <button class="btn btn-secondary" @click="signing = false">Cancel</button>
        <button class="btn btn-primary" :disabled="busy" @click="signOff">Sign off</button>
      </template>
    </Modal>
    <Modal v-if="flagging" title="Flag this game" @close="flagging = null">
      <div class="rounded-lg border border-border p-3 mb-3">
        <p class="text-xs text-text-muted mb-1">{{ flagging.date ? longDate(flagging.date) : 'Not placed yet' }}</p>
        <GameRow :game="flagging" compact />
      </div>
      <label class="label" for="flag-note">What’s wrong with it?</label>
      <textarea id="flag-note" v-model="flagNote" rows="2" class="input" maxlength="400" placeholder="e.g. 11/5 clashes with our school event." />
      <p v-if="flagError" class="text-sm text-danger mt-2" role="alert">{{ flagError }}</p>
      <template #footer>
        <button class="btn btn-secondary" @click="flagging = null">Cancel</button>
        <button class="btn btn-primary" :disabled="flagNote.trim().length < 5 || busy" @click="flag">Flag game</button>
      </template>
    </Modal>
  </div>
</template>
