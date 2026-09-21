<script setup>
import { RouterLink } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { leagueTimeZoneLabel, monthDay, weekday, timestamp } from '../utils/format';
import GameRow from './GameRow.vue';

// Dashboard card: schedule status plus the next games that matter to this user.
defineProps({ schedule: { type: Object, required: true } });
const auth = useAuthStore();
const scopeLabel = () => (auth.user.role === 'league_coach' ? 'your teams' : auth.user.programId ? 'your program' : 'the league');
</script>

<template>
  <section class="card p-5">
    <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div>
        <h2 class="font-semibold">Upcoming games</h2>
        <p class="text-sm text-text-muted">
          <template v-if="schedule.published">{{ schedule.gameCount }} games for {{ scopeLabel() }} · published {{ timestamp(schedule.publishedAt) }} · All times {{ leagueTimeZoneLabel() }}</template>
          <template v-else-if="schedule.hasDraft">A draft schedule is ready for review. Nobody else can see it yet.</template>
          <template v-else>The season schedule hasn’t been published yet.</template>
        </p>
      </div>
      <div class="flex gap-2">
        <RouterLink v-if="schedule.openRequests" to="/requests" class="btn btn-secondary">{{ schedule.openRequests }} open request{{ schedule.openRequests === 1 ? '' : 's' }}</RouterLink>
        <RouterLink v-if="auth.isSuperAdmin && !schedule.published" to="/schedule/builder" class="btn btn-primary">{{ schedule.hasDraft ? 'Review draft' : 'Build the schedule' }}</RouterLink>
        <RouterLink v-else-if="schedule.published" to="/schedule" class="btn btn-secondary">Full schedule</RouterLink>
      </div>
    </div>
    <ul v-if="schedule.upcoming.length" class="divide-y divide-border">
      <li v-for="g in schedule.upcoming" :key="g.id" class="py-2.5 flex gap-4 items-center">
        <div class="w-12 text-center shrink-0">
          <p class="text-xs text-text-muted uppercase">{{ weekday(g.date) }}</p>
          <p class="text-sm font-semibold">{{ monthDay(g.date) }}</p>
        </div>
        <GameRow :game="g" class="flex-1" />
      </li>
    </ul>
    <p v-else-if="schedule.published" class="text-sm text-text-muted">No more games this season.</p>
  </section>
</template>
