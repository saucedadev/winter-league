<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import PageHeader from '../components/PageHeader.vue';
import HelpProgramPrompt from '../components/HelpProgramPrompt.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ProgramPicker from '../components/ProgramPicker.vue';

const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();
const teams = ref([]);
const leagueGames = ref(null); // the league's games per team
const divisions = ref([]);
const loading = ref(true);
const divisionFilter = ref('');
const canEdit = computed(() => auth.canManage);
const showProgram = computed(() => auth.isSuperAdmin && !ctx.programId);

// Preseason: whether this season has one that's still open, so teams can be
// marked ready for scrimmages and joint practices.
const preseason = ref(null);
const preseasonOpen = computed(() => !!preseason.value?.isOpen);
async function load() {
  loading.value = true;
  try {
    const [t, d, p] = await Promise.all([api.get('/teams', { params: ctx.query }), api.get('/league/divisions'), api.get('/preseason').catch(() => ({ data: null }))]);
    teams.value = t.data.teams;
    leagueGames.value = t.data.leagueGamesPerTeam ?? null;
    divisions.value = d.data.divisions;
    preseason.value = p.data;
  } catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
const togglingId = ref('');
async function togglePreseason(t) {
  togglingId.value = t.id;
  try {
    await api.put('/preseason/teams', { teamIds: [t.id], open: !t.preseasonOpen });
    t.preseasonOpen = !t.preseasonOpen;
    toast.success(t.preseasonOpen ? `${t.name} is open for preseason games. Other programs can now find it on the Preseason page.` : `${t.name} is closed for preseason games. Anything already arranged stays on.`);
  } catch (err) { toast.error(errorMessage(err)); }
  finally { togglingId.value = ''; }
}
// Team games override: fewer league games for one team (lower than the
// league's only; 0 = no league games).
const hasTarget = (t) => t.gamesTarget != null && leagueGames.value != null && t.gamesTarget < leagueGames.value;
const targetLabel = (t) => (t.gamesTarget === 0 ? 'No league games' : `${t.gamesTarget} league game${t.gamesTarget === 1 ? '' : 's'}`);
const targetTitle = (t) => `Team override: ${t.gamesTarget === 0 ? 'no league games' : `${t.gamesTarget} of the league’s ${leagueGames.value} games`}${t.gamesTargetReason ? `. Reason: ${t.gamesTargetReason}` : ''}. Takes effect the next time the league builds a draft.`;
const targetOptions = computed(() => (leagueGames.value ? Array.from({ length: leagueGames.value }, (_, i) => leagueGames.value - 1 - i) : []));
const canPreseason = (t) => canEdit.value && preseasonOpen.value && t.isActive && !t.programIsGuest;
onMounted(load);

const grouped = computed(() => {
  const list = teams.value.filter((t) => !divisionFilter.value || t.divisionId === divisionFilter.value);
  const groups = [];
  for (const t of list) {
    let g = groups.find((x) => x.id === t.divisionId);
    if (!g) groups.push((g = { id: t.divisionId, name: t.divisionName, teams: [] }));
    g.teams.push(t);
  }
  return groups;
});

const editor = ref(null);
const coaches = ref([]);
const contactCoaches = ref([]); // coaches from the program's Directory (no account yet)
const saving = ref(false);
const formError = ref('');
async function loadCoaches(programId) {
  const data = programId ? (await api.get('/teams/coaches', { params: { programId } })).data : { coaches: [], contacts: [] };
  coaches.value = data.coaches;
  contactCoaches.value = data.contacts || [];
}
async function open(t) {
  formError.value = '';
  const programId = t?.programId || ctx.programId || '';
  await loadCoaches(programId);
  editor.value = t
    ? { id: t.id, isGuest: t.programIsGuest, target: { was: hasTarget(t) ? t.gamesTarget : null, reasonWas: t.gamesTargetReason || '' },
      form: { programId, name: t.name, divisionId: t.divisionId, coach: t.headCoachUserId ? `user:${t.headCoachUserId}` : t.headCoachContactId ? `contact:${t.headCoachContactId}` : '', isActive: t.isActive,
        gamesTarget: hasTarget(t) ? String(t.gamesTarget) : '', gamesTargetReason: t.gamesTargetReason || '' } }
    : { id: null, form: { programId, name: '', divisionId: divisionFilter.value || '', coach: '' } };
}
watch(() => editor.value?.form.programId, async (pid, old) => {
  if (editor.value && !editor.value.id && pid !== old) { await loadCoaches(pid); editor.value.form.coach = ''; }
});
async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const { coach, gamesTarget, gamesTargetReason, ...f } = editor.value.form;
    // One picker, two kinds of coach: a Coach account or a Directory coach.
    f.headCoachUserId = coach.startsWith('user:') ? coach.slice(5) : null;
    f.headCoachContactId = coach.startsWith('contact:') ? coach.slice(8) : null;
    let targetNote = '';
    if (editor.value.id) {
      await api.put(`/teams/${editor.value.id}`, f);
      // Games this season, only when it changed.
      const tg = editor.value.target;
      const next = gamesTarget === '' ? null : Number(gamesTarget);
      if (tg && (next !== tg.was || (next != null && gamesTargetReason.trim() !== tg.reasonWas))) {
        await api.put(`/teams/${editor.value.id}/games-target`, { gamesTarget: next, reason: gamesTargetReason });
        targetNote = ' The new games target takes effect the next time the league builds a draft.';
      }
    } else await api.post('/teams', f);
    toast.success(editor.value.id ? `Team saved.${targetNote}` : `Added ${f.name}.`);
    editor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

const deleting = ref(null);
const busy = ref(false);
async function doDelete() {
  busy.value = true;
  try { await api.delete(`/teams/${deleting.value.id}`); toast.success('Team deleted.'); deleting.value = null; await load(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Teams" :subtitle="canEdit ? 'Every team your program is entering, by division.' : 'Your program’s teams this season.'">
      <select v-if="divisions.length" v-model="divisionFilter" class="input !w-auto" aria-label="Filter by division">
        <option value="">All divisions</option>
        <option v-for="d in divisions" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
      <button v-if="canEdit" class="btn btn-primary" :disabled="auth.isSuperAdmin && !ctx.activePrograms.length" @click="open()">Add team</button>
    </PageHeader>
    <HelpProgramPrompt what="teams" />

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!grouped.length" :title="divisionFilter ? 'No teams in this division' : 'No teams yet'"
      :body="canEdit ? 'Add a team for each division your program is entering.' : 'Your program director hasn’t added teams yet.'">
      <button v-if="canEdit" class="btn btn-primary" @click="open()">Add team</button>
    </EmptyState>

    <div v-else class="space-y-5">
      <section v-for="g in grouped" :key="g.id">
        <h2 class="text-sm font-semibold mb-2">{{ g.name }} <span class="font-normal text-text-muted">· {{ g.teams.length }}</span></h2>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="t in g.teams" :key="t.id" class="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1" :class="!t.isActive && 'opacity-60'">
            <div class="flex-1 min-w-[10rem]">
              <p class="font-medium text-sm">{{ t.name }} <span v-if="!t.isActive" class="text-xs text-text-muted">(inactive)</span></p>
              <p v-if="showProgram" class="text-xs text-text-muted">{{ t.programName }}{{ t.programIsGuest ? ' (guest)' : '' }}</p>
            </div>
            <button v-if="canPreseason(t)" class="badge cursor-pointer" :class="t.preseasonOpen ? 'bg-success text-black' : 'badge-outline'" :disabled="togglingId === t.id"
              :aria-pressed="t.preseasonOpen" :title="t.preseasonOpen ? 'Open for preseason scrimmages and joint practices. Click to close.' : 'Click to open this team for preseason scrimmages and joint practices.'"
              @click="togglePreseason(t)">{{ t.preseasonOpen ? 'Preseason: open ✓' : 'Open for preseason' }}</button>
            <span v-else-if="t.preseasonOpen && preseasonOpen" class="badge bg-success text-black">Preseason</span>
            <span v-if="hasTarget(t)" class="badge badge-outline" :title="targetTitle(t)">{{ targetLabel(t) }}</span>
            <p class="text-sm" :class="t.headCoachName ? '' : 'text-text-muted'">
              {{ t.headCoachName ? `Coach ${t.headCoachName}` : 'No head coach assigned' }}
              <span v-if="t.headCoachIsContact" class="badge badge-outline ml-1" title="From the program’s Directory: no app account yet">Directory</span>
            </p>
            <div v-if="canEdit" class="flex">
              <button class="btn btn-ghost" @click="open(t)">Edit</button>
              <button class="btn btn-ghost hover:!text-danger" @click="deleting = t">Delete</button>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <Modal v-if="editor" :title="editor.id ? 'Edit team' : 'Add team'" @close="editor = null">
      <form id="team-form" class="space-y-4" @submit.prevent="save">
        <ProgramPicker v-if="!editor.id" v-model="editor.form.programId" />
        <div><label class="label" for="tf-name">Team name</label><input id="tf-name" v-model="editor.form.name" class="input" required maxlength="60" placeholder="e.g. Hawks 6th Boys Blue" /></div>
        <div>
          <label class="label" for="tf-div">Division</label>
          <select id="tf-div" v-model="editor.form.divisionId" class="input" required>
            <option value="" disabled>Choose a division</option>
            <option v-for="d in divisions.filter((x) => x.isActive || x.id === editor.form.divisionId)" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="tf-coach">Head coach <span class="font-normal text-text-muted">(optional)</span></label>
          <select id="tf-coach" v-model="editor.form.coach" class="input">
            <option value="">Not assigned yet</option>
            <optgroup v-if="coaches.length" label="Coach accounts">
              <option v-for="c in coaches" :key="c.id" :value="`user:${c.id}`">{{ c.firstName }} {{ c.lastName }}</option>
            </optgroup>
            <optgroup v-if="contactCoaches.length" label="From the Directory (no account yet)">
              <option v-for="c in contactCoaches" :key="c.id" :value="`contact:${c.id}`">{{ c.firstName }} {{ c.lastName }}</option>
            </optgroup>
          </select>
          <p class="text-xs text-text-muted mt-1">
            <template v-if="editor.form.coach.startsWith('contact:')">A Directory coach can’t sign in, so they won’t see the schedule or request changes. When the league admin creates their Coach account, switch the team to it.</template>
            <template v-else-if="!coaches.length">No Coach accounts in this program yet. You can pick a coach from your Directory until the league admin creates their account.</template>
          </p>
        </div>
        <fieldset v-if="editor.id && !editor.isGuest && leagueGames" class="min-w-0 space-y-2">
          <label class="label !mb-0" for="tf-games">Games this season</label>
          <select id="tf-games" v-model="editor.form.gamesTarget" class="input">
            <option value="">League’s count ({{ leagueGames }} games)</option>
            <option v-for="n in targetOptions" :key="n" :value="String(n)">{{ n === 0 ? 'No league games' : `${n} game${n === 1 ? '' : 's'}` }}</option>
          </select>
          <template v-if="editor.form.gamesTarget !== ''">
            <label class="label !mb-0" for="tf-games-why">Reason</label>
            <input id="tf-games-why" v-model="editor.form.gamesTargetReason" class="input" required maxlength="200" placeholder="e.g. Travel team, tournament schedule" />
          </template>
          <p class="text-xs text-text-muted">
            <template v-if="editor.form.gamesTarget === '0'">The Matchmaker leaves this team out of league games. It can still play preseason, or the league can add a game by hand.</template>
            <template v-else-if="editor.form.gamesTarget !== ''">For a team that plays mostly tournaments: the Matchmaker spreads its games across the season and its opponents make up games elsewhere. Block tournament weekends with blackout dates, too.</template>
            <template v-else>Fewer games than the league’s count can be set for one team, such as a travel team. More can’t.</template>
            Takes effect the next time the league builds a draft; the league can see and change it.
          </p>
        </fieldset>
        <label v-if="editor.id" class="flex items-center gap-2 text-sm"><input v-model="editor.form.isActive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Active this season</label>
        <p v-if="formError" class="text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="team-form" :disabled="saving">{{ saving ? 'Saving…' : editor.id ? 'Save team' : 'Add team' }}</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="deleting" title="Delete team?" confirm-label="Delete team" :busy="busy"
      :message="`Delete ${deleting.name}? To keep its history, mark it inactive instead.`" @confirm="doDelete" @close="deleting = null" />
  </div>
</template>
