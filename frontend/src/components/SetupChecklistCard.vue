<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
// Dashboard for Program Directors: what the league needs from them before
// the schedule can be built. Disappears once everything is done.
const props = defineProps({ setup: { type: Object, required: true } });
const items = computed(() => [
  { done: props.setup.venues > 0, label: 'Add your gyms', detail: 'Venues and their courts.', to: '/venues' },
  { done: props.setup.venues > 0 && props.setup.venuesMissingCoords === 0, label: 'Add map coordinates to every gym',
    detail: props.setup.venuesMissingCoords ? `${props.setup.venuesMissingCoords} gym${props.setup.venuesMissingCoords === 1 ? ' is' : 's are'} missing them. The scheduler uses them to keep travel reasonable.` : 'Used to keep travel reasonable.', to: '/venues' },
  { done: props.setup.teams > 0, label: 'Add your teams', detail: 'One per division you’re entering.', to: '/teams' },
  { done: props.setup.teams > 0 && props.setup.teamsWithoutCoach === 0, label: 'Assign a coach to each team',
    detail: props.setup.teamsWithoutCoach ? `${props.setup.teamsWithoutCoach} team${props.setup.teamsWithoutCoach === 1 ? ' has' : 's have'} no coach yet. Pick one on the Teams page; if your coach has no account yet, ask the league admin to create one.` : 'Coaches see their schedule and can request changes.', to: '/teams' },
  { done: props.setup.gameSlots > 0, label: 'Enter weeknight and weekend game slots', detail: 'The scheduler only uses these for games.', to: '/slots' },
  { done: props.setup.blackouts > 0, label: 'Mark blackout dates', detail: 'Holidays and building closures.', to: '/blackouts' },
]);
const remaining = computed(() => items.value.filter((i) => !i.done).length);
</script>

<template>
  <section v-if="remaining" class="card p-5">
    <h2 class="font-semibold">Get your program ready</h2>
    <p class="text-sm text-text-muted mb-3">{{ items.length - remaining }} of {{ items.length }} done. The league builds the schedule from what you enter here.</p>
    <ol class="space-y-2">
      <li v-for="i in items" :key="i.label" class="flex gap-3 items-start">
        <span class="w-5 h-5 rounded-full grid place-items-center text-xs font-bold shrink-0 mt-0.5" :class="i.done ? 'bg-success text-black' : 'border-2 border-border'" :aria-label="i.done ? 'Done' : 'To do'">{{ i.done ? '✓' : '' }}</span>
        <span class="text-sm min-w-0">
          <RouterLink v-if="!i.done" :to="i.to" class="font-medium underline">{{ i.label }}</RouterLink>
          <span v-else class="font-medium text-text-muted line-through">{{ i.label }}</span>
          <span class="block text-xs text-text-muted">{{ i.detail }}</span>
        </span>
      </li>
    </ol>
  </section>
</template>
