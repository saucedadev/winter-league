<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { useAuthStore } from '../stores/auth';
import { dateRange, money, monthDay, time12, todayISO, addDays } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const toast = useToast();
const auth = useAuthStore();
const today = todayISO();
const from = ref(addDays(today, -13));
const to = ref(today);
const data = ref(null);
const loading = ref(false);
const expanded = ref(null);
const isProgram = computed(() => auth.user?.role === 'program_director');

async function load() {
  if (!from.value || !to.value) return;
  loading.value = true;
  try { data.value = (await api.get('/referees/payouts', { params: { from: from.value, to: to.value } })).data; }
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

// The file is fetched with the sign-in token, then handed to the browser to save.
const downloading = ref('');
async function download(type) {
  downloading.value = type;
  try {
    const res = await api.get('/referees/payouts', { params: { from: from.value, to: to.value, format: 'csv', type }, responseType: 'blob' });
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
const detailFor = (id) => data.value.detail.filter((d) => d.refereeId === id);
</script>

<template>
  <div>
    <PageHeader title="Referee payouts"
      :subtitle="isProgram
        ? 'The referees your program pays, and what each is owed. Each program pays one referee per game. No money moves through this app.'
        : 'Games worked, what each referee is owed, and which program pays them. No money moves through this app.'" />

    <div class="card card-blocky p-4 mb-4 flex flex-wrap items-end gap-3">
      <div><label class="label" for="po-from">From</label><input id="po-from" v-model="from" type="date" class="input" /></div>
      <div><label class="label" for="po-to">To</label><input id="po-to" v-model="to" type="date" class="input" :min="from" /></div>
      <button class="btn btn-secondary" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Update' }}</button>
      <div class="flex flex-wrap gap-2 ml-auto">
        <button v-if="!isProgram" class="btn btn-secondary" :disabled="!data?.totals.games || !!downloading" @click="download('programs')">{{ downloading === 'programs' ? 'Preparing…' : 'Download by program (CSV)' }}</button>
        <button class="btn btn-secondary" :disabled="!data?.totals.games || !!downloading" @click="download('detail')">{{ downloading === 'detail' ? 'Preparing…' : 'Download game detail (CSV)' }}</button>
        <button class="btn btn-primary" :disabled="!data?.totals.games || !!downloading" @click="download('summary')">{{ downloading === 'summary' ? 'Preparing…' : 'Download summary (CSV)' }}</button>
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
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">{{ isProgram ? 'Referees you pay' : 'Referees' }}</p><p class="text-2xl font-bold">{{ data.totals.referees }}</p></div>
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">{{ isProgram ? 'Games to pay for' : 'Games worked' }}</p><p class="text-2xl font-bold">{{ data.totals.games }}</p></div>
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">{{ isProgram ? 'Your program owes' : 'Total owed' }}</p><p class="text-2xl font-bold">{{ money(data.totals.totalCents) }}</p></div>
      </div>

      <section v-if="!isProgram && data.programs.length" class="card card-blocky mb-4">
        <h2 class="px-4 pt-3 text-sm font-semibold">What each program owes</h2>
        <table class="w-full text-sm mt-1">
          <thead class="text-xs text-text-muted text-left"><tr><th class="px-4 py-1.5 font-medium">Program</th><th class="px-4 py-1.5 font-medium text-right">Referee payments</th><th class="px-4 py-1.5 font-medium text-right">Total</th></tr></thead>
          <tbody class="divide-y divide-border">
            <tr v-for="p in data.programs" :key="p.programId"><td class="px-4 py-1.5">{{ p.name }}</td><td class="px-4 py-1.5 text-right tabular-nums">{{ p.payments }}</td><td class="px-4 py-1.5 text-right tabular-nums font-medium">{{ money(p.totalCents) }}</td></tr>
          </tbody>
        </table>
      </section>

      <EmptyState v-if="!data.summary.length" title="Nothing to pay for these dates" :body="isProgram ? `Your program has no referees to pay for games between ${dateRange(from, to)}.` : `No referee checked in to a game between ${dateRange(from, to)}.`" />
      <div v-else class="card card-blocky divide-y divide-border">
        <div v-for="s in data.summary" :key="s.refereeId">
          <button class="w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-background" :aria-expanded="expanded === s.refereeId" @click="expanded = expanded === s.refereeId ? null : s.refereeId">
            <span class="flex-1 min-w-0"><span class="font-medium">{{ s.name }}</span><span class="block text-xs text-text-muted">{{ s.email }}</span></span>
            <span class="text-sm tabular-nums">{{ s.games }} game{{ s.games === 1 ? '' : 's' }}</span>
            <span class="text-sm font-semibold tabular-nums w-20 text-right">{{ money(s.totalCents) }}</span>
            <span class="text-text-muted text-xs w-4" aria-hidden="true">{{ expanded === s.refereeId ? '▾' : '▸' }}</span>
          </button>
          <ul v-if="expanded === s.refereeId" class="px-4 pb-3 space-y-2">
            <li v-for="d in detailFor(s.refereeId)" :key="d.id" class="text-xs">
              <div class="flex flex-wrap gap-x-3">
                <span class="w-24 font-medium">{{ monthDay(d.date) }}, {{ time12(d.startTime) }}</span>
                <span class="flex-1 min-w-[12rem]">{{ d.matchup }} · {{ d.divisionName }} · {{ d.venueName }}</span>
                <span class="text-text-muted">{{ d.checkInMethod === 'referee' ? 'checked in' : 'confirmed by assignor' }}</span>
                <span class="tabular-nums w-16 text-right">{{ money(d.amountCents) }}</span>
              </div>
              <p class="text-text-muted sm:pl-[6.75rem]">
                <template v-if="!isProgram">Paid by {{ d.paidByName }}<template v-if="d.isSplit"> (half of {{ money(d.fullCents) }})</template>.</template>
                <template v-else-if="d.isSplit">Half of {{ money(d.fullCents) }}: the only referee on this game. {{ d.splitWith }} pays the other half.</template>
                <template v-for="o in d.others" :key="o.position"> Referee {{ o.position }}, {{ o.name }}: paid by {{ o.paidBy }}.</template>
              </p>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
