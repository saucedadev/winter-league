<script setup>
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { dateRange } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const toast = useToast();
const seasons = ref([]);
const divisions = ref([]);

async function load() {
  try {
    const [s, d] = await Promise.all([api.get('/league/seasons'), api.get('/league/divisions')]);
    seasons.value = s.data.seasons;
    divisions.value = d.data.divisions;
  } catch (err) { toast.error(errorMessage(err)); }
}
onMounted(load);

// ---- seasons ----
const seasonEditor = ref(null);
const divisionEditor = ref(null);
const saving = ref(false);
const formError = ref('');

function openSeason(s) {
  formError.value = '';
  seasonEditor.value = s
    ? { id: s.id, form: { name: s.name, startDate: s.startDate, endDate: s.endDate } }
    : { id: null, form: { name: '', startDate: '', endDate: '', isActive: !seasons.value.some((x) => x.isActive) } };
}
async function saveSeason() {
  formError.value = '';
  saving.value = true;
  try {
    const f = seasonEditor.value.form;
    if (seasonEditor.value.id) await api.put(`/league/seasons/${seasonEditor.value.id}`, f);
    else await api.post('/league/seasons', f);
    toast.success('Season saved.');
    seasonEditor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}
async function activate(s) {
  try { await api.put(`/league/seasons/${s.id}`, { isActive: true }); toast.success(`${s.name} is now the active season.`); await load(); }
  catch (err) { toast.error(errorMessage(err)); }
}

// ---- divisions ----
function openDivision(d) {
  formError.value = '';
  divisionEditor.value = d
    ? { id: d.id, form: { name: d.name, grade: d.grade || '', gender: d.gender, sortOrder: d.sortOrder, isActive: d.isActive } }
    : { id: null, form: { name: '', grade: '', gender: 'boys' } };
}
async function saveDivision() {
  formError.value = '';
  saving.value = true;
  try {
    const f = divisionEditor.value.form;
    if (divisionEditor.value.id) await api.put(`/league/divisions/${divisionEditor.value.id}`, f);
    else await api.post('/league/divisions', f);
    toast.success('Division saved.');
    divisionEditor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

const deleting = ref(null); // { kind, item }
const busy = ref(false);
async function doDelete() {
  busy.value = true;
  const { kind, item } = deleting.value;
  try { await api.delete(`/league/${kind}/${item.id}`); toast.success(`${item.name} deleted.`); deleting.value = null; await load(); }
  catch (err) { toast.error(errorMessage(err)); deleting.value = null; }
  finally { busy.value = false; }
}
const genderLabel = { boys: 'Boys', girls: 'Girls', coed: 'Coed' };
</script>

<template>
  <div>
    <PageHeader title="League setup" subtitle="Seasons and divisions apply to every program." />

    <div class="grid gap-6 lg:grid-cols-2">
      <section>
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-semibold">Seasons</h2>
          <button class="btn btn-secondary !py-1.5" @click="openSeason()">Add season</button>
        </div>
        <p class="text-sm text-text-muted mb-3">One season is active at a time. Gym slots can only be entered inside its dates.</p>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="s in seasons" :key="s.id" class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div class="flex-1 min-w-[10rem]">
              <p class="font-medium text-sm">{{ s.name }}
                <span v-if="s.isActive" class="ml-1 rounded-full bg-accent text-accent-contrast px-2 py-0.5 text-xs">Active</span></p>
              <p class="text-xs text-text-muted">{{ dateRange(s.startDate, s.endDate) }}, {{ s.endDate.slice(0, 4) }} · {{ s.slotCount }} gym slots</p>
            </div>
            <button v-if="!s.isActive" class="btn btn-ghost" @click="activate(s)">Make active</button>
            <button class="btn btn-ghost" @click="openSeason(s)">Edit</button>
            <button v-if="!s.slotCount" class="btn btn-ghost hover:!text-danger" @click="deleting = { kind: 'seasons', item: s }">Delete</button>
          </li>
          <li v-if="!seasons.length" class="px-4 py-6 text-sm text-text-muted text-center">No seasons yet. Add one to open gym slot entry.</li>
        </ul>
      </section>

      <section>
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-semibold">Divisions</h2>
          <button class="btn btn-secondary !py-1.5" @click="openDivision()">Add division</button>
        </div>
        <p class="text-sm text-text-muted mb-3">Teams play within their division.</p>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="d in divisions" :key="d.id" class="px-4 py-2.5 flex items-center gap-3" :class="!d.isActive && 'opacity-60'">
            <div class="flex-1">
              <p class="font-medium text-sm">{{ d.name }} <span v-if="!d.isActive" class="text-xs text-text-muted">(inactive)</span></p>
              <p class="text-xs text-text-muted">{{ genderLabel[d.gender] }}<template v-if="d.grade"> · Grade {{ d.grade }}</template> · {{ d.teamCount }} team{{ d.teamCount === 1 ? '' : 's' }}</p>
            </div>
            <button class="btn btn-ghost" @click="openDivision(d)">Edit</button>
            <button v-if="!d.teamCount" class="btn btn-ghost hover:!text-danger" @click="deleting = { kind: 'divisions', item: d }">Delete</button>
          </li>
        </ul>
      </section>
    </div>

    <Modal v-if="seasonEditor" :title="seasonEditor.id ? 'Edit season' : 'Add season'" @close="seasonEditor = null">
      <form id="season-form" class="space-y-4" @submit.prevent="saveSeason">
        <div><label class="label" for="sn-name">Season name</label><input id="sn-name" v-model="seasonEditor.form.name" class="input" required placeholder="Winter 2026–27" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="sn-start">First day</label><input id="sn-start" v-model="seasonEditor.form.startDate" type="date" class="input" required /></div>
          <div><label class="label" for="sn-end">Last day</label><input id="sn-end" v-model="seasonEditor.form.endDate" type="date" class="input" :min="seasonEditor.form.startDate" required /></div>
        </div>
        <label v-if="!seasonEditor.id" class="flex items-center gap-2 text-sm"><input v-model="seasonEditor.form.isActive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Make this the active season</label>
        <p v-if="formError" class="text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="seasonEditor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="season-form" :disabled="saving">Save season</button>
      </template>
    </Modal>

    <Modal v-if="divisionEditor" :title="divisionEditor.id ? 'Edit division' : 'Add division'" @close="divisionEditor = null">
      <form id="div-form" class="grid gap-4 grid-cols-2" @submit.prevent="saveDivision">
        <div class="col-span-2"><label class="label" for="dv-name">Division name</label><input id="dv-name" v-model="divisionEditor.form.name" class="input" required placeholder="6th Grade Girls" /></div>
        <div><label class="label" for="dv-grade">Grade</label><input id="dv-grade" v-model="divisionEditor.form.grade" class="input" placeholder="6" /></div>
        <div>
          <label class="label" for="dv-gender">Players</label>
          <select id="dv-gender" v-model="divisionEditor.form.gender" class="input"><option value="boys">Boys</option><option value="girls">Girls</option><option value="coed">Coed</option></select>
        </div>
        <label v-if="divisionEditor.id" class="col-span-2 flex items-center gap-2 text-sm"><input v-model="divisionEditor.form.isActive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Active (inactive divisions can’t get new teams)</label>
        <p v-if="formError" class="col-span-2 text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="divisionEditor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="div-form" :disabled="saving">Save division</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="deleting" :title="`Delete ${deleting.kind === 'seasons' ? 'season' : 'division'}?`" confirm-label="Delete" :busy="busy"
      :message="`Delete ${deleting.item.name}? This can’t be undone.`" @confirm="doDelete" @close="deleting = null" />
  </div>
</template>
