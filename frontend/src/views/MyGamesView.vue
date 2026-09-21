<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { dateRange, leagueTimeZoneLabel, longDate, money, monthDay, timeRange, todayISO, weekday } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';

const toast = useToast();
const data = ref(null);
const loading = ref(true);
const unavailable = ref([]);

async function load() {
  try {
    const [a, u] = await Promise.all([api.get('/referees/me/assignments'), api.get('/referees/me/unavailability')]);
    data.value = a.data;
    unavailable.value = u.data.unavailable;
  } catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);

const today = computed(() => data.value?.today || todayISO());
const upcoming = computed(() => (data.value?.assignments || []).filter((a) => a.game.date >= today.value && a.game.status === 'scheduled'));
const past = computed(() => (data.value?.assignments || []).filter((a) => a.game.date < today.value).reverse());
// Only the soonest open check-in gets the big card; any others keep their
// small Check in button in the list below.
const readyNow = computed(() => upcoming.value.filter((a) => a.canCheckIn).slice(0, 1));
const earned = computed(() => past.value.concat(upcoming.value).filter((a) => a.status === 'checked_in').reduce((n, a) => n + (a.payCents || 0), 0));

const directions = (g) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([g.venueName, g.venueAddress, g.venueCity].filter(Boolean).join(', '))}`;

// ---- check-in: location is optional; the check-in still works without it ----
const checkingIn = ref('');
function position() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}
async function checkIn(a) {
  checkingIn.value = a.id;
  try {
    const c = await position();
    const { data: r } = await api.post(`/referees/me/assignments/${a.id}/check-in`, c ? { latitude: c.latitude, longitude: c.longitude } : {});
    toast.success(r.distanceMiles == null ? 'Checked in.' : r.distanceMiles < 0.1 ? 'Checked in. You’re right at the gym.' : `Checked in. You’re ${r.distanceMiles} mi from the gym.`);
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { checkingIn.value = ''; }
}

// ---- decline ----
const declining = ref(null);
const declineReason = ref('');
const busy = ref(false);
async function decline() {
  busy.value = true;
  try {
    await api.post(`/referees/me/assignments/${declining.value.id}/decline`, { reason: declineReason.value.trim() });
    toast.success('Declined. The assignor has been told.');
    declining.value = null;
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}

// ---- unavailable dates ----
const offForm = ref(null);
async function addOff() {
  busy.value = true;
  try {
    const { data: r } = await api.post('/referees/me/unavailability', offForm.value);
    toast.success(r.stillAssigned
      ? `Saved. You’re still on ${r.stillAssigned} game${r.stillAssigned === 1 ? '' : 's'} in those dates. Decline them below, or the assignor will follow up.`
      : 'Saved. You won’t be assigned on those dates.');
    offForm.value = null;
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}
async function removeOff(u) {
  try { await api.delete(`/referees/me/unavailability/${u.id}`); await load(); }
  catch (err) { toast.error(errorMessage(err)); }
}
const STATUS = { checked_in: 'Worked', no_show: 'No-show', assigned: 'Not confirmed' };
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader title="My games" :subtitle="data ? `${upcoming.length} upcoming · ${money(earned)} earned this season · All times ${leagueTimeZoneLabel()}` : ''" />
    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>

    <template v-else-if="data">
      <!-- Check in now -->
      <section v-for="a in readyNow" :key="`now-${a.id}`" class="card p-5 mb-4 border-2 !border-accent">
        <p class="text-xs font-semibold uppercase tracking-wide">Check-in is open</p>
        <p class="text-lg font-bold mt-1">{{ timeRange(a.game.startTime, a.game.endTime) }} · {{ a.game.venueName }}</p>
        <p class="text-sm">{{ a.game.homeTeamName }} vs {{ a.game.awayTeamName }} · {{ a.game.courtName }}</p>
        <button class="btn btn-primary w-full mt-4 !py-3 text-base" :disabled="checkingIn === a.id" @click="checkIn(a)">{{ checkingIn === a.id ? 'Checking in…' : 'I’m here: check in' }}</button>
        <p class="text-xs text-text-muted mt-2">Your phone may ask to share your location. That confirms you’re at the gym, but check-in works without it.</p>
      </section>

      <h2 class="font-semibold mb-2">Upcoming</h2>
      <EmptyState v-if="!upcoming.length" title="No upcoming games" body="When the assignor puts you on a game, it shows up here and you get an email." />
      <ul v-else class="space-y-3 mb-6">
        <li v-for="a in upcoming" :key="a.id" class="card card-blocky p-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs text-text-muted">{{ longDate(a.game.date) }}</p>
              <p class="font-semibold">{{ timeRange(a.game.startTime, a.game.endTime) }} · {{ a.game.divisionName }}</p>
              <p class="text-sm">{{ a.game.homeTeamName }} vs {{ a.game.awayTeamName }}</p>
              <p class="text-sm text-text-muted">{{ a.game.venueName }} – {{ a.game.courtName }} · <a :href="directions(a.game)" target="_blank" rel="noopener" class="underline">Directions</a></p>
              <p class="text-xs text-text-muted mt-1">Working with: {{ a.partners.join(', ') || 'nobody else' }}</p>
            </div>
            <span v-if="a.status === 'checked_in'" class="badge bg-success text-black">Checked in</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-3">
            <button v-if="a.canCheckIn" class="btn btn-primary" :disabled="checkingIn === a.id" @click="checkIn(a)">Check in</button>
            <p v-else-if="a.checkInNote && a.status === 'assigned'" class="text-xs text-text-muted flex-1">{{ a.checkInNote }}</p>
            <button v-if="a.canDecline" class="btn btn-ghost ml-auto" @click="declining = a; declineReason = ''">Can’t make it</button>
          </div>
        </li>
      </ul>

      <section class="mb-6">
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-semibold">Dates I can’t work</h2>
          <button class="btn btn-secondary !py-1 text-sm" @click="offForm = { startDate: today, endDate: today, note: '' }">Add dates</button>
        </div>
        <p v-if="!unavailable.length" class="text-sm text-text-muted">None. The assignor may put you on any game.</p>
        <ul v-else class="card card-blocky divide-y divide-border">
          <li v-for="u in unavailable" :key="u.id" class="px-4 py-2.5 flex items-center gap-3 text-sm">
            <span class="font-medium">{{ dateRange(u.startDate, u.endDate) }}</span>
            <span class="text-text-muted flex-1 truncate">{{ u.note }}</span>
            <button class="btn btn-ghost text-xs" @click="removeOff(u)">Remove</button>
          </li>
        </ul>
      </section>

      <section v-if="past.length">
        <h2 class="font-semibold mb-2">Past games</h2>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="a in past" :key="a.id" class="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span class="w-24 font-medium">{{ weekday(a.game.date) }} {{ monthDay(a.game.date) }}</span>
            <span class="flex-1 min-w-[12rem]">{{ a.game.homeTeamName }} vs {{ a.game.awayTeamName }}</span>
            <span class="text-xs" :class="a.status === 'assigned' && 'text-text-muted'">{{ STATUS[a.status] }}</span>
            <span class="tabular-nums w-16 text-right">{{ a.status === 'checked_in' ? money(a.payCents) : '—' }}</span>
          </li>
        </ul>
      </section>
    </template>

    <Modal v-if="declining" title="Can’t make this game?" @close="declining = null">
      <p class="text-sm mb-3">{{ longDate(declining.game.date) }}, {{ timeRange(declining.game.startTime, declining.game.endTime) }}: {{ declining.game.homeTeamName }} vs {{ declining.game.awayTeamName }}. The assignor will find someone else.</p>
      <label class="label" for="dec-reason">Reason</label>
      <input id="dec-reason" v-model="declineReason" class="input" maxlength="200" placeholder="e.g. Work shift moved" />
      <template #footer>
        <button class="btn btn-secondary" @click="declining = null">Keep it</button>
        <button class="btn btn-danger" :disabled="declineReason.trim().length < 3 || busy" @click="decline">Decline game</button>
      </template>
    </Modal>

    <Modal v-if="offForm" title="Dates I can’t work" @close="offForm = null">
      <form id="off-form" class="space-y-4" @submit.prevent="addOff">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="off-start">First day</label><input id="off-start" v-model="offForm.startDate" type="date" class="input" :min="today" required /></div>
          <div><label class="label" for="off-end">Last day</label><input id="off-end" v-model="offForm.endDate" type="date" class="input" :min="offForm.startDate" required /></div>
        </div>
        <div><label class="label" for="off-note">Note <span class="font-normal text-text-muted">(optional)</span></label><input id="off-note" v-model="offForm.note" class="input" maxlength="120" placeholder="e.g. Out of town" /></div>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="offForm = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="off-form" :disabled="busy">Save</button>
      </template>
    </Modal>
  </div>
</template>
