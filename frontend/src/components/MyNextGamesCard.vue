<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api/client';
import { longDate, timeRange } from '../utils/format';
// Dashboard for referees: the next few games, with a check-in prompt when one is open.
const data = ref(null);
onMounted(async () => { try { data.value = (await api.get('/referees/me/assignments')).data; } catch { data.value = { assignments: [] }; } });
const upcoming = computed(() => (data.value?.assignments || []).filter((a) => a.game.date >= data.value.today && a.game.status === 'scheduled'));
const checkInNow = computed(() => upcoming.value.find((a) => a.canCheckIn));
</script>

<template>
  <section class="card p-5">
    <div class="flex items-start justify-between gap-2 mb-3">
      <h2 class="font-semibold">Your next games</h2>
      <RouterLink to="/my-games" class="btn btn-secondary">All my games</RouterLink>
    </div>
    <RouterLink v-if="checkInNow" to="/my-games" class="btn btn-primary w-full mb-3 !py-3">Check-in is open: {{ checkInNow.game.venueName }}</RouterLink>
    <p v-if="!data" class="text-sm text-text-muted">Loading…</p>
    <p v-else-if="!upcoming.length" class="text-sm text-text-muted">You’re not on any upcoming games yet. You’ll get an email when the assignor adds you.</p>
    <ul v-else class="divide-y divide-border">
      <li v-for="a in upcoming.slice(0, 4)" :key="a.id" class="py-2.5 text-sm">
        <p class="font-medium">{{ longDate(a.game.date) }} · {{ timeRange(a.game.startTime, a.game.endTime) }}</p>
        <p class="text-text-muted">{{ a.game.homeTeamName }} vs {{ a.game.awayTeamName }} · {{ a.game.venueName }}</p>
      </li>
    </ul>
  </section>
</template>
