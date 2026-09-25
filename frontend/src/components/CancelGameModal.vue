<script setup>
import { ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { longDate } from '../utils/format';
import Modal from './Modal.vue';
import GameRow from './GameRow.vue';

// A System Admin cancelling a published game outright. Coaches and directors
// ask for this through a change request instead.
const props = defineProps({ game: { type: Object, required: true } });
const emit = defineEmits(['close', 'cancelled']);
const toast = useToast();
const reason = ref('');
const saving = ref(false);
const error = ref('');

async function cancelGame() {
  saving.value = true;
  error.value = '';
  try {
    const { data } = await api.put(`/schedule/games/${props.game.id}`, { action: 'cancel', reason: reason.value.trim() });
    toast.success('Game cancelled. It stays on the schedule with your reason.');
    emit('cancelled', data.game);
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
</script>

<template>
  <Modal title="Cancel this game?" @close="emit('close')">
    <div class="space-y-4">
      <div class="rounded-lg border border-border p-3">
        <p class="text-xs text-text-muted mb-1">{{ longDate(game.date) }}</p>
        <GameRow :game="game" compact />
      </div>
      <p class="text-sm">It won’t be played. It stays on the schedule marked <strong>Cancelled</strong> with your reason, both teams’ programs see it in Activity, and any referees on it are taken off and told.</p>
      <div>
        <label class="label" for="cancel-reason">Why is it being cancelled?</label>
        <textarea id="cancel-reason" v-model="reason" rows="2" class="input" maxlength="200" placeholder="e.g. Snow closed the school; the gym is unavailable." />
      </div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('close')">Keep the game</button>
      <button class="btn btn-danger" :disabled="reason.trim().length < 5 || saving" @click="cancelGame">{{ saving ? 'Cancelling…' : 'Cancel game' }}</button>
    </template>
  </Modal>
</template>
