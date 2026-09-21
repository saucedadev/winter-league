<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { longDate } from '../utils/format';
import Modal from './Modal.vue';
import GameRow from './GameRow.vue';

// One referee slot on one game: pick who works it, or (on/after game day)
// record whether they worked it.
const props = defineProps({ slot: { type: Object, required: true }, game: { type: Object, required: true }, today: { type: String, required: true } });
const emit = defineEmits(['close', 'saved']);
const toast = useToast();

const candidates = ref([]);
const loading = ref(true);
const choice = ref(props.slot.refereeId || '');
const saving = ref(false);
const error = ref('');
const filter = ref('');

onMounted(async () => {
  try { candidates.value = (await api.get(`/referees/assignments/${props.slot.id}/candidates`)).data.candidates; }
  catch (err) { error.value = errorMessage(err); }
  finally { loading.value = false; }
});

const shown = computed(() => candidates.value.filter((c) => !filter.value || c.name.toLowerCase().includes(filter.value.toLowerCase())));
const available = computed(() => shown.value.filter((c) => !c.blocking.length));
const unavailable = computed(() => shown.value.filter((c) => c.blocking.length));
const gameDayOrPast = computed(() => props.game.date <= props.today);
const changed = computed(() => (choice.value || null) !== (props.slot.refereeId || null));

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const { data } = await api.put(`/referees/assignments/${props.slot.id}`, { refereeId: choice.value || null });
    toast.success(choice.value ? `Assigned.${data.warnings?.length ? ` Note: ${data.warnings.join('; ')}.` : ''}` : 'Referee removed.');
    emit('saved', data.game);
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
async function setStatus(status) {
  saving.value = true;
  error.value = '';
  try {
    const { data } = await api.put(`/referees/assignments/${props.slot.id}/status`, { status });
    toast.success({ checked_in: 'Marked as worked.', no_show: 'Marked as a no-show.', assigned: 'Attendance cleared.' }[status]);
    emit('saved', data.game);
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
</script>

<template>
  <Modal :title="`Referee ${slot.position}`" wide @close="emit('close')">
    <div class="space-y-4">
      <div class="rounded-lg border border-border p-3">
        <p class="text-xs text-text-muted mb-1">{{ longDate(game.date) }}</p>
        <GameRow :game="game" compact />
      </div>

      <div v-if="slot.refereeId && gameDayOrPast" class="rounded-lg border border-border p-3">
        <p class="text-sm font-semibold">{{ slot.refereeName }}</p>
        <p class="text-xs text-text-muted mb-2">
          <template v-if="slot.status === 'checked_in'">
            {{ slot.checkInMethod === 'referee' ? 'Checked in from their phone' : 'Confirmed as worked by the assignor' }}<template v-if="slot.checkInDistanceMiles != null"> · {{ slot.checkInDistanceMiles }} mi from the venue</template>
          </template>
          <template v-else-if="slot.status === 'no_show'">Marked as a no-show. Not paid.</template>
          <template v-else>Hasn’t checked in.</template>
        </p>
        <div class="flex flex-wrap gap-2">
          <button v-if="slot.status !== 'checked_in'" class="btn btn-secondary !py-1 text-xs" :disabled="saving" @click="setStatus('checked_in')">Mark as worked</button>
          <button v-if="slot.status !== 'no_show'" class="btn btn-secondary !py-1 text-xs" :disabled="saving" @click="setStatus('no_show')">Mark no-show</button>
          <button v-if="slot.status !== 'assigned'" class="btn btn-ghost !py-1 text-xs" :disabled="saving" @click="setStatus('assigned')">Clear attendance</button>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2 mb-2">
          <p class="label !mb-0">Who works this game?</p>
          <input v-model="filter" class="input !w-44 !py-1 text-sm" placeholder="Search referees" aria-label="Search referees" />
        </div>
        <p v-if="!loading && !available.length && !filter" class="text-sm font-medium mb-2" role="status">Nobody on the roster is free for this game. Everyone below has a conflict. Add a referee on the Referees page, or move someone off an overlapping game.</p>
        <p v-if="loading" class="text-sm text-text-muted">Checking who’s free…</p>
        <div v-else class="max-h-80 overflow-y-auto border border-border rounded-lg divide-y divide-border" role="radiogroup" aria-label="Referees">
          <label class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-background">
            <input v-model="choice" type="radio" value="" class="accent-[var(--color-accent)]" />
            <span class="text-sm text-text-muted">Leave open</span>
          </label>
          <label v-for="c in available" :key="c.id" class="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-background">
            <input v-model="choice" type="radio" :value="c.id" class="mt-1 accent-[var(--color-accent)]" />
            <span class="text-sm min-w-0 flex-1">
              <span class="font-medium">{{ c.name }}</span><span v-if="c.current" class="badge badge-outline ml-2">Current</span>
              <span class="block text-xs text-text-muted">{{ c.seasonGames }} game{{ c.seasonGames === 1 ? '' : 's' }} this season · {{ c.dayGames }} that day</span>
              <span v-for="w in c.warnings" :key="w" class="flex items-center gap-1.5 text-xs font-medium"><span class="w-1.5 h-1.5 rounded-full bg-warning" aria-hidden="true" />{{ w }}</span>
            </span>
          </label>
          <div v-for="c in unavailable" :key="c.id" class="flex items-start gap-3 px-3 py-2 opacity-60">
            <input type="radio" disabled class="mt-1" :aria-label="`${c.name} is unavailable`" />
            <span class="text-sm"><span class="font-medium">{{ c.name }}</span><span class="block text-xs">{{ c.blocking.join(' · ') }}</span></span>
          </div>
        </div>
      </div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('close')">Close</button>
      <button class="btn btn-primary" :disabled="!changed || saving" @click="save">{{ saving ? 'Saving…' : !choice && slot.refereeId ? 'Remove referee' : 'Assign referee' }}</button>
    </template>
  </Modal>
</template>
