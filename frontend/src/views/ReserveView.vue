<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { money, monthDay, timestamp, todayISO } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

// Referee payout reserve. A program on a reserve prepays the referee assignor;
// the assignor pays its referees and the payouts come out of the reserve.
// Directors see their own program; the assignor and System Admin see every
// program (guest programs included) and keep the books.
const toast = useToast();
const auth = useAuthStore();
const ctx = useProgramContext();
const today = todayISO();
const league = computed(() => ['super_admin', 'referee_assignor'].includes(auth.user?.role));

const seasonId = ref('');
const summary = ref(null);
const selected = ref('');   // program being viewed
const detail = ref(null);
const loading = ref(true);
const from = ref('');
const to = ref('');

async function loadSummary() {
  const { data } = await api.get('/reserves', { params: seasonId.value ? { seasonId: seasonId.value } : {} });
  summary.value = data;
  if (!seasonId.value) seasonId.value = data.season.id;
  if (!league.value) selected.value = data.programs[0]?.programId || '';
  else if (!selected.value && ctx.programId) selected.value = ctx.programId;
}
async function loadDetail() {
  if (!selected.value) { detail.value = null; return; }
  const params = { seasonId: seasonId.value, ...(from.value ? { from: from.value } : {}), ...(to.value ? { to: to.value } : {}) };
  detail.value = (await api.get(`/reserves/${selected.value}`, { params })).data;
}
async function load() {
  loading.value = true;
  try { await loadSummary(); await loadDetail(); }
  catch (err) { summary.value = null; toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);
watch(selected, () => { from.value = ''; to.value = ''; loadDetail().catch((err) => toast.error(errorMessage(err))); });
watch(seasonId, (v, old) => { if (old) load(); });
watch(() => ctx.programId, (id) => { if (league.value && id) selected.value = id; });
const refresh = async () => { await loadSummary(); await loadDetail(); };

const f = computed(() => detail.value?.figures);
const prog = computed(() => detail.value?.program);
const onReserve = computed(() => prog.value?.mode === 'reserve');
const isActiveSeason = computed(() => summary.value && seasonId.value === (summary.value.seasons.find((s) => s.isActive)?.id));
const reserveRows = computed(() => (summary.value?.programs || []).filter((p) => p.mode === 'reserve' || p.deposited || p.balance || p.paidOut));
const directRows = computed(() => (summary.value?.programs || []).filter((p) => !reserveRows.value.includes(p)));
const signed = (c) => `${c < 0 ? '−' : ''}${money(Math.abs(c))}`;
const toCents = (v) => Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100);

// ---- downloads and printing ----
async function download(url, params, filename) {
  try {
    const res = await api.get(url, { params: { ...params, format: 'csv' }, responseType: 'blob' });
    const href = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (err) { toast.error(errorMessage(err)); }
}
const printStatement = () => window.print();

// ---- deposits, refunds, adjustments ----
const entry = ref(null); // { kind, amount, method, entryDate, note, direction }
const entryError = ref('');
const saving = ref(false);
function openEntry(kind) {
  entryError.value = '';
  entry.value = { kind, amount: '', method: kind === 'adjustment' ? null : 'check', entryDate: today, note: '', direction: 'add' };
}
const entryTitle = computed(() => (!entry.value ? '' : entry.value.kind === 'deposit' ? (league.value ? 'Record a deposit' : 'Add a deposit') : entry.value.kind === 'refund' ? 'Record a refund' : 'Record an adjustment'));
async function saveEntry() {
  const e = entry.value;
  entryError.value = '';
  const cents = toCents(e.amount);
  if (!cents || cents < 0) { entryError.value = 'Enter the amount, e.g. 250.00.'; return; }
  saving.value = true;
  try {
    const { data } = await api.post(`/reserves/${selected.value}/entries`, {
      kind: e.kind, amountCents: e.kind === 'adjustment' && e.direction === 'take' ? -cents : cents, method: e.method, entryDate: e.entryDate, note: e.note,
    });
    toast.success(data.entry.status === 'pending' ? 'Deposit added. It counts toward your reserve once the referee assignor confirms they received it.' : 'Recorded.');
    entry.value = null;
    await refresh();
  } catch (err) { entryError.value = errorMessage(err); }
  finally { saving.value = false; }
}

// ---- confirm / decline / withdraw a pending deposit ----
const busyId = ref('');
async function confirmDeposit(d) {
  busyId.value = d.id;
  try { await api.post(`/reserves/entries/${d.id}/confirm`); toast.success(`Confirmed. ${money(d.amountCents)} is now in the reserve.`); await refresh(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { busyId.value = ''; }
}
const declining = ref(null);
const declineNote = ref('');
async function decline() {
  saving.value = true;
  try { await api.post(`/reserves/entries/${declining.value.id}/decline`, { note: declineNote.value }); toast.success('Declined. The program has been told why.'); declining.value = null; await refresh(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}
const withdrawing = ref(null);
async function withdraw() {
  saving.value = true;
  try { await api.delete(`/reserves/entries/${withdrawing.value.id}`); toast.success('Deposit withdrawn.'); withdrawing.value = null; await refresh(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}

// ---- reverse a confirmed entry ----
const reversing = ref(null);
const reverseNote = ref('');
async function reverse() {
  saving.value = true;
  try {
    await api.post(`/reserves/${selected.value}/entries`, { reversesId: reversing.value.id, note: reverseNote.value });
    toast.success('Reversed. The correction is on the statement.');
    reversing.value = null;
    await refresh();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}

// ---- refund what's left (season end) ----
const refunding = ref(null);
const refundError = ref('');
async function refundBalance() {
  saving.value = true;
  refundError.value = '';
  try {
    const { data } = await api.post(`/reserves/${selected.value}/refund-balance`, refunding.value);
    toast.success(`Refund of ${money(data.entry.amountCents)} recorded. The reserve is now at $0.00.`);
    refunding.value = null;
    await refresh();
  } catch (err) { refundError.value = errorMessage(err); }
  finally { saving.value = false; }
}

// ---- settings: pay mode (league), alert level ----
const switching = ref(false);
async function switchMode() {
  saving.value = true;
  try {
    await api.put(`/reserves/${selected.value}/settings`, { mode: onReserve.value ? 'direct' : 'reserve' });
    toast.success(onReserve.value ? `${prog.value.name} now pays its referees directly.` : `${prog.value.name} now pays referees from a reserve.`);
    switching.value = false;
    await refresh();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}
const alertInput = ref('');
watch(prog, (p) => { alertInput.value = p?.alertCents == null ? '' : (p.alertCents / 100).toFixed(2); });
async function saveAlert() {
  const v = alertInput.value.trim() === '' ? null : toCents(alertInput.value);
  if (v !== null && (Number.isNaN(v) || v < 0)) { toast.error('Enter an amount like 100.00, or leave it blank.'); return; }
  try { await api.put(`/reserves/${selected.value}/settings`, { alertCents: v }); toast.success(v === null ? 'Low-balance email turned off.' : `You’ll be emailed when the available amount drops below ${money(v)}.`); await refresh(); }
  catch (err) { toast.error(errorMessage(err)); }
}

const openPayout = ref('');
const METHOD_OPTIONS = [['check', 'Check'], ['cash', 'Cash'], ['venmo', 'Venmo'], ['other', 'Other']];
</script>

<template>
  <div class="reserve-page">
    <PageHeader :title="league ? 'Referee reserves' : 'Referee reserve'"
      :subtitle="league
        ? 'Money programs have prepaid you for referees, what’s been paid out of it, and what’s left. Programs on a reserve are paid from it when you mark their referees paid.'
        : 'Money your program has prepaid the referee assignor for referees, what’s been paid out of it, and what’s left.'">
      <select v-if="summary?.seasons?.length > 1" v-model="seasonId" class="input !w-auto no-print" aria-label="Season">
        <option v-for="s in summary.seasons" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </PageHeader>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <template v-else-if="summary">
      <!-- League summary -->
      <section v-if="league && !selected" class="space-y-4">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Held for all programs</p><p class="text-2xl font-bold">{{ signed(summary.totals.balance) }}</p><p class="text-xs text-text-muted">should match the money you hold</p></div>
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Deposited</p><p class="text-2xl font-bold">{{ money(summary.totals.deposited) }}</p></div>
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Paid out to referees</p><p class="text-2xl font-bold">{{ money(summary.totals.paidOut) }}</p></div>
          <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Deposits to confirm</p><p class="text-2xl font-bold">{{ summary.totals.pendingDeposits }}</p></div>
        </div>
        <div class="flex flex-wrap gap-2 no-print">
          <button class="btn btn-secondary ml-auto" @click="download('/reserves', { seasonId }, `referee-reserves-${summary.season.name}.csv`)">Download summary (CSV)</button>
        </div>
        <div class="card card-blocky overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-text-muted text-left"><tr class="border-b border-border">
              <th class="px-4 py-2 font-medium">Program</th><th class="px-3 py-2 font-medium text-right">Deposited</th><th class="px-3 py-2 font-medium text-right">Paid out</th>
              <th class="px-3 py-2 font-medium text-right">Balance</th><th class="px-3 py-2 font-medium text-right">Owed</th><th class="px-3 py-2 font-medium text-right">Upcoming</th>
              <th class="px-3 py-2 font-medium text-right">Available</th><th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr></thead>
            <tbody class="divide-y divide-border">
              <tr v-for="p in reserveRows" :key="p.programId" class="cursor-pointer hover:bg-background" @click="selected = p.programId">
                <td class="px-4 py-2">
                  <span class="font-medium">{{ p.name }}</span><span v-if="p.isGuest" class="text-text-muted"> (guest)</span>
                  <span v-if="p.pendingDeposits" class="badge bg-pending text-black ml-2">{{ p.pendingDeposits }} to confirm</span>
                  <span v-if="p.mode !== 'reserve'" class="block text-xs text-text-muted">Now pays referees directly</span>
                </td>
                <td class="px-3 py-2 text-right tabular-nums">{{ money(p.deposited) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ money(p.paidOut) }}</td>
                <td class="px-3 py-2 text-right tabular-nums font-medium">{{ signed(p.balance) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ money(p.owed) }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ money(p.upcoming) }}</td>
                <td class="px-3 py-2 text-right tabular-nums font-semibold" :class="p.available < 0 && 'text-danger'">{{ signed(p.available) }}</td>
                <td class="px-3 py-2 text-right"><span class="text-accent-text text-xs font-medium">Open ›</span></td>
              </tr>
              <tr v-if="!reserveRows.length"><td colspan="8" class="px-4 py-4 text-sm text-text-muted">No program is on a reserve yet. Open a program below and choose <strong>Switch to a reserve</strong>.</td></tr>
            </tbody>
          </table>
        </div>
        <details v-if="directRows.length" class="card card-blocky px-4 py-3 text-sm">
          <summary class="cursor-pointer font-medium">Programs that pay referees directly ({{ directRows.length }})</summary>
          <ul class="mt-2 flex flex-wrap gap-2">
            <li v-for="p in directRows" :key="p.programId"><button class="btn btn-secondary !py-1 text-xs" @click="selected = p.programId">{{ p.name }}{{ p.isGuest ? ' (guest)' : '' }}</button></li>
          </ul>
        </details>
      </section>

      <!-- One program -->
      <section v-else-if="detail" class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <button v-if="league" class="btn btn-ghost no-print" @click="selected = ''">‹ All programs</button>
          <h2 class="text-lg font-semibold">{{ prog.name }}<span v-if="prog.isGuest" class="text-text-muted font-normal"> (guest)</span></h2>
          <span class="badge" :class="onReserve ? 'bg-success text-black' : 'badge-outline'">{{ onReserve ? 'Pays referees from its reserve' : 'Pays referees directly' }}</span>
          <button v-if="league" class="btn btn-secondary !py-1 text-sm ml-auto no-print" @click="switching = true">{{ onReserve ? 'Switch to paying directly' : 'Switch to a reserve' }}</button>
        </div>

        <div v-if="!onReserve && !f.deposited && !f.paidOut" class="card card-blocky p-4 text-sm">
          <p v-if="league">{{ prog.name }} pays its referees directly, from Referee payouts. Switch it to a reserve if it prepays you instead: you’ll record its deposits here and pay its referees from it.</p>
          <p v-else>Your program pays its referees directly, from <RouterLink to="/payouts" class="underline">Referee payouts</RouterLink>. If you’d rather prepay the referee assignor and have them pay your referees, ask the league to switch your program to a reserve.</p>
        </div>

        <template v-else>
          <div class="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Balance</p><p class="text-2xl font-bold" :class="f.balance < 0 && 'text-danger'">{{ signed(f.balance) }}</p><p class="text-xs text-text-muted">{{ f.balance < 0 ? `owes the reserve ${money(-f.balance)}` : 'held by the referee assignor' }}</p></div>
            <div class="card card-blocky p-4 border-2" :class="f.available < 0 ? '!border-danger' : '!border-accent'">
              <p class="text-xs text-text-muted">Available</p><p class="text-2xl font-bold" :class="f.available < 0 && 'text-danger'">{{ signed(f.available) }}</p>
              <p class="text-xs" :class="f.available < 0 ? 'font-semibold' : 'text-text-muted'">{{ f.available < 0 ? `Short ${money(-f.available)} for referees owed and assigned` : `covers about ${f.gamesLeft} more referee fee${f.gamesLeft === 1 ? '' : 's'}` }}</p>
            </div>
            <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Deposited</p><p class="text-2xl font-bold">{{ money(f.deposited) }}</p><p v-if="f.refunded || f.adjusted" class="text-xs text-text-muted">{{ f.refunded ? `${money(f.refunded)} refunded` : '' }}{{ f.refunded && f.adjusted ? ' · ' : '' }}{{ f.adjusted ? `${signed(f.adjusted)} adjustments` : '' }}</p></div>
            <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Paid out to referees</p><p class="text-2xl font-bold">{{ money(f.paidOut) }}</p></div>
            <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Owed, not yet paid</p><p class="text-2xl font-bold">{{ money(f.owed) }}</p><p class="text-xs text-text-muted">referees who worked its games</p></div>
            <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Upcoming (estimate)</p><p class="text-2xl font-bold">{{ money(f.upcoming) }}</p><p class="text-xs text-text-muted">referees assigned to future games</p></div>
          </div>

          <!-- Deposits waiting -->
          <section v-if="detail.pending.length" class="card card-blocky p-4">
            <h3 class="text-sm font-semibold mb-2">Deposits waiting for the referee assignor to confirm</h3>
            <ul class="divide-y divide-border">
              <li v-for="d in detail.pending" :key="d.id" class="py-2 flex flex-wrap items-center gap-3 text-sm">
                <span class="font-semibold tabular-nums">{{ money(d.amountCents) }}</span>
                <span>{{ d.method }} · {{ monthDay(d.date) }}<template v-if="d.note"> · “{{ d.note }}”</template></span>
                <span class="text-xs text-text-muted">added by {{ d.enteredByName }} {{ timestamp(d.enteredAt) }}</span>
                <span class="ml-auto flex gap-2 no-print">
                  <template v-if="league">
                    <button class="btn btn-secondary !py-1" @click="declining = d; declineNote = ''">Decline</button>
                    <button class="btn btn-primary !py-1" :disabled="busyId === d.id" @click="confirmDeposit(d)">Confirm received</button>
                  </template>
                  <button v-else class="btn btn-ghost !py-1" @click="withdrawing = d">Withdraw</button>
                </span>
              </li>
            </ul>
            <p v-if="!league" class="text-xs text-text-muted mt-1">It counts toward your reserve once the referee assignor confirms they received it.</p>
          </section>
          <section v-if="detail.declined.length" class="card card-blocky p-4 text-sm">
            <h3 class="text-sm font-semibold mb-1">Deposits not confirmed</h3>
            <p v-for="d in detail.declined" :key="d.id">{{ money(d.amountCents) }} · {{ d.method }} · {{ monthDay(d.date) }}: <em>“{{ d.decisionNote }}”</em> ({{ d.decidedByName }})</p>
          </section>

          <!-- Actions -->
          <div v-if="isActiveSeason" class="flex flex-wrap items-end gap-2 no-print">
            <template v-if="league">
              <button class="btn btn-primary" :disabled="!onReserve" @click="openEntry('deposit')">Record a deposit</button>
              <button class="btn btn-secondary" @click="openEntry('refund')">Refund</button>
              <button class="btn btn-secondary" @click="openEntry('adjustment')">Adjustment</button>
              <button class="btn btn-secondary" :disabled="f.balance <= 0" @click="refunding = { method: 'check', entryDate: today, note: '' }; refundError = ''">Refund what’s left…</button>
            </template>
            <button v-else-if="onReserve" class="btn btn-primary" @click="openEntry('deposit')">Add a deposit</button>
            <form v-if="onReserve && (league || !prog.isGuest)" class="flex items-end gap-2 ml-auto" @submit.prevent="saveAlert">
              <div>
                <label class="label" for="rs-alert">Email {{ league ? 'the program' : 'me' }} when available drops below</label>
                <input id="rs-alert" v-model="alertInput" class="input !w-32" inputmode="decimal" placeholder="e.g. 100.00" />
              </div>
              <button class="btn btn-secondary" type="submit">Save</button>
            </form>
          </div>

          <!-- Statement -->
          <section class="card card-blocky">
            <div class="flex flex-wrap items-end gap-3 px-4 pt-4">
              <h3 class="font-semibold mr-auto">Statement · {{ detail.season.name }}</h3>
              <div class="no-print"><label class="label" for="rs-from">From</label><input id="rs-from" v-model="from" type="date" class="input" /></div>
              <div class="no-print"><label class="label" for="rs-to">To</label><input id="rs-to" v-model="to" type="date" class="input" :min="from" /></div>
              <button class="btn btn-secondary no-print" @click="loadDetail">Update</button>
              <button class="btn btn-secondary no-print" @click="download(`/reserves/${selected}`, { seasonId, from, to }, `referee-reserve-${prog.name}-${detail.season.name}.csv`)">Download (CSV)</button>
              <button class="btn btn-secondary no-print" @click="printStatement">Print / Save as PDF</button>
            </div>
            <div class="overflow-x-auto mt-3">
              <table class="w-full text-sm">
                <thead class="text-xs text-text-muted text-left"><tr class="border-b border-border">
                  <th class="px-4 py-2 font-medium">Date</th><th class="px-3 py-2 font-medium">Entry</th><th class="px-3 py-2 font-medium">Details</th>
                  <th class="px-3 py-2 font-medium text-right">Amount</th><th class="px-4 py-2 font-medium text-right">Balance</th>
                </tr></thead>
                <tbody class="divide-y divide-border">
                  <tr class="text-text-muted"><td class="px-4 py-2" /><td class="px-3 py-2" colspan="3">Opening balance{{ detail.statement.from ? ` on ${monthDay(detail.statement.from)}` : '' }}</td><td class="px-4 py-2 text-right tabular-nums">{{ signed(detail.statement.opening) }}</td></tr>
                  <template v-for="l in detail.statement.lines" :key="`${l.type}-${l.id}`">
                    <tr class="align-top">
                      <td class="px-4 py-2 whitespace-nowrap">{{ monthDay(l.date) }}</td>
                      <td class="px-3 py-2"><span class="font-medium">{{ l.label }}</span><span v-if="l.method" class="text-text-muted"> · {{ l.method }}</span>
                        <span v-if="l.reversed" class="badge badge-outline ml-1">reversed</span><span v-if="l.reversesId" class="badge badge-outline ml-1">correction</span></td>
                      <td class="px-3 py-2 text-xs text-text-muted">
                        <template v-if="l.type === 'payout'">
                          <button class="underline no-print" @click="openPayout = openPayout === l.id ? '' : l.id">{{ l.games.length }} game{{ l.games.length === 1 ? '' : 's' }}</button><span class="print-only">{{ l.games.length }} game{{ l.games.length === 1 ? '' : 's' }}</span>
                          · {{ l.confirmedAt ? 'referee confirmed ✓' : 'waiting for the referee to confirm' }}
                        </template>
                        <template v-else>{{ l.note }}</template>
                        <span class="block">{{ l.by }}{{ l.confirmedBy ? `, confirmed by ${l.confirmedBy}` : '' }}</span>
                        <button v-if="l.canReverse && isActiveSeason" class="btn btn-ghost !p-0 text-xs no-print" @click="reversing = l; reverseNote = ''">Reverse…</button>
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums whitespace-nowrap" :class="l.cents > 0 && 'font-medium'">{{ l.cents > 0 ? '+' : '' }}{{ signed(l.cents) }}</td>
                      <td class="px-4 py-2 text-right tabular-nums whitespace-nowrap" :class="l.balance < 0 && 'text-danger'">{{ signed(l.balance) }}</td>
                    </tr>
                    <tr v-if="l.type === 'payout' && openPayout === l.id">
                      <td /><td colspan="4" class="px-3 pb-2 text-xs">
                        <p v-for="g in l.games" :key="g.date + g.label">{{ monthDay(g.date) }} · {{ g.label }} · {{ money(g.cents) }}</p>
                      </td>
                    </tr>
                  </template>
                  <tr v-if="!detail.statement.lines.length"><td colspan="5" class="px-4 py-3 text-text-muted">Nothing in these dates yet.</td></tr>
                  <tr class="font-semibold"><td class="px-4 py-2" /><td class="px-3 py-2" colspan="3">Closing balance{{ detail.statement.to ? ` on ${monthDay(detail.statement.to)}` : '' }}</td><td class="px-4 py-2 text-right tabular-nums" :class="detail.statement.closing < 0 && 'text-danger'">{{ signed(detail.statement.closing) }}</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>
      </section>
      <EmptyState v-else-if="!league" title="No program" body="Your account isn’t assigned to a program." />
    </template>

    <!-- Deposit / refund / adjustment -->
    <Modal v-if="entry" :title="entryTitle" @close="entry = null">
      <form id="rs-entry" class="space-y-4" @submit.prevent="saveEntry">
        <p v-if="entry.kind === 'deposit' && !league" class="text-sm text-text-muted">Pay the referee assignor first, then add it here. It counts toward your reserve once they confirm they received it.</p>
        <p v-else-if="entry.kind === 'refund'" class="text-sm text-text-muted">Money you gave back to {{ prog.name }}. It comes off the reserve.</p>
        <p v-else-if="entry.kind === 'adjustment'" class="text-sm text-text-muted">For anything else that changes the reserve, e.g. a fee or a correction. Say what it’s for; it shows on the program’s statement.</p>
        <fieldset v-if="entry.kind === 'adjustment'" class="flex gap-4 text-sm">
          <label class="flex items-center gap-2"><input v-model="entry.direction" type="radio" value="add" class="accent-[var(--color-accent)]" /> Add to the reserve</label>
          <label class="flex items-center gap-2"><input v-model="entry.direction" type="radio" value="take" class="accent-[var(--color-accent)]" /> Take from the reserve</label>
        </fieldset>
        <div class="grid gap-3 sm:grid-cols-3">
          <div><label class="label" for="rs-amount">Amount ($)</label><input id="rs-amount" v-model="entry.amount" class="input" inputmode="decimal" placeholder="e.g. 500.00" required /></div>
          <div v-if="entry.kind !== 'adjustment'"><label class="label" for="rs-method">{{ entry.kind === 'refund' ? 'Refunded by' : 'Paid by' }}</label>
            <select id="rs-method" v-model="entry.method" class="input"><option v-for="[k, l] in METHOD_OPTIONS" :key="k" :value="k">{{ l }}</option></select></div>
          <div><label class="label" for="rs-date">Date</label><input id="rs-date" v-model="entry.entryDate" type="date" class="input" :max="today" required /></div>
        </div>
        <div><label class="label" for="rs-note">Note <span v-if="entry.kind !== 'adjustment'" class="font-normal text-text-muted">(optional)</span></label>
          <input id="rs-note" v-model="entry.note" class="input" maxlength="300" :placeholder="entry.kind === 'deposit' ? 'e.g. Check #1001' : entry.kind === 'adjustment' ? 'e.g. Bank fee for returned check' : ''" :required="entry.kind === 'adjustment'" /></div>
        <p v-if="entryError" class="text-sm text-danger" role="alert">{{ entryError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="entry = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="rs-entry" :disabled="saving">{{ saving ? 'Saving…' : entry.kind === 'deposit' && !league ? 'Add deposit' : 'Record' }}</button>
      </template>
    </Modal>

    <Modal v-if="declining" title="Decline this deposit?" @close="declining = null">
      <p class="text-sm mb-3">{{ money(declining.amountCents) }} · {{ declining.method }} · {{ monthDay(declining.date) }}. The program is told why; it doesn’t count toward their reserve.</p>
      <label class="label" for="rs-decline">Reason</label>
      <input id="rs-decline" v-model="declineNote" class="input" maxlength="300" placeholder="e.g. Not received yet" />
      <template #footer>
        <button class="btn btn-secondary" @click="declining = null">Back</button>
        <button class="btn btn-danger" :disabled="saving || declineNote.trim().length < 3" @click="decline">Decline deposit</button>
      </template>
    </Modal>

    <Modal v-if="reversing" title="Reverse this entry?" @close="reversing = null">
      <p class="text-sm mb-3">{{ reversing.label }} of {{ signed(Math.abs(reversing.cents)) }} on {{ monthDay(reversing.date) }}. A correcting entry for the opposite amount is added to the statement; the original stays, marked reversed.</p>
      <label class="label" for="rs-reverse">Why?</label>
      <input id="rs-reverse" v-model="reverseNote" class="input" maxlength="300" placeholder="e.g. Entered twice / check returned" />
      <template #footer>
        <button class="btn btn-secondary" @click="reversing = null">Back</button>
        <button class="btn btn-danger" :disabled="saving || reverseNote.trim().length < 3" @click="reverse">Reverse entry</button>
      </template>
    </Modal>

    <Modal v-if="refunding" title="Refund what’s left" @close="refunding = null">
      <div class="space-y-3 text-sm">
        <p>Records a refund of the whole balance, <strong>{{ money(f.balance) }}</strong>, to {{ prog.name }}, bringing the reserve to $0.00. Pay it back first, then record it here.</p>
        <p v-if="f.owed" class="rounded-md bg-pending text-black px-3 py-2">Referees are still owed {{ money(f.owed) }} for games already played. Pay them from the reserve first.</p>
        <p v-if="f.upcoming" class="text-text-muted">Referees are still assigned to upcoming games (about {{ money(f.upcoming) }}). After the refund, those would need a new deposit.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="label" for="rf-method">Refunded by</label><select id="rf-method" v-model="refunding.method" class="input"><option v-for="[k, l] in METHOD_OPTIONS" :key="k" :value="k">{{ l }}</option></select></div>
          <div><label class="label" for="rf-date">Date</label><input id="rf-date" v-model="refunding.entryDate" type="date" class="input" :max="today" /></div>
        </div>
        <div><label class="label" for="rf-note">Note <span class="font-normal text-text-muted">(optional)</span></label><input id="rf-note" v-model="refunding.note" class="input" maxlength="300" placeholder="Remaining balance refunded at season end" /></div>
        <p v-if="refundError" class="text-danger" role="alert">{{ refundError }}</p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="refunding = null">Cancel</button>
        <button class="btn btn-primary" :disabled="saving || f.owed > 0" @click="refundBalance">Record refund of {{ money(f.balance) }}</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="switching" :title="onReserve ? 'Switch to paying directly?' : 'Switch to a reserve?'" tone="primary" :busy="saving"
      :confirm-label="onReserve ? 'Pay directly' : 'Use a reserve'"
      :message="onReserve
        ? `${prog.name}’s director will pay its referees from Referee payouts again. Anything left in the reserve stays on its statement until you refund it.`
        : `${prog.name} prepays you, and you pay its referees from Referee payouts; each payment comes out of its reserve. Its director can no longer mark its referees paid, and is emailed about the change.`"
      @confirm="switchMode" @close="switching = false" />
  </div>
</template>

<style>
.print-only { display: none; }
@media print {
  body:has(.reserve-page) header, body:has(.reserve-page) .app-footer, .reserve-page .no-print { display: none !important; }
  .reserve-page .print-only { display: inline; }
  .reserve-page .card { box-shadow: none !important; }
}
</style>
