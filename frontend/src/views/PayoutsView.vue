<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useBrandingStore } from '../stores/branding';
import { dateRange, money, monthDay, time12, todayISO, addDays, timestamp } from '../utils/format';
import { PAYMENT_METHODS, PAID_WITH } from '../utils/paymentMethods';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import QrCode from '../components/QrCode.vue';

const toast = useToast();
const auth = useAuthStore();
const ctx = useProgramContext();
const branding = useBrandingStore();
const today = todayISO();
const from = ref(addDays(today, -13));
const to = ref(today);
const data = ref(null);
const loading = ref(false);
const expanded = ref(null);
const isProgram = computed(() => auth.user?.role === 'program_director');
// A System Admin who picked one program in the header sees that program's view.
const oneProgram = computed(() => isProgram.value || !!ctx.programId);

async function load() {
  if (!from.value || !to.value) return;
  loading.value = true;
  try { data.value = (await api.get('/referees/payouts', { params: { from: from.value, to: to.value, ...(isProgram.value ? {} : ctx.query) } })).data; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(async () => {
  // Default to the whole season so far if the season has started.
  try {
    const s = (await api.get('/league/seasons')).data.seasons.find((x) => x.isActive);
    if (s && s.startDate <= today) from.value = s.startDate;
  } catch { /* keep the two-week default */ }
  load();
});
watch(() => ctx.programId, () => { if (!isProgram.value) load(); });

// The file is fetched with the sign-in token, then handed to the browser to save.
const downloading = ref('');
async function download(type) {
  downloading.value = type;
  try {
    const res = await api.get('/referees/payouts', { params: { from: from.value, to: to.value, format: 'csv', type, ...(isProgram.value ? {} : ctx.query) }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `referee-payouts-${type}-${from.value}-to-${to.value}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { toast.error(errorMessage(err)); }
  finally { downloading.value = ''; }
}

// ---- Unpaid / Paid / All ----
const show = ref('unpaid');
const visible = computed(() => (data.value?.summary || []).filter((s) => (show.value === 'unpaid' ? s.unpaidCents > 0 : show.value === 'paid' ? s.paidCents > 0 : true)));
const detailFor = (id) => data.value.detail.filter((d) => d.refereeId === id
  && (show.value === 'unpaid' ? d.outstandingCents > 0 : show.value === 'paid' ? d.paidCents > 0 : true));
const paymentsFor = (id) => (data.value.payments || []).filter((p) => p.refereeId === id);
const venmoOf = (s) => s.paymentMethods?.venmo || null;
const STATUS = { paid: ['Paid', 'bg-success text-black'], part: ['Partly paid', 'bg-pending text-black'], unpaid: ['Unpaid', 'badge-outline'] };

// ---- Pay (Venmo) and Mark as paid ----
const paying = ref(null); // { s, programId, selected: [assignmentId], method, paidOn, note }
const payError = ref('');
const saving = ref(false);
const owedTo = (s, programId) => data.value.detail.filter((d) => d.refereeId === s.refereeId && d.outstandingCents > 0 && (!programId || d.paidByProgramId === programId));
// Programs that still owe this referee (the league view picks one per payment).
const payerChoices = computed(() => {
  if (!paying.value) return [];
  const m = new Map();
  for (const d of owedTo(paying.value.s)) m.set(d.paidByProgramId, d.paidByName);
  return [...m.entries()];
});
function openPay(s) {
  payError.value = '';
  const choices = new Set(owedTo(s).map((d) => d.paidByProgramId));
  const programId = isProgram.value ? auth.user.programId : ctx.programId || (choices.size === 1 ? [...choices][0] : '');
  paying.value = { s, programId, selected: [], method: venmoOf(s) ? 'venmo' : 'check', paidOn: today, note: '' };
  selectAll();
}
function selectAll() { paying.value.selected = owedTo(paying.value.s, paying.value.programId).map((d) => d.assignmentId); }
const payItems = computed(() => (paying.value ? owedTo(paying.value.s, paying.value.programId) : []));
const chosen = computed(() => payItems.value.filter((d) => paying.value.selected.includes(d.assignmentId)));
const payTotal = computed(() => chosen.value.reduce((n, d) => n + d.outstandingCents, 0));
const programName = computed(() => payItems.value[0]?.paidByName || '');
const payNote = computed(() => {
  const dates = chosen.value.map((d) => d.date).sort();
  return dates.length ? `${branding.appName} referee · ${chosen.value.length} game${chosen.value.length === 1 ? '' : 's'}, ${dateRange(dates[0], dates.at(-1))} · ${programName.value}` : '';
});
const venmo = computed(() => (paying.value ? venmoOf(paying.value.s) : null));
const venmoPayUrl = computed(() => (venmo.value && payTotal.value ? PAYMENT_METHODS.venmo.payUrl(venmo.value.handle, payTotal.value, payNote.value) : ''));
// On a phone the button opens the Venmo app; on a computer the QR code is the
// quick way across to the phone.
const onPhone = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

async function markPaid() {
  const p = paying.value;
  payError.value = '';
  saving.value = true;
  try {
    await api.post('/referees/payments', { refereeId: p.s.refereeId, programId: p.programId, assignmentIds: p.selected, method: p.method, paidOn: p.paidOn, note: p.note });
    toast.success(`Marked ${money(payTotal.value)} as paid to ${p.s.name}. They’ve been emailed to confirm.`);
    paying.value = null;
    await load();
  } catch (err) { payError.value = errorMessage(err); }
  finally { saving.value = false; }
}

const undoing = ref(null);
async function undo() {
  saving.value = true;
  try {
    await api.delete(`/referees/payments/${undoing.value.id}`);
    toast.success('Payment taken off the record. Those games show as unpaid again.');
    undoing.value = null;
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { saving.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Referee payouts"
      :subtitle="isProgram
        ? 'The referees your program pays and what each is owed. Pay them (Venmo or however your program pays), then mark it as paid here. No money moves through this app.'
        : 'Games worked, what each referee is owed, which program pays them, and what has been paid. No money moves through this app.'" />

    <div class="card card-blocky p-4 mb-4 flex flex-wrap items-end gap-3">
      <div><label class="label" for="po-from">From</label><input id="po-from" v-model="from" type="date" class="input" /></div>
      <div><label class="label" for="po-to">To</label><input id="po-to" v-model="to" type="date" class="input" :min="from" /></div>
      <button class="btn btn-secondary" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Update' }}</button>
      <div class="flex flex-wrap gap-2 ml-auto">
        <button v-if="!oneProgram" class="btn btn-secondary" :disabled="!data?.totals.games || !!downloading" @click="download('programs')">{{ downloading === 'programs' ? 'Preparing…' : 'Download by program (CSV)' }}</button>
        <button class="btn btn-secondary" :disabled="!data?.totals.games || !!downloading" @click="download('detail')">{{ downloading === 'detail' ? 'Preparing…' : 'Download game detail (CSV)' }}</button>
        <button class="btn btn-secondary" :disabled="!data?.totals.games || !!downloading" @click="download('summary')">{{ downloading === 'summary' ? 'Preparing…' : 'Download summary (CSV)' }}</button>
      </div>
    </div>

    <template v-if="data">
      <div v-if="data.unconfirmed" class="card card-blocky p-4 mb-4 flex gap-3 items-start border-l-4 !border-l-warning">
        <p class="text-sm"><span class="font-semibold">{{ data.unconfirmed }} assigned referee{{ data.unconfirmed === 1 ? '' : 's' }} in this range never checked in.</span>
          They aren’t included below. Confirm who worked on the <RouterLink to="/assignments" class="underline">Assignments</RouterLink> page (Mark as worked or Mark no-show) before paying.</p>
      </div>

      <div class="card card-blocky border-l-4 border-l-accent px-4 py-3 mb-4 text-sm">
        <p><span class="font-medium">Who pays:</span> the home program pays Referee 1 and the away program pays Referee 2. If only one referee worked a game, the two programs pay half each. Guest programs pay their referee the same way. For a game between two of a program’s own teams, that program pays both.</p>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">{{ isProgram ? 'Your program still owes' : 'Still to pay' }}</p><p class="text-2xl font-bold">{{ money(data.totals.unpaidCents) }}</p></div>
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Marked as paid</p><p class="text-2xl font-bold">{{ money(data.totals.paidCents) }}</p></div>
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">{{ isProgram ? 'Games to pay for' : 'Games worked' }}</p><p class="text-2xl font-bold">{{ data.totals.games }}</p><p class="text-xs text-text-muted">{{ data.totals.referees }} referee{{ data.totals.referees === 1 ? '' : 's' }} · {{ money(data.totals.totalCents) }} in all</p></div>
      </div>

      <section v-if="!oneProgram && data.programs.length" class="card card-blocky mb-4 overflow-x-auto">
        <h2 class="px-4 pt-3 text-sm font-semibold">What each program owes</h2>
        <table class="w-full text-sm mt-1">
          <thead class="text-xs text-text-muted text-left"><tr>
            <th class="px-4 py-1.5 font-medium">Program</th><th class="px-4 py-1.5 font-medium text-right">Referee payments</th>
            <th class="px-4 py-1.5 font-medium text-right">Total</th><th class="px-4 py-1.5 font-medium text-right">Paid</th><th class="px-4 py-1.5 font-medium text-right">Still to pay</th>
          </tr></thead>
          <tbody class="divide-y divide-border">
            <tr v-for="p in data.programs" :key="p.programId">
              <td class="px-4 py-1.5">{{ p.name }}</td><td class="px-4 py-1.5 text-right tabular-nums">{{ p.payments }}</td>
              <td class="px-4 py-1.5 text-right tabular-nums">{{ money(p.totalCents) }}</td><td class="px-4 py-1.5 text-right tabular-nums">{{ money(p.paidCents) }}</td>
              <td class="px-4 py-1.5 text-right tabular-nums font-medium">{{ money(p.unpaidCents) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div class="flex flex-wrap items-center gap-3 mb-3">
        <div class="inline-flex rounded-lg border border-border overflow-hidden text-sm" role="tablist" aria-label="Which referees">
          <button v-for="[k, label] in [['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']]" :key="k" role="tab" class="px-3 py-1.5" :aria-selected="show === k"
            :class="show === k ? 'bg-accent text-accent-contrast font-semibold' : 'text-text-muted'" @click="show = k">{{ label }}</button>
        </div>
      </div>

      <EmptyState v-if="!data.summary.length" title="Nothing to pay for these dates" :body="isProgram ? `Your program has no referees to pay for games between ${dateRange(from, to)}.` : `No referee checked in to a game between ${dateRange(from, to)}.`" />
      <EmptyState v-else-if="!visible.length" :title="show === 'unpaid' ? 'Everyone is paid' : 'Nothing marked as paid yet'"
        :body="show === 'unpaid' ? `Every referee for games between ${dateRange(from, to)} is marked as paid.` : 'After paying a referee, choose Pay… and then Mark as paid.'" />
      <div v-else class="card card-blocky divide-y divide-border">
        <div v-for="s in visible" :key="s.refereeId">
          <div class="flex items-center gap-2 pr-3">
            <button class="flex-1 min-w-0 pl-4 pr-2 py-3 flex items-center gap-4 text-left hover:bg-background" :aria-expanded="expanded === s.refereeId" @click="expanded = expanded === s.refereeId ? null : s.refereeId">
              <span class="flex-1 min-w-0">
                <span class="font-medium">{{ s.name }}</span>
                <span class="block text-xs text-text-muted truncate">
                  <template v-if="venmoOf(s)">Venmo {{ venmoOf(s).display }}<span v-if="venmoOf(s).recentlyChanged" class="ml-1 font-semibold text-text">· updated {{ timestamp(venmoOf(s).updatedAt) }}</span></template>
                  <template v-else>No Venmo username yet</template>
                </span>
              </span>
              <span class="text-sm tabular-nums hidden sm:inline">{{ s.games }} game{{ s.games === 1 ? '' : 's' }}</span>
              <span class="text-right w-28">
                <span class="block text-sm font-semibold tabular-nums">{{ money(show === 'paid' ? s.paidCents : show === 'unpaid' ? s.unpaidCents : s.totalCents) }}</span>
                <span class="block text-xs text-text-muted">{{ s.unpaidCents ? (s.paidCents ? `${money(s.paidCents)} paid` : 'unpaid') : 'all paid' }}</span>
              </span>
              <span class="text-text-muted text-xs w-4" aria-hidden="true">{{ expanded === s.refereeId ? '▾' : '▸' }}</span>
            </button>
            <button v-if="s.unpaidCents" class="btn btn-primary !py-1.5 shrink-0" @click="openPay(s)">Pay…</button>
            <span v-else class="badge bg-success text-black shrink-0">Paid</span>
          </div>

          <div v-if="expanded === s.refereeId" class="px-4 pb-4 space-y-3">
            <ul class="space-y-2">
              <li v-for="d in detailFor(s.refereeId)" :key="d.id" class="text-xs">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span class="w-24 font-medium">{{ monthDay(d.date) }}, {{ time12(d.startTime) }}</span>
                  <span class="flex-1 min-w-[12rem]">{{ d.matchup }} · {{ d.divisionName }} · {{ d.venueName }}</span>
                  <span class="badge" :class="STATUS[d.payStatus][1]">{{ STATUS[d.payStatus][0] }}</span>
                  <span class="tabular-nums w-16 text-right">{{ money(d.amountCents) }}</span>
                </div>
                <p class="text-text-muted sm:pl-[6.75rem]">
                  <template v-if="!oneProgram">Paid by {{ d.paidByName }}<template v-if="d.isSplit"> (half of {{ money(d.fullCents) }})</template>.</template>
                  <template v-else-if="d.isSplit">Half of {{ money(d.fullCents) }}: the only referee on this game. {{ d.splitWith }} pays the other half.</template>
                  <template v-for="o in d.others" :key="o.position"> Referee {{ o.position }}, {{ o.name }}: paid by {{ o.paidBy }}.</template>
                  <template v-if="d.payStatus === 'part'"> {{ money(d.outstandingCents) }} still to pay.</template>
                </p>
              </li>
            </ul>
            <div v-if="paymentsFor(s.refereeId).length" class="rounded-lg border border-border">
              <p class="px-3 pt-2 text-xs font-semibold">Payments</p>
              <ul class="divide-y divide-border">
                <li v-for="p in paymentsFor(s.refereeId)" :key="p.id" class="px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span class="font-medium tabular-nums">{{ money(p.amountCents) }}</span>
                  <span>{{ p.methodLabel }} · {{ monthDay(p.paidOn) }}<template v-if="!oneProgram"> · {{ p.programName }}</template> · {{ p.games }} game{{ p.games === 1 ? '' : 's' }}</span>
                  <span class="text-text-muted">marked by {{ p.recordedByName || 'someone' }}</span>
                  <span v-if="p.note" class="text-text-muted italic">“{{ p.note }}”</span>
                  <span class="ml-auto" :class="p.confirmedAt ? 'font-semibold' : 'text-text-muted'">{{ p.confirmedAt ? `Referee confirmed ✓ ${monthDay(p.confirmedAt.slice(0, 10))}` : 'Waiting for the referee to confirm' }}</span>
                  <button v-if="p.canUndo" class="btn btn-ghost !py-0 text-xs" @click="undoing = p">Undo</button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Pay and mark as paid -->
    <Modal v-if="paying" :title="`Pay ${paying.s.name}`" wide @close="paying = null">
      <div class="space-y-4">
        <div v-if="!isProgram && !ctx.programId">
          <label class="label" for="pay-program">Which program is paying?</label>
          <select id="pay-program" v-model="paying.programId" class="input sm:!w-72" @change="selectAll">
            <option value="" disabled>Choose a program</option>
            <option v-for="[id, name] in payerChoices" :key="id" :value="id">{{ name }}</option>
          </select>
        </div>

        <template v-if="paying.programId">
          <fieldset class="min-w-0">
            <legend class="label">Games to pay for</legend>
            <ul class="rounded-lg border border-border divide-y divide-border max-h-56 overflow-y-auto">
              <li v-for="d in payItems" :key="d.id">
                <label class="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                  <input v-model="paying.selected" type="checkbox" :value="d.assignmentId" class="w-4 h-4 accent-[var(--color-accent)]" />
                  <span class="w-14 sm:w-20 shrink-0">{{ monthDay(d.date) }}</span>
                  <span class="flex-1 min-w-0 truncate">{{ d.matchup }}<span v-if="d.isSplit" class="text-text-muted"> · half</span></span>
                  <span class="tabular-nums">{{ money(d.outstandingCents) }}</span>
                </label>
              </li>
            </ul>
            <p class="text-sm font-semibold mt-2 text-right">Total {{ money(payTotal) }}</p>
          </fieldset>

          <section class="rounded-lg border border-border p-4">
            <h3 class="text-sm font-semibold">1. Pay</h3>
            <template v-if="venmo">
              <div class="flex flex-col sm:flex-row gap-4 mt-2 items-start">
                <div class="flex-1 min-w-0 text-sm space-y-2">
                  <p>Venmo: <strong>{{ venmo.display }}</strong></p>
                  <p v-if="venmo.recentlyChanged" class="text-xs rounded-md bg-pending text-black px-2 py-1">This username was updated {{ timestamp(venmo.updatedAt) }}. If you haven’t paid {{ paying.s.name.split(' ')[0] }} before, check it with them first.</p>
                  <a :href="venmoPayUrl" target="_blank" rel="noopener" class="btn btn-primary" :class="!payTotal && 'pointer-events-none opacity-50'">Open Venmo to pay {{ money(payTotal) }}</a>
                  <p class="text-xs text-text-muted">{{ onPhone ? 'Opens the Venmo app' : 'Or scan the code with your phone’s camera to pay in the Venmo app' }}, with the amount and a note filled in. Check the name and photo in Venmo before you send.</p>
                </div>
                <QrCode v-if="!onPhone && venmoPayUrl" :value="venmoPayUrl" :size="200" level="L" :label="`Venmo payment code for ${venmo.display}`" />
              </div>
            </template>
            <p v-else class="text-sm text-text-muted mt-1">{{ paying.s.name }} hasn’t added a Venmo username yet. Pay them the way your program usually does, then mark it as paid below.</p>
          </section>

          <section class="rounded-lg border border-border p-4">
            <h3 class="text-sm font-semibold">2. Mark as paid</h3>
            <p class="text-xs text-text-muted mb-3">After the money is sent. {{ paying.s.name.split(' ')[0] }} is emailed and asked to confirm it arrived.</p>
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <label class="label" for="pay-method">Paid with</label>
                <select id="pay-method" v-model="paying.method" class="input">
                  <option v-for="[k, label] in PAID_WITH" :key="k" :value="k">{{ label }}</option>
                </select>
              </div>
              <div>
                <label class="label" for="pay-date">Paid on</label>
                <input id="pay-date" v-model="paying.paidOn" type="date" class="input" :max="today" />
              </div>
              <div>
                <label class="label" for="pay-note">Note <span class="font-normal text-text-muted">(optional)</span></label>
                <input id="pay-note" v-model="paying.note" class="input" maxlength="300" placeholder="e.g. Check #1042" />
              </div>
            </div>
          </section>
        </template>
        <p v-if="payError" class="text-sm text-danger" role="alert">{{ payError }}</p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="paying = null">Cancel</button>
        <button class="btn btn-primary" :disabled="saving || !paying.programId || !paying.selected.length || !paying.paidOn" @click="markPaid">{{ saving ? 'Saving…' : `Mark ${money(payTotal)} as paid` }}</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="undoing" title="Undo this payment?" confirm-label="Undo payment" :busy="saving"
      :message="`This takes ${money(undoing.amountCents)} (${undoing.methodLabel}, ${monthDay(undoing.paidOn)}) back off the record, and those games show as unpaid again. It doesn’t move any money. The referee is emailed.`"
      @confirm="undo" @close="undoing = null" />
  </div>
</template>
