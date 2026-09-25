<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../stores/toast';
import { useRequestBadge } from '../stores/requestBadge';
import { longDate, timeRange, timestamp } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';
import GameRow from '../components/GameRow.vue';

const auth = useAuthStore();
const toast = useToast();
const badge = useRequestBadge();
const state = ref('open');
const requests = ref([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try { requests.value = (await api.get('/requests', { params: { state: state.value } })).data.requests; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);
function switchTo(s) { if (state.value !== s) { state.value = s; load(); } }

const needsMe = (r) => r.actions.includes('approve');
// After a change is applied, show where the game(s) WERE, from the snapshot
// taken when the request was filed; while open, show them as they are now.
const applied = (r) => r.status === 'approved' && r.before;
const firstGame = (r) => (applied(r) ? { ...r.game, ...r.before.game, status: 'scheduled', hasOpenRequest: false } : r.game);
const secondGame = (r) => (applied(r) && r.before.swapGame ? { ...r.swapGame, ...r.before.swapGame, status: 'scheduled', hasOpenRequest: false } : r.swapGame);
const sorted = computed(() => [...requests.value].sort((a, b) => Number(needsMe(b)) - Number(needsMe(a))));
const waitingCount = computed(() => requests.value.filter(needsMe).length);

const approveLabel = (r) => ({ pending_director: 'Endorse', pending_counterpart: 'Agree', pending_admin: 'Approve & apply' }[r.status] || 'Approve');
const STATUS_STYLE = {
  pending_director: 'bg-pending text-black', pending_counterpart: 'bg-pending text-black', pending_admin: 'bg-pending text-black',
  approved: 'bg-success text-black', denied: 'badge-outline', cancelled: 'badge-outline',
};

// Steps shown as a simple timeline: director (coach requests), each other program, then the league.
function timeline(r) {
  const out = [{ label: `Requested by ${r.requestedByName}`, sub: `${r.requestingProgramName} · ${timestamp(r.createdAt)}`, state: 'done' }];
  for (const s of r.steps) {
    const notYet = s.decision === 'pending' && s.stage === 'counterpart' && r.status === 'pending_director';
    out.push({
      label: s.stage === 'director' ? `${s.programName} director` : `${s.programName} (other program)`,
      sub: notYet ? 'Next, after the director endorses' : s.decision === 'pending' ? (['denied', 'cancelled'].includes(r.status) ? 'No decision needed' : 'Waiting') : `${s.decision === 'approved' ? (s.stage === 'director' ? 'Endorsed' : 'Agreed') : 'Denied'} by ${s.decidedByName} · ${timestamp(s.decidedAt)}`,
      note: s.note,
      state: s.decision === 'approved' ? 'done' : s.decision === 'denied' ? 'denied' : notYet || ['denied', 'cancelled'].includes(r.status) ? 'later' : 'waiting',
    });
  }
  const leagueState = r.status === 'approved' ? 'done' : r.status === 'pending_admin' ? 'waiting' : r.status === 'denied' && !r.steps.some((s) => s.decision === 'denied') ? 'denied' : 'later';
  out.push({
    label: 'League sign-off',
    sub: leagueState === 'done' ? `Approved by ${r.decidedByName} · ${timestamp(r.decidedAt)}` : leagueState === 'denied' ? `Denied by ${r.decidedByName} · ${timestamp(r.decidedAt)}` : leagueState === 'waiting' ? 'Waiting' : r.status === 'cancelled' ? 'Request withdrawn' : r.status === 'denied' ? 'Not needed' : 'After the programs agree',
    state: leagueState,
  });
  return out;
}
const DOT = { done: 'bg-success', denied: 'bg-danger', waiting: 'bg-pending', later: 'bg-border' };

const busyId = ref('');
async function act(r, action, note = null) {
  busyId.value = r.id;
  try {
    const { data } = await api.post(`/requests/${r.id}/act`, { action, note });
    toast.success(data.request.status === 'approved' ? 'Approved. The schedule has been updated.' : action === 'deny' ? 'Request denied.' : `Done. Now: ${data.request.statusLabel.toLowerCase()}.`);
    denying.value = null;
    await load();
    badge.refresh();
  } catch (err) {
    if (denying.value) denyError.value = errorMessage(err); else toast.error(errorMessage(err));
  } finally { busyId.value = ''; }
}
async function cancel(r) {
  busyId.value = r.id;
  try { await api.post(`/requests/${r.id}/cancel`); toast.success('Request cancelled.'); await load(); badge.refresh(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { busyId.value = ''; }
}

const denying = ref(null);
const denyNote = ref('');
const denyError = ref('');
function openDeny(r) { denying.value = r; denyNote.value = ''; denyError.value = ''; }
</script>

<template>
  <div>
    <PageHeader title="Change requests" subtitle="Moves and swaps on the published schedule. Coach requests go to their director first, then every other program involved agrees, then the league signs off." />

    <div class="flex flex-wrap items-center gap-3 mb-4">
      <div class="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="tablist">
        <button role="tab" class="px-3 py-1.5" :aria-selected="state === 'open'" :class="state === 'open' ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="switchTo('open')">Open</button>
        <button role="tab" class="px-3 py-1.5" :aria-selected="state === 'closed'" :class="state === 'closed' ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="switchTo('closed')">Decided</button>
      </div>
      <p v-if="state === 'open' && waitingCount" class="text-sm font-medium">{{ waitingCount }} waiting on you</p>
    </div>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!sorted.length" :title="state === 'open' ? 'No open requests' : 'No decided requests yet'"
      :body="auth.isSuperAdmin ? 'Coaches and directors file requests from the Schedule page.' : 'To ask for a change, open the Schedule and choose Request change on one of your games.'" />

    <div v-else class="space-y-4">
      <article v-for="r in sorted" :key="r.id" class="card p-5" :class="needsMe(r) && 'ring-2 ring-accent'">
        <header class="flex flex-wrap items-center gap-2 mb-3">
          <span class="badge badge-outline">{{ { swap: 'Swap', cancel: 'Cancel', reschedule: 'Move' }[r.type] }}</span>
          <span class="badge" :class="STATUS_STYLE[r.status]">{{ r.statusLabel }}</span>
          <span v-if="needsMe(r)" class="text-xs font-semibold">Needs your decision</span>
          <span class="text-xs text-text-muted ml-auto">{{ r.game.divisionName }}</span>
        </header>

        <div class="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-stretch">
          <div class="rounded-lg border border-border p-3 min-w-0">
            <p class="text-xs text-text-muted mb-1">{{ r.type === 'swap' ? 'Game 1' : applied(r) ? 'Was' : 'Now' }}{{ r.type === 'swap' && applied(r) ? ' (before swap)' : '' }} · {{ longDate(firstGame(r).date) }}</p>
            <GameRow :game="firstGame(r)" compact :show-division="false" />
          </div>
          <div class="grid place-items-center text-text-muted text-lg" aria-hidden="true"><span class="rotate-90 md:rotate-0 inline-block">{{ { swap: '⇄', cancel: '✕' }[r.type] || '→' }}</span></div>
          <div class="rounded-lg border border-border p-3 min-w-0">
            <template v-if="r.type === 'swap'">
              <p class="text-xs text-text-muted mb-1">Game 2{{ applied(r) ? ' (before swap)' : '' }} · {{ longDate(secondGame(r).date) }}</p>
              <GameRow :game="secondGame(r)" compact :show-division="false" />
            </template>
            <template v-else-if="r.type === 'cancel'">
              <p class="text-xs text-text-muted mb-1">{{ r.status === 'approved' ? 'Cancelled' : 'Requested' }}</p>
              <p class="text-sm font-semibold">{{ r.status === 'approved' ? 'This game was cancelled' : 'Cancel this game' }}</p>
              <p class="text-xs text-text-muted">It won’t be played. Any referees are taken off.</p>
            </template>
            <template v-else>
              <p class="text-xs text-text-muted mb-1">{{ r.status === 'approved' ? 'Moved to' : 'Proposed' }}</p>
              <p class="text-sm font-semibold">{{ longDate(r.proposedDate) }}</p>
              <p class="text-sm">{{ timeRange(r.proposedStartTime, r.proposedEndTime) }}</p>
              <p class="text-xs text-text-muted">{{ r.proposedVenueName }} – {{ r.proposedCourtName }}</p>
            </template>
          </div>
        </div>

        <blockquote class="text-sm mt-3 border-l-2 border-border pl-3">{{ r.reason }}</blockquote>

        <ol class="mt-4 space-y-2">
          <li v-for="(t, i) in timeline(r)" :key="i" class="flex gap-3 text-sm">
            <span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" :class="DOT[t.state]" aria-hidden="true" />
            <span class="min-w-0">
              <span class="font-medium" :class="t.state === 'later' && 'text-text-muted'">{{ t.label }}</span>
              <span class="text-text-muted"> · {{ t.sub }}</span>
              <span v-if="t.note" class="block text-xs italic">“{{ t.note }}”</span>
            </span>
          </li>
        </ol>
        <p v-if="r.decisionNote && !['pending_director','pending_counterpart','pending_admin'].includes(r.status)" class="text-sm mt-2"><span class="font-medium">Note:</span> {{ r.decisionNote }}</p>

        <footer v-if="r.actions.length" class="flex flex-wrap justify-end gap-2 mt-4 pt-3 border-t border-border">
          <button v-if="r.actions.includes('cancel')" class="btn btn-ghost" :disabled="busyId === r.id" @click="cancel(r)">Withdraw request</button>
          <button v-if="r.actions.includes('deny')" class="btn btn-secondary" :disabled="busyId === r.id" @click="openDeny(r)">Deny</button>
          <button v-if="r.actions.includes('approve')" class="btn btn-primary" :disabled="busyId === r.id" @click="act(r, 'approve')">{{ busyId === r.id ? 'Working…' : approveLabel(r) }}</button>
        </footer>
      </article>
    </div>

    <Modal v-if="denying" title="Deny this request?" @close="denying = null">
      <p class="text-sm mb-3">{{ denying.summary }}</p>
      <label class="label" for="deny-note">Note for the requester</label>
      <textarea id="deny-note" v-model="denyNote" rows="3" class="input" maxlength="400" placeholder="e.g. That date conflicts with our tournament. Could you try the following Saturday?" />
      <p v-if="denyError" class="text-sm text-danger mt-2" role="alert">{{ denyError }}</p>
      <template #footer>
        <button class="btn btn-secondary" @click="denying = null">Back</button>
        <button class="btn btn-danger" :disabled="denyNote.trim().length < 3 || busyId === denying.id" @click="act(denying, 'deny', denyNote.trim())">Deny request</button>
      </template>
    </Modal>
  </div>
</template>
