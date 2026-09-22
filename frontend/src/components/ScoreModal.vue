<script setup>
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { longDate, timeRange, timestamp } from '../utils/format';
import Modal from './Modal.vue';

// Enter or correct a game's final score.
const props = defineProps({ game: { type: Object, required: true } });
const emit = defineEmits(['close', 'saved']);
const toast = useToast();

const home = ref(props.game.hasScore ? String(props.game.homeScore) : '');
const away = ref(props.game.hasScore ? String(props.game.awayScore) : '');
const note = ref(props.game.scoreNote || '');
const saving = ref(false);
const error = ref('');
const confirmClear = ref(false);

const valid = (v) => /^\d{1,3}$/.test(String(v).trim()) && Number(v) <= 250;
const canSave = computed(() => valid(home.value) && valid(away.value));

async function save() {
  error.value = '';
  saving.value = true;
  try {
    const { data } = await api.put(`/schedule/games/${props.game.id}/score`, { homeScore: Number(home.value), awayScore: Number(away.value), note: note.value.trim() });
    toast.success(props.game.hasScore ? 'Score corrected. The other team has been told.' : 'Final score saved. The other team has been told.');
    emit('saved', data.game);
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
async function clear() {
  saving.value = true;
  try {
    const { data } = await api.delete(`/schedule/games/${props.game.id}/score`);
    toast.success('Score cleared.');
    emit('saved', data.game);
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
</script>

<template>
  <Modal :title="game.hasScore ? 'Edit final score' : 'Enter final score'" @close="emit('close')">
    <form id="score-form" class="space-y-4" @submit.prevent="save">
      <p class="text-sm text-text-muted">{{ longDate(game.date) }} · {{ timeRange(game.startTime, game.endTime) }} · {{ game.venueName }}</p>
      <div class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-3 items-center">
        <label for="score-home" class="text-sm font-medium">{{ game.homeTeamName }} <span class="text-xs text-text-muted font-normal">(home)</span></label>
        <input id="score-home" v-model="home" inputmode="numeric" pattern="[0-9]*" maxlength="3" class="input !w-20 text-center text-lg font-semibold tabular-nums" required />
        <label for="score-away" class="text-sm font-medium">{{ game.awayTeamName }} <span class="text-xs text-text-muted font-normal">(away)</span></label>
        <input id="score-away" v-model="away" inputmode="numeric" pattern="[0-9]*" maxlength="3" class="input !w-20 text-center text-lg font-semibold tabular-nums" required />
      </div>
      <div>
        <label class="label" for="score-note">Note <span class="font-normal text-text-muted">(optional)</span></label>
        <input id="score-note" v-model="note" class="input" maxlength="120" placeholder="e.g. Forfeit, ended early" />
      </div>
      <p v-if="game.hasScore && game.scoreEnteredByName" class="text-xs text-text-muted">Last entered by {{ game.scoreEnteredByName }} · {{ timestamp(game.scoreEnteredAt) }}</p>
      <p class="text-xs text-text-muted">The other team’s coach and director are emailed, and the score shows on everyone’s schedule.</p>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <template v-if="confirmClear">
        <span class="text-sm mr-auto">Clear this score?</span>
        <button class="btn btn-secondary" @click="confirmClear = false">Keep it</button>
        <button class="btn btn-danger" :disabled="saving" @click="clear">Clear score</button>
      </template>
      <template v-else>
        <button v-if="game.hasScore" class="btn btn-ghost mr-auto" :disabled="saving" @click="confirmClear = true">Clear score</button>
        <button class="btn btn-secondary" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary" type="submit" form="score-form" :disabled="!canSave || saving">{{ saving ? 'Saving…' : 'Save score' }}</button>
      </template>
    </template>
  </Modal>
</template>
