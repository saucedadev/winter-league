<script setup>
import { onMounted, ref } from 'vue';
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
      :subtitle="auth.user?.role === 'program_director'
        ? 'Referees who worked your program’s games, and what each is owed for them. Export the CSV to check or share; no money moves through this app.'
        : 'Games worked and what each referee is owed. Export the CSV and pay from your usual system; no money moves through this app.'" />

    <div class="card card-blocky p-4 mb-4 flex flex-wrap items-end gap-3">
      <div><label class="label" for="po-from">From</label><input id="po-from" v-model="from" type="date" class="input" /></div>
      <div><label class="label" for="po-to">To</label><input id="po-to" v-model="to" type="date" class="input" :min="from" /></div>
      <button class="btn btn-secondary" :disabled="loading" @click="load">{{ loading ? 'Loading…' : 'Update' }}</button>
      <div class="flex gap-2 ml-auto">
        <button class="btn btn-secondary" :disabled="!data?.totals.games || !!downloading" @click="download('detail')">{{ downloading === 'detail' ? 'Preparing…' : 'Download game detail (CSV)' }}</button>
        <button class="btn btn-primary" :disabled="!data?.totals.games || !!downloading" @click="download('summary')">{{ downloading === 'summary' ? 'Preparing…' : 'Download summary (CSV)' }}</button>
      </div>
    </div>

    <template v-if="data">
      <div v-if="data.unconfirmed" class="card card-blocky p-4 mb-4 flex gap-3 items-start border-l-4 !border-l-warning">
        <p class="text-sm"><span class="font-semibold">{{ data.unconfirmed }} assigned referee{{ data.unconfirmed === 1 ? '' : 's' }} in this range never checked in.</span>
          They aren’t included below. Confirm who worked on the <RouterLink to="/assignments" class="underline">Assignments</RouterLink> page (Mark as worked or Mark no-show) before paying.</p>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Referees</p><p class="text-2xl font-bold">{{ data.totals.referees }}</p></div>
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Games worked</p><p class="text-2xl font-bold">{{ data.totals.games }}</p><p v-if="data.scope === 'program'" class="text-xs text-text-muted">in your program’s games</p></div>
        <div class="card card-blocky p-4"><p class="text-xs text-text-muted">Total owed</p><p class="text-2xl font-bold">{{ money(data.totals.totalCents) }}</p></div>
      </div>

      <EmptyState v-if="!data.summary.length" title="Nothing to pay for these dates" :body="`No referee checked in to a game between ${dateRange(from, to)}.`" />
      <div v-else class="card card-blocky divide-y divide-border">
        <div v-for="s in data.summary" :key="s.refereeId">
          <button class="w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-background" :aria-expanded="expanded === s.refereeId" @click="expanded = expanded === s.refereeId ? null : s.refereeId">
            <span class="flex-1 min-w-0"><span class="font-medium">{{ s.name }}</span><span class="block text-xs text-text-muted">{{ s.email }}</span></span>
            <span class="text-sm tabular-nums">{{ s.games }} game{{ s.games === 1 ? '' : 's' }}</span>
            <span class="text-sm font-semibold tabular-nums w-20 text-right">{{ money(s.totalCents) }}</span>
            <span class="text-text-muted text-xs w-4" aria-hidden="true">{{ expanded === s.refereeId ? '▾' : '▸' }}</span>
          </button>
          <ul v-if="expanded === s.refereeId" class="px-4 pb-3 space-y-1">
            <li v-for="d in detailFor(s.refereeId)" :key="d.id" class="text-xs flex flex-wrap gap-x-3">
              <span class="w-24 font-medium">{{ monthDay(d.date) }}, {{ time12(d.startTime) }}</span>
              <span class="flex-1 min-w-[12rem]">{{ d.matchup }} · {{ d.divisionName }} · {{ d.venueName }}</span>
              <span class="text-text-muted">{{ d.checkInMethod === 'referee' ? 'checked in' : 'confirmed by assignor' }}</span>
              <span class="tabular-nums w-16 text-right">{{ money(d.amountCents) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
