<script setup>
import { timeRange } from '../utils/format';

// One game as a row. Used by the published schedule, the Schedule builder,
// and change-request cards so games look the same everywhere.
defineProps({
  game: { type: Object, required: true },
  highlightTeamIds: { type: Array, default: () => [] },
  showDivision: { type: Boolean, default: true },
  showTravel: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0" :class="game.status === 'cancelled' && 'opacity-60'">
    <div class="w-[8.5rem] shrink-0">
      <p v-if="game.startTime" class="text-sm font-semibold tabular-nums whitespace-nowrap">{{ timeRange(game.startTime, game.endTime) }}</p>
      <p v-else class="text-sm font-semibold text-warning">Not placed</p>
      <p v-if="showDivision" class="text-xs text-text-muted truncate">{{ game.divisionName }}</p>
    </div>
    <div class="flex-1 min-w-[13rem]">
      <p class="text-sm leading-snug" :class="game.status === 'cancelled' && 'line-through'">
        <span :class="highlightTeamIds.includes(game.homeTeamId) ? 'font-bold' : 'font-medium'">{{ game.homeTeamName }}</span>
        <!-- A final score takes the place of "vs"; the winning score is bold. -->
        <span v-if="game.hasScore" class="mx-1.5 tabular-nums whitespace-nowrap" :aria-label="`final score ${game.homeScore} to ${game.awayScore}`">
          <span :class="game.homeScore > game.awayScore ? 'font-bold' : 'text-text-muted'">{{ game.homeScore }}</span>
          <span class="text-text-muted"> – </span>
          <span :class="game.awayScore > game.homeScore ? 'font-bold' : 'text-text-muted'">{{ game.awayScore }}</span>
        </span>
        <span v-else class="text-text-muted text-xs font-semibold mx-1.5">vs</span>
        <span :class="highlightTeamIds.includes(game.awayTeamId) ? 'font-bold' : 'font-medium'">{{ game.awayTeamName }}</span>
      </p>
      <p class="text-xs text-text-muted truncate">
        <template v-if="game.venueName">{{ game.venueName }} – {{ game.courtName }}</template>
        <template v-else>{{ game.note || 'Waiting to be placed' }}</template>
        <template v-if="showTravel && game.travelMiles != null"> · {{ game.awayTeamName.split(' ')[0] }} travels {{ game.travelMiles }} mi</template>
      </p>
    </div>
    <div v-if="!compact" class="flex flex-wrap items-center gap-1.5">
      <span v-if="game.hasScore" class="badge badge-outline" :title="game.scoreEnteredByName ? `Entered by ${game.scoreEnteredByName}` : undefined">Final{{ game.scoreNote ? ` · ${game.scoreNote}` : '' }}</span>
      <span v-if="game.status === 'cancelled'" class="badge badge-outline">Cancelled</span>
      <span v-if="game.hasBlackoutConflict" class="badge bg-unavailable text-white" :title="game.blackoutReason">Blackout conflict</span>
      <span v-if="game.hasOpenRequest" class="badge bg-pending text-black">Change requested</span>
      <slot name="actions" />
    </div>
  </div>
</template>
