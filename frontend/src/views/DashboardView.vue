<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import UpcomingGamesCard from '../components/UpcomingGamesCard.vue';
import { CATEGORY, dateRange, todayISO } from '../utils/format';

const auth = useAuthStore();
const data = ref(null);
const error = ref('');

onMounted(async () => {
  try { data.value = (await api.get('/dashboard')).data; }
  catch (err) { error.value = errorMessage(err); }
});

const seasonStatus = computed(() => {
  const s = data.value?.season;
  if (!s) return '';
  const today = todayISO();
  const day = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
  if (today < s.startDate) return `Starts in ${day(today, s.startDate)} days`;
  if (today > s.endDate) return 'Season ended';
  const week = Math.floor(day(s.startDate, today) / 7) + 1;
  const total = Math.ceil((day(s.startDate, s.endDate) + 1) / 7);
  return `Week ${week} of ${total}`;
});

const categoryRows = computed(() => {
  const rows = Object.entries(CATEGORY).map(([key, c]) => {
    const r = data.value?.slotsByCategory?.find((x) => x.category === key);
    return { key, ...c, slots: Number(r?.n || 0), hours: Math.round(Number(r?.hours || 0)) };
  });
  const max = Math.max(1, ...rows.map((r) => r.hours));
  return rows.map((r) => ({ ...r, pct: (r.hours / max) * 100 }));
});
const totalSlots = computed(() => categoryRows.value.reduce((a, r) => a + r.slots, 0));

const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
});
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-2xl font-bold tracking-tight">{{ greeting }}, {{ auth.user?.firstName }}</h1>
      <p class="text-sm text-text-muted mt-1">
        {{ auth.roleLabel }}<template v-if="auth.user?.programName"> for {{ auth.user.programName }}</template>
      </p>
    </div>

    <p v-if="error" class="text-danger text-sm">{{ error }}</p>

    <template v-else-if="data">
      <!-- Season banner -->
      <section class="card card-blocky px-5 py-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-l-4 border-l-accent">
        <template v-if="data.season">
          <div>
            <p class="text-xs text-text-muted">Active season</p>
            <p class="text-lg font-semibold">{{ data.season.name }}</p>
          </div>
          <p class="text-sm">{{ dateRange(data.season.startDate, data.season.endDate) }}</p>
          <p class="text-sm font-medium text-accent">{{ seasonStatus }}</p>
        </template>
        <template v-else>
          <div class="flex-1">
            <p class="font-semibold">No active season yet</p>
            <p class="text-sm text-text-muted">
              {{ auth.isSuperAdmin ? 'Create the season first — gym slots must fall inside its dates.' : 'Your league administrator hasn’t opened the season yet. Gym slots can be added once they do.' }}
            </p>
          </div>
          <RouterLink v-if="auth.isSuperAdmin" to="/league" class="btn btn-primary">Set up the season</RouterLink>
        </template>
      </section>

      <!-- Managers -->
      <UpcomingGamesCard v-if="data.schedule && (data.schedule.published || auth.isSuperAdmin)" :schedule="data.schedule" class="mb-6" />

      <div v-if="auth.canManage" class="grid grid-cols-1 gap-6 lg:grid-cols-5 [&>*]:min-w-0">
        <section class="card p-5 lg:col-span-3">
          <div class="flex items-baseline justify-between mb-4">
            <h2 class="font-semibold">Gym time entered this season</h2>
            <RouterLink to="/slots" class="text-sm text-accent font-medium hover:underline">Open gym slots</RouterLink>
          </div>
          <div v-if="totalSlots" class="space-y-4">
            <div v-for="r in categoryRows" :key="r.key">
              <div class="flex justify-between text-sm mb-1.5">
                <span class="font-medium">{{ r.label }}</span>
                <span class="text-text-muted">{{ r.slots }} slots · {{ r.hours }} hrs</span>
              </div>
              <div class="h-3 rounded-sm bg-background overflow-hidden border border-border">
                <div class="h-full" :class="r.cls" :style="{ width: `${r.pct}%` }" />
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-text-muted">
            No gym slots yet. {{ data.season ? 'Add venues, then enter the gym time each one has available.' : '' }}
          </p>
          <dl class="grid grid-cols-3 gap-3 mt-6 pt-4 border-t border-border text-center">
            <div><dt class="text-xs text-text-muted">Venues</dt><dd class="text-lg font-semibold">{{ data.counts.venues }}</dd></div>
            <div><dt class="text-xs text-text-muted">Teams</dt><dd class="text-lg font-semibold">{{ data.counts.teams }}</dd></div>
            <div v-if="auth.isSuperAdmin"><dt class="text-xs text-text-muted">Programs</dt><dd class="text-lg font-semibold">{{ data.counts.programs }} <span class="text-sm font-normal text-text-muted">/ {{ data.maxPrograms }}</span></dd></div>
            <div v-else><dt class="text-xs text-text-muted">Divisions</dt><dd class="text-lg font-semibold">{{ data.counts.divisions }}</dd></div>
          </dl>
        </section>

        <section class="card p-5 lg:col-span-2">
          <div class="flex items-baseline justify-between mb-3">
            <h2 class="font-semibold">Upcoming blackouts</h2>
            <RouterLink to="/blackouts" class="text-sm text-accent font-medium hover:underline">Manage</RouterLink>
          </div>
          <ul v-if="data.upcomingBlackouts.length" class="divide-y divide-border">
            <li v-for="b in data.upcomingBlackouts" :key="b.id" class="py-2.5 flex gap-3 items-start">
              <span class="mt-1 w-2.5 h-2.5 rounded-sm bg-unavailable shrink-0" />
              <div class="min-w-0">
                <p class="text-sm font-medium">{{ b.reason }}</p>
                <p class="text-xs text-text-muted">{{ dateRange(b.startDate, b.endDate) }} · {{ b.venueName || 'All venues' }}<template v-if="auth.isSuperAdmin"> · {{ b.shortCode }}</template></p>
              </div>
            </li>
          </ul>
          <p v-else class="text-sm text-text-muted">None scheduled.</p>
        </section>

        <section v-if="auth.isSuperAdmin && data.programReadiness.length" class="card p-5 lg:col-span-5">
          <h2 class="font-semibold">Program setup</h2>
          <p class="text-sm text-text-muted mb-4">What each program has entered so far for {{ data.season?.name }}.</p>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-text-muted">
                <tr class="border-b border-border">
                  <th class="py-2 pr-4 font-medium">Program</th>
                  <th class="py-2 px-3 font-medium">Director</th>
                  <th class="py-2 px-3 font-medium text-right">Venues</th>
                  <th class="py-2 px-3 font-medium text-right">Teams</th>
                  <th class="py-2 pl-3 font-medium text-right">Gym slots</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in data.programReadiness" :key="p.id" class="border-b border-border last:border-0">
                  <td class="py-2 pr-4"><span class="font-medium">{{ p.name }}</span> <span class="text-text-muted">{{ p.shortCode }}</span></td>
                  <td class="py-2 px-3">
                    <span v-if="p.directors > 0" class="text-success font-medium">Assigned</span>
                    <RouterLink v-else to="/users" class="text-warning font-medium hover:underline">Needs one</RouterLink>
                  </td>
                  <td class="py-2 px-3 text-right" :class="!p.venues && 'text-text-muted'">{{ p.venues }}</td>
                  <td class="py-2 px-3 text-right" :class="!p.teams && 'text-text-muted'">{{ p.teams }}</td>
                  <td class="py-2 pl-3 text-right" :class="!p.slots && 'text-text-muted'">{{ p.slots }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- Coaches and officials -->
      <section v-else-if="!data.schedule?.published" class="card p-6 max-w-2xl">
        <template v-if="auth.user.role === 'league_coach'">
          <h2 class="font-semibold">Your program</h2>
          <p class="text-sm text-text-muted mt-1">Your game schedule will appear here once the league publishes it. Until then you can look up your program’s teams and venues.</p>
          <div class="flex gap-2 mt-4">
            <RouterLink to="/teams" class="btn btn-primary">View teams</RouterLink>
            <RouterLink to="/venues" class="btn btn-secondary">View venues</RouterLink>
          </div>
        </template>
        <template v-else>
          <h2 class="font-semibold">Referee assignments</h2>
          <p class="text-sm text-text-muted mt-1">
            {{ auth.user.role === 'referee_assignor'
              ? 'Once the league schedule is published, you’ll assign officials to games from here.'
              : 'Once the league schedule is published, your game assignments and check-in will appear here.' }}
          </p>
        </template>
      </section>
    </template>

    <div v-else class="text-sm text-text-muted">Loading…</div>
  </div>
</template>
