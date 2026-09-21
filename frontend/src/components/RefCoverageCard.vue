<script setup>
import { RouterLink } from 'vue-router';
// Dashboard: how well upcoming games are covered by referees.
defineProps({ referees: { type: Object, required: true } });
</script>

<template>
  <section class="card p-5">
    <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div>
        <h2 class="font-semibold">Referee coverage</h2>
        <p class="text-sm text-text-muted">{{ referees.roster }} active referee{{ referees.roster === 1 ? '' : 's' }} on the roster</p>
      </div>
      <div class="flex gap-2">
        <RouterLink to="/referees" class="btn btn-secondary">Roster</RouterLink>
        <RouterLink v-if="referees.published" to="/assignments" class="btn btn-primary">Assign referees</RouterLink>
      </div>
    </div>
    <p v-if="!referees.published" class="text-sm text-text-muted">Once the league publishes the schedule, every game gets referee slots to fill here.</p>
    <dl v-else class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="rounded-lg border border-border p-3"><dt class="text-xs text-text-muted">Upcoming slots</dt><dd class="text-xl font-bold">{{ referees.slots }}</dd></div>
      <div class="rounded-lg border border-border p-3"><dt class="text-xs text-text-muted">Still open</dt><dd class="text-xl font-bold">{{ referees.open }}</dd></div>
      <div class="rounded-lg border p-3" :class="referees.openSoon ? 'border-warning border-2' : 'border-border'"><dt class="text-xs text-text-muted">Open in the next 14 days</dt><dd class="text-xl font-bold">{{ referees.openSoon }}</dd></div>
      <div class="rounded-lg border p-3" :class="referees.unconfirmed ? 'border-warning border-2' : 'border-border'">
        <dt class="text-xs text-text-muted">Played, not confirmed</dt><dd class="text-xl font-bold">{{ referees.unconfirmed }}</dd>
        <RouterLink v-if="referees.unconfirmed" to="/assignments" class="text-xs underline">Confirm before payouts</RouterLink>
      </div>
    </dl>
  </section>
</template>
