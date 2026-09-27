<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import Modal from './Modal.vue';
import ConfirmDialog from './ConfirmDialog.vue';

// Guest (non-conference) programs and their teams, on the Programs page.
// Guests don't take a league spot and have no gyms, slots, blackouts,
// directors or coaches; their games are added by hand at a league team's gym.
const ctx = useProgramContext();
const toast = useToast();
const teams = ref([]);
const divisions = ref([]);

async function loadTeams() {
  const { data } = await api.get('/teams');
  teams.value = data.teams.filter((t) => t.programIsGuest);
}
onMounted(async () => {
  try {
    divisions.value = (await api.get('/league/divisions')).data.divisions.filter((d) => d.isActive !== false && d.isActive !== 0);
    await loadTeams();
  } catch (err) { toast.error(errorMessage(err)); }
});
const teamsOf = (programId) => teams.value.filter((t) => t.programId === programId);

// ---- guest program add / edit ----
const editor = ref(null);
const saving = ref(false);
const formError = ref('');
function open(p) {
  formError.value = '';
  editor.value = p
    ? { id: p.id, form: { name: p.name, shortCode: p.shortCode, city: p.city || '', contactEmail: p.contactEmail || '', isActive: p.isActive } }
    : { id: null, form: { name: '', shortCode: '', city: '', contactEmail: '', isGuest: true } };
}
async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const f = editor.value.form;
    if (editor.value.id) await api.put(`/programs/${editor.value.id}`, f);
    else await api.post('/programs', f);
    toast.success(editor.value.id ? 'Guest program saved.' : `Added ${f.name} as a guest program. Now add its teams.`);
    editor.value = null;
    await ctx.load(true);
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}
const deleting = ref(null);
const busy = ref(false);
async function doDelete() {
  busy.value = true;
  try { await api.delete(`/programs/${deleting.value.id}`); toast.success('Guest program deleted.'); deleting.value = null; await ctx.load(true); }
  catch (err) { toast.error(errorMessage(err)); deleting.value = null; }
  finally { busy.value = false; }
}

// ---- guest teams ----
const newTeam = reactive({});
const teamForm = (pid) => (newTeam[pid] ||= { name: '', divisionId: '' });
async function addTeam(p) {
  const f = teamForm(p.id);
  try {
    await api.post('/teams', { programId: p.id, name: f.name.trim(), divisionId: f.divisionId });
    toast.success(`Added ${f.name.trim()}.`);
    newTeam[p.id] = { name: '', divisionId: f.divisionId };
    await loadTeams(); await ctx.load(true);
  } catch (err) { toast.error(errorMessage(err)); }
}
async function toggleTeam(t) {
  try { await api.put(`/teams/${t.id}`, { isActive: !t.isActive }); await loadTeams(); }
  catch (err) { toast.error(errorMessage(err)); }
}
async function removeTeam(t) {
  try { await api.delete(`/teams/${t.id}`); toast.success(`Removed ${t.name}.`); await loadTeams(); await ctx.load(true); }
  catch (err) { toast.error(errorMessage(err)); }
}
const guests = computed(() => ctx.guestPrograms);
</script>

<template>
  <section class="mt-8">
    <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div>
        <h2 class="text-lg font-semibold">Guest programs</h2>
        <p class="text-sm text-text-muted max-w-3xl">Outside clubs the league plays now and then (non-conference games). They don’t take a league spot and have no gyms, directors, or coaches. The matchmaker never schedules them: add guest games with <strong>Add game</strong> in the Schedule builder, or coaches and directors can request one. Guest games are played at the league team’s gym.</p>
      </div>
      <button class="btn btn-secondary shrink-0" @click="open()">Add guest program</button>
    </div>

    <p v-if="!guests.length" class="card card-blocky p-4 text-sm text-text-muted">No guest programs yet.</p>
    <div v-else class="grid gap-4 lg:grid-cols-2">
      <article v-for="p in guests" :key="p.id" class="card card-blocky p-4" :class="!p.isActive && 'opacity-60'">
        <header class="flex flex-wrap items-start gap-2 mb-3">
          <div class="flex-1 min-w-0">
            <p class="font-semibold">{{ p.name }} <span class="text-text-muted font-normal">{{ p.shortCode }}</span> <span class="badge badge-outline ml-1">Guest</span></p>
            <p class="text-xs text-text-muted">{{ p.city || '—' }}{{ p.contactEmail ? ` · ${p.contactEmail}` : '' }}{{ p.isActive ? '' : ' · inactive' }}</p>
          </div>
          <button class="btn btn-ghost text-xs" @click="open(p)">Edit</button>
          <button class="btn btn-ghost text-xs hover:!text-danger" @click="deleting = p">Delete</button>
        </header>
        <ul v-if="teamsOf(p.id).length" class="divide-y divide-border border border-border rounded-lg mb-3">
          <li v-for="t in teamsOf(p.id)" :key="t.id" class="px-3 py-2 flex flex-wrap items-center gap-2 text-sm" :class="!t.isActive && 'opacity-60'">
            <span class="flex-1 min-w-0"><span class="font-medium">{{ t.name }}</span> <span class="text-text-muted">· {{ t.divisionName }}{{ t.isActive ? '' : ' · inactive' }}</span></span>
            <button class="btn btn-ghost text-xs" @click="toggleTeam(t)">{{ t.isActive ? 'Deactivate' : 'Activate' }}</button>
            <button class="btn btn-ghost text-xs hover:!text-danger" @click="removeTeam(t)">Remove</button>
          </li>
        </ul>
        <p v-else class="text-sm text-text-muted mb-3">No teams yet. Add one for each division it plays in.</p>
        <form class="flex flex-wrap gap-2" @submit.prevent="addTeam(p)">
          <input v-model="teamForm(p.id).name" class="input !w-auto flex-1 min-w-[10rem]" placeholder="Team name, e.g. Sherwood 6th Boys" maxlength="80" :aria-label="`New team for ${p.name}`" />
          <select v-model="teamForm(p.id).divisionId" class="input !w-auto" :aria-label="`Division for the new ${p.name} team`">
            <option value="">Division…</option>
            <option v-for="d in divisions" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
          <button class="btn btn-secondary" type="submit" :disabled="!teamForm(p.id).name.trim() || !teamForm(p.id).divisionId">Add team</button>
        </form>
      </article>
    </div>

    <Modal v-if="editor" :title="editor.id ? 'Edit guest program' : 'Add guest program'" @close="editor = null">
      <form id="guest-form" class="grid gap-4 sm:grid-cols-3" @submit.prevent="save">
        <div class="sm:col-span-2"><label class="label" for="gf-name">Program name</label><input id="gf-name" v-model="editor.form.name" class="input" required maxlength="80" placeholder="Sherwood Youth Basketball" /></div>
        <div><label class="label" for="gf-code">Short code</label><input id="gf-code" v-model="editor.form.shortCode" class="input uppercase" required maxlength="6" placeholder="SHW" /></div>
        <div><label class="label" for="gf-city">City</label><input id="gf-city" v-model="editor.form.city" class="input" /></div>
        <div class="sm:col-span-2"><label class="label" for="gf-email">Contact email</label><input id="gf-email" v-model="editor.form.contactEmail" type="email" class="input" /></div>
        <label v-if="editor.id" class="sm:col-span-3 flex items-center gap-2 text-sm"><input v-model="editor.form.isActive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Active (can be picked for new games)</label>
        <p class="sm:col-span-3 text-xs text-text-muted">A guest program doesn’t take one of the league’s program spots. It can’t be changed into a league program later.</p>
        <p v-if="formError" class="sm:col-span-3 text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="guest-form" :disabled="saving">{{ saving ? 'Saving…' : editor.id ? 'Save' : 'Add guest program' }}</button>
      </template>
    </Modal>
    <ConfirmDialog v-if="deleting" title="Delete guest program?" confirm-label="Delete" :busy="busy"
      :message="`Delete ${deleting.name}? A guest program with teams can’t be deleted. Remove its teams first, or make it inactive instead.`"
      @confirm="doDelete" @close="deleting = null" />
  </section>
</template>
