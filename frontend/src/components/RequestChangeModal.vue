<script setup>
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../stores/toast';
import { longDate, timeRange } from '../utils/format';
import Modal from './Modal.vue';
import GameRow from './GameRow.vue';
import PlacementPicker from './PlacementPicker.vue';

const props = defineProps({ game: { type: Object, required: true } });
const emit = defineEmits(['close', 'created']);
const auth = useAuthStore();
const toast = useToast();

const type = ref('reschedule');
const placement = ref(null);
const swapWith = ref(null);
const reason = ref('');
const error = ref('');
const saving = ref(false);

const swapOptions = ref(null);
watch(type, async (t) => {
  if (t !== 'swap' || swapOptions.value) return;
  try { swapOptions.value = (await api.get(`/schedule/games/${props.game.id}/swap-options`)).data.options; }
  catch (err) { error.value = errorMessage(err); swapOptions.value = []; }
});

const nextStep = computed(() => (auth.user.role === 'league_coach'
  ? 'Your program director reviews it first, then the other program, then the league.'
  : 'The other program reviews it, then the league signs off.'));
const canSubmit = computed(() => reason.value.trim().length >= 5
  && (type.value === 'cancel' || (type.value === 'reschedule' ? !!placement.value : !!swapWith.value)));

async function submit() {
  error.value = '';
  saving.value = true;
  try {
    const body = { gameId: props.game.id, type: type.value, reason: reason.value.trim() };
    if (type.value === 'reschedule') Object.assign(body, { courtId: placement.value.courtId, date: placement.value.date, startTime: placement.value.startTime, endTime: placement.value.endTime });
    else if (type.value === 'swap') body.swapGameId = swapWith.value.id;
    const { data } = await api.post('/requests', body);
    toast.success(`Request sent. ${data.request.statusLabel}.`);
    emit('created', data.request);
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
</script>

<template>
  <Modal title="Request a schedule change" wide @close="emit('close')">
    <div class="space-y-4">
      <div class="rounded-lg border border-border p-3">
        <p class="text-xs text-text-muted mb-1">{{ longDate(game.date) }}</p>
        <GameRow :game="game" compact />
      </div>

      <fieldset>
        <legend class="label">What do you need?</legend>
        <div class="grid sm:grid-cols-3 gap-2">
          <label class="flex gap-2 items-start rounded-lg border p-3 cursor-pointer" :class="type === 'reschedule' ? 'border-accent' : 'border-border'">
            <input v-model="type" type="radio" value="reschedule" class="mt-1 accent-[var(--color-accent)]" />
            <span class="text-sm"><span class="font-semibold block">Move this game</span><span class="text-text-muted text-xs">Pick another open time at either team’s gym.</span></span>
          </label>
          <label class="flex gap-2 items-start rounded-lg border p-3 cursor-pointer" :class="type === 'swap' ? 'border-accent' : 'border-border'">
            <input v-model="type" type="radio" value="swap" class="mt-1 accent-[var(--color-accent)]" />
            <span class="text-sm"><span class="font-semibold block">Swap with another game</span><span class="text-text-muted text-xs">The two games trade dates, times, and courts.</span></span>
          </label>
          <label class="flex gap-2 items-start rounded-lg border p-3 cursor-pointer" :class="type === 'cancel' ? 'border-accent' : 'border-border'">
            <input v-model="type" type="radio" value="cancel" class="mt-1 accent-[var(--color-accent)]" />
            <span class="text-sm"><span class="font-semibold block">Cancel this game</span><span class="text-text-muted text-xs">It won’t be played. Weather, a gym closure, and so on.</span></span>
          </label>
        </div>
      </fieldset>

      <div v-if="type === 'cancel'" class="rounded-lg border border-border p-3 text-sm">
        <p class="font-medium">The game won’t be played.</p>
        <p class="text-text-muted text-xs mt-1">It stays on the schedule marked <strong>Cancelled</strong>, with your reason, so everyone can see what happened. Any referees on it are taken off. If it could be played another time, choose <strong>Move this game</strong> instead.</p>
      </div>
      <div v-else-if="type === 'reschedule'">
        <p class="label">New time</p>
        <PlacementPicker v-model="placement" :game="game" />
      </div>
      <div v-else>
        <p class="label">Swap with</p>
        <p v-if="swapOptions === null" class="text-sm text-text-muted">Checking which games can trade places…</p>
        <p v-else-if="!swapOptions.length" class="text-sm text-text-muted">No upcoming game can trade places with this one without breaking a scheduling rule. Try moving it instead.</p>
        <div v-else class="max-h-72 overflow-y-auto border border-border rounded-lg divide-y divide-border" role="radiogroup" aria-label="Games to swap with">
          <label v-for="o in swapOptions" :key="o.game.id" class="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-background" :class="swapWith?.id === o.game.id && 'bg-background'">
            <input type="radio" name="swap" class="mt-1 accent-[var(--color-accent)]" :checked="swapWith?.id === o.game.id" @change="swapWith = o.game" />
            <span class="text-sm min-w-0">
              <span class="font-medium">{{ longDate(o.game.date) }}, {{ timeRange(o.game.startTime, o.game.endTime) }}</span>
              <span class="block text-text-muted">{{ o.game.homeTeamName }} vs {{ o.game.awayTeamName }} · {{ o.game.venueName }}</span>
              <span v-for="w in o.warnings" :key="w" class="block text-xs font-medium">{{ w }}</span>
            </span>
          </label>
        </div>
      </div>

      <div>
        <label class="label" for="req-reason">{{ type === 'cancel' ? 'Why is it being cancelled?' : 'Reason' }}</label>
        <textarea id="req-reason" v-model="reason" rows="2" class="input" maxlength="400"
          :placeholder="type === 'cancel' ? 'e.g. Snow closed the school; the gym is unavailable.' : 'e.g. Our gym is closed for a school concert that night.'" />
        <p class="text-xs text-text-muted mt-1">{{ nextStep }}</p>
      </div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!canSubmit || saving" @click="submit">{{ saving ? 'Sending…' : 'Send request' }}</button>
    </template>
  </Modal>
</template>
