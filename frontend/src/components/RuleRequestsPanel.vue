<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import { useRequestBadge } from '../stores/requestBadge';
import { timestamp } from '../utils/format';
import EmptyState from './EmptyState.vue';
import Modal from './Modal.vue';
import ProgramPicker from './ProgramPicker.vue';

// Rule requests: a Program Director tells the league what their program
// needs from the Matchmaker rules; the System Admin answers here, and can
// apply a travel cap or rematch limit to the rules in one click.
const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();
const badge = useRequestBadge();
const isAdmin = computed(() => auth.isSuperAdmin);

const state = ref('open'); // open | effect | closed
const requests = ref([]);
const league = ref({ maxTravelMiles: 30, maxVsSameOpponent: 2 });
const loading = ref(true);
const divisions = ref([]);

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/rule-requests', { params: { state: state.value, ...ctx.query } });
    requests.value = data.requests;
    league.value = data.league;
  } catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(async () => {
  load();
  try { divisions.value = (await api.get('/league/divisions')).data.divisions.filter((d) => d.isActive); } catch { /* the form says so */ }
});
watch([state, () => ctx.programId], load);
const refresh = async () => { await load(); badge.refresh(); };

const waiting = (r) => r.actions.includes(isAdmin.value ? 'accept' : 'reply') && (isAdmin.value ? r.status === 'open' : r.status === 'question');
const sorted = computed(() => [...requests.value].sort((a, b) => Number(waiting(b) || b.needsConfirm) - Number(waiting(a) || a.needsConfirm)));
const STATUS_STYLE = { open: 'bg-pending text-black', question: 'bg-pending text-black', accepted: 'bg-success text-black', noted: 'bg-success text-black', declined: 'badge-outline', withdrawn: 'badge-outline' };
const limitText = (v) => (v == null || v === 'none' ? 'no limit' : `${v} game${Number(v) === 1 ? '' : 's'}`);
// "In the rules now: …" for a travel cap or rematch limit.
function currentText(r) {
  if (!r.current) return '';
  if (r.kind === 'travel_cap') return r.current.own ? `In the rules now: ${r.current.value} miles for ${r.programName} (league cap ${r.current.league}).` : `In the rules now: the league cap, ${r.current.league} miles.`;
  return r.current.own ? `In the rules now: ${limitText(r.current.value)} for ${r.divisionName} (league: ${limitText(r.current.league)}).` : `In the rules now: the league value, ${limitText(r.current.league)}.`;
}

// ---- new request ----
const creating = ref(null);
const formError = ref('');
const saving = ref(false);
function openNew() {
  formError.value = '';
  creating.value = { programId: ctx.programId || '', kind: 'travel_cap', miles: '', divisionId: '', rematch: '3', title: '', details: '' };
}
async function create() {
  const f = creating.value;
  formError.value = '';
  saving.value = true;
  try {
    const requestedValue = f.kind === 'travel_cap' ? Number(f.miles) : f.kind === 'rematch_limit' ? f.rematch : f.title;
    await api.post('/rule-requests', { programId: f.programId || undefined, kind: f.kind, divisionId: f.kind === 'rematch_limit' ? f.divisionId : undefined, requestedValue, details: f.details });
    toast.success(isAdmin.value ? 'Request recorded.' : 'Request sent to the league.');
    creating.value = null;
    state.value === 'open' ? await refresh() : (state.value = 'open');
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

// ---- reply / ask ----
const replying = ref(null); // { r, body }
async function sendMessage() {
  const { r, body } = replying.value;
  formError.value = '';
  saving.value = true;
  try {
    await api.post(`/rule-requests/${r.id}/messages`, { body });
    toast.success(isAdmin.value ? 'Question sent to the program.' : 'Reply sent to the league.');
    replying.value = null;
    await refresh();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

// ---- decide (admin) ----
const deciding = ref(null); // { r, decision, note, apply, value }
function openDecide(r, decision) {
  formError.value = '';
  deciding.value = { r, decision, note: '', apply: decision === 'accept' && r.canApply, value: r.requestedValue };
}
const decideTitle = computed(() => {
  const d = deciding.value;
  if (!d) return '';
  if (d.decision === 'accept') return 'Accept this request?';
  if (d.decision === 'note') return 'Mark as noted?';
  return d.r.status === 'accepted' || d.r.status === 'noted' ? 'End this request?' : 'Decline this request?';
});
async function decide() {
  const d = deciding.value;
  formError.value = '';
  saving.value = true;
  try {
    const { data } = await api.post(`/rule-requests/${d.r.id}/decide`, { decision: d.decision, note: d.note, apply: d.apply, value: d.apply ? d.value : undefined });
    toast.success(d.decision === 'accept' ? (data.applied ? 'Accepted, and the Matchmaker rules are updated.' : 'Accepted.') : d.decision === 'note' ? 'Marked as noted.' : 'Done. The program has been told.');
    deciding.value = null;
    await refresh();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

const busyId = ref('');
async function confirmStill(r) {
  busyId.value = r.id;
  try { await api.post(`/rule-requests/${r.id}/confirm`); toast.success('Confirmed for this season.'); await refresh(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { busyId.value = ''; }
}
const withdrawing = ref(null);
async function withdraw() {
  saving.value = true;
  try {
    const { data } = await api.post(`/rule-requests/${withdrawing.value.id}/withdraw`);
    toast.success(data.overrideStillSet ? 'Request withdrawn. The league has been asked to remove the setting from the rules.' : 'Request withdrawn.');
    withdrawing.value = null;
    await refresh();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <div class="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="tablist" aria-label="Which rule requests">
        <button v-for="[k, label] in [['open', 'Open'], ['effect', 'In effect'], ['closed', 'Closed']]" :key="k" role="tab" class="px-3 py-1.5" :aria-selected="state === k"
          :class="state === k ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="state = k">{{ label }}</button>
      </div>
      <button class="btn btn-primary ml-auto" @click="openNew">{{ isAdmin ? 'Record a request' : 'New rule request' }}</button>
    </div>

    <div v-if="!isAdmin" class="card card-blocky border-l-4 border-l-accent px-4 py-3 mb-4 text-sm">
      <p class="font-medium">You can set these yourself, without asking the league:</p>
      <ul class="list-disc pl-5 mt-1 space-y-0.5">
        <li>Dates your program can’t play: <RouterLink to="/blackouts" class="underline">Blackout dates</RouterLink>.</li>
        <li>When and where your gyms are free: <RouterLink to="/slots" class="underline">Gym slots</RouterLink>.</li>
        <li>Which divisions play on which days: <strong>Keep for</strong> on your <RouterLink to="/slots" class="underline">gym slots</RouterLink>.</li>
      </ul>
      <p class="mt-1 text-text-muted">Use a rule request for what only the league can set: your program’s travel cap, a division’s rematch limit, a league rule, or anything else the schedule should take into account.</p>
    </div>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!sorted.length"
      :title="{ open: 'No open rule requests', effect: 'No rule requests in effect', closed: 'No closed rule requests' }[state]"
      :body="isAdmin ? 'Program Directors send these when their program needs something from the Matchmaker rules. You can also record one that reached you another way.' : state === 'open' ? 'Tell the league what your program needs from the schedule rules, and see the answer here.' : state === 'effect' ? 'Requests the league accepted or noted stay here until you withdraw them.' : 'Declined and withdrawn requests are kept here.'" />

    <div v-else class="space-y-4">
      <article v-for="r in sorted" :key="r.id" class="card p-5" :class="(waiting(r) || (isAdmin && r.needsConfirm)) && 'ring-2 ring-accent'">
        <header class="flex flex-wrap items-center gap-2 mb-2">
          <span class="badge badge-outline">{{ r.kindLabel.replace(' for my program', '').replace(' for a division', '') }}</span>
          <span class="badge" :class="STATUS_STYLE[r.status]">{{ r.statusLabel }}</span>
          <span v-if="waiting(r)" class="text-xs font-semibold">{{ isAdmin ? 'Needs your answer' : 'Needs your reply' }}</span>
          <span v-else-if="isAdmin && r.needsConfirm" class="text-xs font-semibold">Confirm for this season</span>
          <span class="text-xs text-text-muted ml-auto">{{ r.programName }}</span>
        </header>

        <h3 class="font-semibold">{{ r.summary }}</h3>
        <p v-if="r.current" class="text-xs text-text-muted mt-0.5">{{ currentText(r) }}</p>
        <blockquote class="text-sm mt-3 border-l-2 border-border pl-3">{{ r.details }}</blockquote>
        <p class="text-xs text-text-muted mt-1">Asked by {{ r.requestedByName || 'someone' }} · {{ timestamp(r.createdAt) }}</p>

        <ol v-if="r.messages.length" class="mt-3 space-y-2">
          <li v-for="m in r.messages" :key="m.id" class="text-sm rounded-lg border border-border px-3 py-2" :class="m.fromLeague ? 'bg-background' : ''">
            <p class="text-xs text-text-muted">{{ m.fromLeague ? 'League' : r.programName }} · {{ m.authorName }} · {{ timestamp(m.createdAt) }}</p>
            <p class="mt-0.5">{{ m.body }}</p>
          </li>
        </ol>

        <div v-if="r.decidedAt" class="mt-3 text-sm rounded-lg bg-background border border-border px-3 py-2">
          <p><span class="font-medium">{{ r.statusLabel }}</span> by {{ r.decidedByName || 'the league' }} · {{ timestamp(r.decidedAt) }}</p>
          <p v-if="r.appliedValue" class="mt-0.5">Applied to the Matchmaker rules: {{ r.kind === 'travel_cap' ? `${r.appliedValue} miles` : limitText(r.appliedValue) }}.</p>
          <p v-else-if="r.status === 'accepted' && r.canApply" class="mt-0.5 text-text-muted">Not applied from here; set it in the Schedule builder’s rules.</p>
          <p v-if="r.decisionNote" class="mt-0.5 italic">“{{ r.decisionNote }}”</p>
          <p v-if="['accepted', 'noted'].includes(r.status)" class="mt-0.5 text-xs text-text-muted">{{ r.needsConfirm ? 'Not yet confirmed for this season.' : `Confirmed for ${r.confirmedSeasonName || 'this season'}.` }} It stays in effect until the program withdraws it or the league ends it.</p>
        </div>

        <footer v-if="r.actions.length" class="flex flex-wrap justify-end gap-2 mt-4 pt-3 border-t border-border">
          <button v-if="r.actions.includes('withdraw')" class="btn btn-ghost" @click="withdrawing = r">Withdraw</button>
          <button v-if="r.actions.includes('reply')" class="btn" :class="r.status === 'question' ? 'btn-primary' : 'btn-secondary'" @click="replying = { r, body: '' }; formError = ''">{{ r.status === 'question' ? 'Reply' : 'Add a comment' }}</button>
          <button v-if="r.actions.includes('end')" class="btn btn-ghost" @click="openDecide(r, 'decline')">End…</button>
          <button v-if="r.actions.includes('confirm')" class="btn btn-primary" :disabled="busyId === r.id" @click="confirmStill(r)">Still applies this season</button>
          <button v-if="r.actions.includes('ask')" class="btn btn-ghost" @click="replying = { r, body: '' }; formError = ''">Ask a question</button>
          <button v-if="r.actions.includes('decline')" class="btn btn-secondary" @click="openDecide(r, 'decline')">Decline</button>
          <button v-if="r.actions.includes('note')" class="btn btn-secondary" @click="openDecide(r, 'note')">Noted</button>
          <button v-if="r.actions.includes('accept')" class="btn btn-primary" @click="openDecide(r, 'accept')">Accept…</button>
        </footer>
      </article>
    </div>

    <!-- New request -->
    <Modal v-if="creating" :title="isAdmin ? 'Record a rule request' : 'New rule request'" wide @close="creating = null">
      <form id="rr-form" class="grid gap-4" @submit.prevent="create">
        <p v-if="isAdmin" class="text-sm text-text-muted">Use this for a request that reached you by phone, text or email, so it’s on record with the others.</p>
        <ProgramPicker v-model="creating.programId" />
        <fieldset>
          <legend class="label">What is it about?</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            <label v-for="[k, label, help] in [['travel_cap', 'A lower travel cap', 'How far this program’s teams travel to away games.'], ['rematch_limit', 'A division’s rematch limit', 'How many times two teams in a division can meet.'], ['league_rule', 'A league rule', 'Games per team, game length, buffer, days between games…'], ['other', 'Something else', 'Anything else the schedule should take into account.']]" :key="k"
              class="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer" :class="creating.kind === k ? 'border-accent ring-1 ring-accent' : 'border-border'">
              <input v-model="creating.kind" type="radio" :value="k" class="mt-1 accent-[var(--color-accent)]" />
              <span><span class="font-medium">{{ label }}</span><span class="block text-xs text-text-muted">{{ help }}</span></span>
            </label>
          </div>
        </fieldset>

        <div v-if="creating.kind === 'travel_cap'">
          <label class="label" for="rr-miles">Travel cap you’d like (miles)</label>
          <input id="rr-miles" v-model.number="creating.miles" type="number" min="1" :max="league.maxTravelMiles - 1" class="input sm:!w-40" required />
          <p class="text-xs text-text-muted mt-1">The league cap is {{ league.maxTravelMiles }} miles; a program’s own cap has to be lower. Opponents further away than your cap would come to your gyms instead, so you’d need enough game slots.</p>
        </div>
        <div v-else-if="creating.kind === 'rematch_limit'" class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="rr-div">Division</label>
            <select id="rr-div" v-model="creating.divisionId" class="input" required>
              <option value="" disabled>Choose a division</option>
              <option v-for="d in divisions" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
          <div>
            <label class="label" for="rr-rematch">Most games against the same opponent</label>
            <select id="rr-rematch" v-model="creating.rematch" class="input">
              <option v-for="n in 6" :key="n" :value="String(n)">{{ n }}</option>
              <option value="none">No limit</option>
            </select>
            <p class="text-xs text-text-muted mt-1">The league value is {{ limitText(league.maxVsSameOpponent) }}.</p>
          </div>
        </div>
        <div v-else>
          <label class="label" for="rr-title">{{ creating.kind === 'league_rule' ? 'Which rule, and what change?' : 'In a few words' }}<span v-if="creating.kind === 'league_rule'" class="font-normal text-text-muted"> (optional)</span></label>
          <input id="rr-title" v-model="creating.title" class="input" maxlength="100" :required="creating.kind === 'other'"
            :placeholder="creating.kind === 'league_rule' ? 'e.g. A 10-minute buffer between games' : 'e.g. No games before 10 AM on Saturdays'" />
          <p v-if="creating.kind === 'other'" class="text-xs text-text-muted mt-1">If the matchmaker can’t do this by itself, the league keeps it on record and checks it when reviewing the schedule.</p>
        </div>

        <div>
          <label class="label" for="rr-details">Why?</label>
          <textarea id="rr-details" v-model="creating.details" rows="3" class="input" maxlength="1000" required placeholder="A sentence or two, so the league can decide." />
        </div>
        <p v-if="formError" class="text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="creating = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="rr-form" :disabled="saving || (isAdmin && !creating.programId)">{{ saving ? 'Sending…' : isAdmin ? 'Record request' : 'Send to the league' }}</button>
      </template>
    </Modal>

    <!-- Ask / reply -->
    <Modal v-if="replying" :title="isAdmin ? 'Ask the program a question' : 'Reply to the league'" @close="replying = null">
      <p class="text-sm mb-3 font-medium">{{ replying.r.summary }}</p>
      <label class="label" for="rr-msg">{{ isAdmin ? 'Your question' : 'Your message' }}</label>
      <textarea id="rr-msg" v-model="replying.body" rows="3" class="input" maxlength="1000" :placeholder="isAdmin ? 'e.g. Would 20 miles work? 15 leaves only two opponents.' : ''" />
      <p v-if="isAdmin" class="text-xs text-text-muted mt-1">The request waits for their reply, and they’re emailed.</p>
      <p v-if="formError" class="text-sm text-danger mt-2" role="alert">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-secondary" @click="replying = null">Cancel</button>
        <button class="btn btn-primary" :disabled="saving || replying.body.trim().length < 2" @click="sendMessage">{{ saving ? 'Sending…' : 'Send' }}</button>
      </template>
    </Modal>

    <!-- Decide -->
    <Modal v-if="deciding" :title="decideTitle" @close="deciding = null">
      <p class="text-sm font-medium">{{ deciding.r.summary }}</p>
      <p class="text-xs text-text-muted mb-3">{{ deciding.r.programName }}<template v-if="deciding.r.current"> · {{ currentText(deciding.r) }}</template></p>

      <div v-if="deciding.decision === 'accept' && deciding.r.canApply" class="rounded-lg border border-border p-3 mb-3">
        <label class="flex items-center gap-2 text-sm font-medium">
          <input v-model="deciding.apply" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" />
          Apply to the Matchmaker rules now
        </label>
        <div v-if="deciding.apply" class="mt-2">
          <template v-if="deciding.r.kind === 'travel_cap'">
            <label class="label" for="rr-apply">Travel cap for {{ deciding.r.programName }} (miles)</label>
            <input id="rr-apply" v-model.number="deciding.value" type="number" min="1" :max="league.maxTravelMiles - 1" class="input !w-32" />
          </template>
          <template v-else>
            <label class="label" for="rr-apply">{{ deciding.r.divisionName }}: most games against the same opponent</label>
            <select id="rr-apply" v-model="deciding.value" class="input !w-40">
              <option v-for="n in 6" :key="n" :value="String(n)">{{ n }}</option>
              <option value="none">No limit</option>
            </select>
          </template>
          <p class="text-xs text-text-muted mt-1">They asked for {{ deciding.r.kind === 'travel_cap' ? `${deciding.r.requestedValue} miles` : limitText(deciding.r.requestedValue) }}. You can adjust it. It applies to the next draft you generate.</p>
        </div>
        <p v-else class="text-xs text-text-muted mt-1">You’ll set it yourself under Schedule builder → Matchmaker rules.</p>
      </div>
      <p v-else-if="deciding.decision === 'accept'" class="text-sm mb-3">Accepting records that the league agrees. Change the rule yourself in the Schedule builder if one needs changing.</p>
      <p v-else-if="deciding.decision === 'note'" class="text-sm mb-3">Use this when the matchmaker can’t do it by itself. It stays on record under <strong>In effect</strong>, to check when you review a draft.</p>

      <label class="label" for="rr-note">Note for the program <span v-if="deciding.decision !== 'decline'" class="font-normal text-text-muted">(optional)</span></label>
      <textarea id="rr-note" v-model="deciding.note" rows="3" class="input" maxlength="600" />
      <p v-if="formError" class="text-sm text-danger mt-2" role="alert">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-secondary" @click="deciding = null">Back</button>
        <button class="btn" :class="deciding.decision === 'decline' ? 'btn-danger' : 'btn-primary'" :disabled="saving || (deciding.decision === 'decline' && deciding.note.trim().length < 3)" @click="decide">
          {{ saving ? 'Saving…' : deciding.decision === 'accept' ? (deciding.apply ? 'Accept and apply' : 'Accept') : deciding.decision === 'note' ? 'Mark as noted' : ['accepted', 'noted'].includes(deciding.r.status) ? 'End request' : 'Decline request' }}
        </button>
      </template>
    </Modal>

    <!-- Withdraw -->
    <Modal v-if="withdrawing" title="Withdraw this request?" @close="withdrawing = null">
      <p class="text-sm font-medium">{{ withdrawing.summary }}</p>
      <p class="text-sm mt-2">{{ withdrawing.appliedValue ? 'The league is told you no longer need it and asked to remove the setting from the rules. Until they do, it stays in the rules.' : 'The league is told you no longer need it.' }}</p>
      <template #footer>
        <button class="btn btn-secondary" @click="withdrawing = null">Back</button>
        <button class="btn btn-danger" :disabled="saving" @click="withdraw">Withdraw request</button>
      </template>
    </Modal>
  </div>
</template>
