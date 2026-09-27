<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../stores/toast';
import Modal from './Modal.vue';
import PlacementPicker from './PlacementPicker.vue';

// Adding a game.
//   mode 'admin':   a System Admin adds it straight to a draft or the
//                   published schedule (runId). Opponents outside the league
//                   rules can be added as an exception, with a reason.
//   mode 'request': a coach or director asks for one on the published
//                   schedule; it goes through the usual approval chain.
const props = defineProps({
  mode: { type: String, default: 'admin' },
  runId: { type: String, default: '' },
  runStatus: { type: String, default: 'published' },
});
const emit = defineEmits(['close', 'added', 'created']);
const auth = useAuthStore();
const toast = useToast();
const isAdmin = computed(() => props.mode === 'admin');
const runParams = computed(() => (isAdmin.value && props.runId ? { runId: props.runId } : {}));

const teams = ref([]);
const gamesPerTeam = ref(0);
const loading = ref(true);
const error = ref('');
onMounted(async () => {
  try {
    const { data } = await api.get('/schedule/add-game/teams', { params: runParams.value });
    teams.value = data.teams.filter((t) => t.mine);
    gamesPerTeam.value = data.gamesPerTeam;
    if (teams.value.length === 1) teamId.value = teams.value[0].id;
  } catch (err) { error.value = errorMessage(err); }
  finally { loading.value = false; }
});
// League teams by division; guest teams (admin only) in their own group at the end.
const byDivision = computed(() => {
  const m = new Map();
  for (const t of teams.value) {
    const g = t.isGuest ? 'Guest teams' : t.divisionName;
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(t);
  }
  return [...m.entries()];
});

// ---- team → opponent ----
const teamId = ref('');
const team = computed(() => teams.value.find((t) => t.id === teamId.value));
const opponents = ref(null);
const opponentId = ref('');
watch(teamId, async (id) => {
  opponents.value = null; opponentId.value = ''; placement.value = null;
  if (!id) return;
  try { opponents.value = (await api.get('/schedule/add-game/opponents', { params: { ...runParams.value, teamId: id } })).data.opponents; }
  catch (err) { error.value = errorMessage(err); opponents.value = []; }
});
const withinRules = computed(() => (opponents.value || []).filter((o) => !o.exceptions.length));
const exceptionsList = computed(() => (opponents.value || []).filter((o) => o.exceptions.length));
const opponent = computed(() => (opponents.value || []).find((o) => o.id === opponentId.value));
const optionLabel = (o) => `${o.name}${o.isGuest ? ' · guest' : ''}${o.sameDivision ? '' : ` (${o.divisionName})`} · ${o.meetings ? `plays them ${o.meetings}×` : 'hasn’t played them'}${o.isGuest ? '' : ` · ${o.games} game${o.games === 1 ? '' : 's'}`}`;
const isGuestGame = computed(() => !!(team.value?.isGuest || opponent.value?.isGuest));

// ---- when ----
const placement = ref(null);
const unplaced = ref(false); // drafts only: add it to Unplaced and place it later
watch(opponentId, () => { placement.value = null; exception.value = false; });
const pickerGame = computed(() => ({ homeTeamName: team.value?.name, awayTeamName: opponent.value?.name }));
const pickerParams = computed(() => ({ ...runParams.value, teamId: teamId.value, opponentId: opponentId.value }));

// ---- why ----
const exception = ref(false);
const reason = ref('');
const needsException = computed(() => !!opponent.value?.exceptions.length);
const reasonRequired = computed(() => !isAdmin.value || needsException.value);
// Guest games don't count toward the target, so there's nothing to warn about.
const overTarget = computed(() => (opponent.value && !isGuestGame.value ? [team.value, opponent.value] : []).filter((t) => t && gamesPerTeam.value && t.games >= gamesPerTeam.value));

const canSubmit = computed(() => team.value && opponent.value
  && (unplaced.value || placement.value)
  && (!needsException.value || exception.value)
  && (!reasonRequired.value || reason.value.trim().length >= 5));
const saving = ref(false);
async function submit() {
  error.value = '';
  saving.value = true;
  const when = unplaced.value ? {} : { courtId: placement.value.courtId, date: placement.value.date, startTime: placement.value.startTime, endTime: placement.value.endTime };
  try {
    if (isAdmin.value) {
      const { data } = await api.post(`/schedule/runs/${props.runId}/games`, { teamId: teamId.value, opponentId: opponentId.value, ...when, reason: reason.value.trim(), exception: exception.value });
      toast.success(`Game added${data.game.status === 'unscheduled' ? ' to Unplaced' : ''}.${data.warnings?.length ? ` Note: ${data.warnings.join(' ')}` : ''}`);
      emit('added', data.game);
    } else {
      const { data } = await api.post('/requests', { type: 'add', teamId: teamId.value, opponentId: opponentId.value, ...when, reason: reason.value.trim() });
      toast.success(`Request sent. ${data.request.statusLabel}.`);
      emit('created', data.request);
    }
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
const nextStep = computed(() => {
  // Guest programs have no director, so there's no "other program" step.
  const other = isGuestGame.value ? '' : 'the other program, ';
  return auth.user.role === 'league_coach'
    ? `Your program director reviews it first, then ${other}then the league. The game is added when the league signs off.`
    : `${isGuestGame.value ? 'It' : 'The other program reviews it, then it'} goes to the league for sign-off. The game is added when the league signs off.`;
});
</script>

<template>
  <Modal :title="isAdmin ? 'Add a game' : 'Request a game'" wide @close="emit('close')">
    <p v-if="loading" class="text-sm text-text-muted">Loading teams…</p>
    <div v-else class="space-y-4">
      <p v-if="!isAdmin" class="text-sm text-text-muted">Ask for an extra game for one of your teams, for example to replace a cancelled game. Only opponents within the league’s rules are listed.</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="add-team">Team</label>
          <select id="add-team" v-model="teamId" class="input">
            <option value="">Choose a team…</option>
            <optgroup v-for="[div, list] in byDivision" :key="div" :label="div">
              <option v-for="t in list" :key="t.id" :value="t.id">{{ t.name }}{{ t.isGuest ? ` (${t.divisionName})` : ` · ${t.games} game${t.games === 1 ? '' : 's'}` }}</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label class="label" for="add-opponent">Opponent</label>
          <select id="add-opponent" v-model="opponentId" class="input" :disabled="!teamId || opponents === null">
            <option value="">{{ !teamId ? 'Choose the team first' : opponents === null ? 'Loading…' : 'Choose an opponent…' }}</option>
            <optgroup v-if="withinRules.length" label="Within the league rules">
              <option v-for="o in withinRules" :key="o.id" :value="o.id">{{ optionLabel(o) }}</option>
            </optgroup>
            <optgroup v-if="exceptionsList.length" label="Exceptions to the league rules">
              <option v-for="o in exceptionsList" :key="o.id" :value="o.id">{{ optionLabel(o) }}</option>
            </optgroup>
          </select>
          <p v-if="teamId && opponents && !opponents.length" class="text-xs text-text-muted mt-1">
            {{ isAdmin ? 'No other active teams.' : 'This team already plays every possible opponent as often as the league allows. Contact the league if it needs another game.' }}
          </p>
        </div>
      </div>

      <div v-if="needsException" class="rounded-lg border border-warning p-3 text-sm" role="note">
        <p class="font-semibold">This game is an exception to the league rules</p>
        <ul class="list-disc pl-5 text-sm mt-1">
          <li v-for="e in opponent.exceptions" :key="e">{{ e }}</li>
        </ul>
        <label class="flex items-center gap-2 mt-2 font-medium">
          <input v-model="exception" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Add it anyway, as an exception
        </label>
      </div>
      <p v-if="isGuestGame" class="text-xs text-text-muted">A guest game: it’s played at the league team’s gym and doesn’t count toward games per team or home/away balance.</p>
      <p v-for="t in overTarget" :key="t.id" class="text-xs font-medium">{{ t.name }} already has {{ t.games }} games; this makes {{ t.games + 1 }} (target {{ gamesPerTeam }}).</p>

      <div v-if="opponent">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
          <p class="label !mb-0">When and where</p>
          <label v-if="isAdmin && runStatus === 'draft'" class="text-sm flex items-center gap-2">
            <input v-model="unplaced" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Add to Unplaced (place it later)
          </label>
        </div>
        <PlacementPicker v-if="!unplaced" :key="`${teamId}|${opponentId}`" v-model="placement" :game="pickerGame" url="/schedule/add-game/options" :params="pickerParams" add-mode />
        <p v-else class="text-sm text-text-muted">It goes to the Unplaced tab. Use <strong>Place game</strong> there when you’re ready.</p>
      </div>

      <div v-if="opponent">
        <label class="label" for="add-reason">{{ needsException ? 'Why is this an exception?' : isAdmin ? 'Reason (optional)' : 'Reason' }}</label>
        <textarea id="add-reason" v-model="reason" rows="2" class="input" maxlength="300"
          :placeholder="needsException ? 'e.g. Both clubs agreed to a crossover scrimmage.' : 'e.g. Replaces the game against Riverbend that was cancelled for snow.'" />
        <p class="text-xs text-text-muted mt-1">{{ isAdmin ? (runStatus === 'published' ? `The game goes live straight away. ${isGuestGame ? 'The league team’s director and coach are told' : 'Both programs are told'} and see it in Activity, and it gets referee slots.` : 'The reason is kept with the game.') : nextStep }}</p>
      </div>
      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!canSubmit || saving" @click="submit">
        {{ saving ? 'Saving…' : isAdmin ? 'Add game' : 'Send request' }}
      </button>
    </template>
  </Modal>
</template>
