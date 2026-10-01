<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import PageHeader from '../components/PageHeader.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ProgramPicker from '../components/ProgramPicker.vue';

const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();
const teams = ref([]);
const divisions = ref([]);
const loading = ref(true);
const divisionFilter = ref('');
const canEdit = computed(() => auth.canManage);
const showProgram = computed(() => auth.isSuperAdmin && !ctx.programId);

async function load() {
  loading.value = true;
  try {
    const [t, d] = await Promise.all([api.get('/teams', { params: ctx.query }), api.get('/league/divisions')]);
    teams.value = t.data.teams;
    divisions.value = d.data.divisions;
  } catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
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
    ? { id: t.id, form: { programId, name: t.name, divisionId: t.divisionId, coach: t.headCoachUserId ? `user:${t.headCoachUserId}` : t.headCoachContactId ? `contact:${t.headCoachContactId}` : '', isActive: t.isActive } }
    : { id: null, form: { programId, name: '', divisionId: divisionFilter.value || '', coach: '' } };
}
watch(() => editor.value?.form.programId, async (pid, old) => {
  if (editor.value && !editor.value.id && pid !== old) { await loadCoaches(pid); editor.value.form.coach = ''; }
});
async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const { coach, ...f } = editor.value.form;
    // One picker, two kinds of coach: a Coach account or a Directory coach.
    f.headCoachUserId = coach.startsWith('user:') ? coach.slice(5) : null;
    f.headCoachContactId = coach.startsWith('contact:') ? coach.slice(8) : null;
    if (editor.value.id) await api.put(`/teams/${editor.value.id}`, f);
    else await api.post('/teams', f);
    toast.success(editor.value.id ? 'Team saved.' : `Added ${f.name}.`);
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
