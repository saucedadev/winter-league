<script setup>
import { computed, onMounted, ref } from 'vue';
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
const venues = ref([]);
const loading = ref(true);
const canEdit = computed(() => auth.canManage);

async function load() {
  loading.value = true;
  try { venues.value = (await api.get('/venues', { params: ctx.query })).data.venues; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);

const address = (v) => [v.address, v.city, v.state, v.zip].filter(Boolean).join(', ');

// ---- venue editor ----
const editor = ref(null);
const saving = ref(false);
const formError = ref('');
function open(v) {
  formError.value = '';
  editor.value = v
    ? { id: v.id, form: { name: v.name, address: v.address || '', city: v.city || '', state: v.state || '', zip: v.zip || '', latitude: v.latitude ?? '', longitude: v.longitude ?? '', notes: v.notes || '', isActive: v.isActive } }
    : { id: null, form: { programId: ctx.programId || '', name: '', address: '', city: '', state: '', zip: '', latitude: '', longitude: '', notes: '', courtsText: 'Main court' } };
}
async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const f = { ...editor.value.form };
    if (!editor.value.id) { f.courts = f.courtsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean); delete f.courtsText; }
    if (editor.value.id) await api.put(`/venues/${editor.value.id}`, f);
    else await api.post('/venues', f);
    toast.success(editor.value.id ? 'Venue saved.' : `Added ${f.name}.`);
    editor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

// ---- courts ----
const courtName = ref({});
async function addCourt(v) {
  const name = (courtName.value[v.id] || '').trim();
  if (!name) return;
  try { await api.post(`/venues/${v.id}/courts`, { name }); courtName.value[v.id] = ''; toast.success(`Added ${name}.`); await load(); }
  catch (err) { toast.error(errorMessage(err)); }
}
async function removeCourt(c) {
  try { await api.delete(`/venues/courts/${c.id}`); toast.success(`Removed ${c.name}.`); await load(); }
  catch (err) { toast.error(errorMessage(err)); }
}
const renaming = ref(null); // { court, name, error }
function renameCourt(c) { renaming.value = { court: c, name: c.name, error: '' }; }
async function saveCourtName() {
  const r = renaming.value;
  const name = r.name.trim();
  if (!name || name === r.court.name) { renaming.value = null; return; }
  try { await api.put(`/venues/courts/${r.court.id}`, { name }); toast.success('Court renamed.'); renaming.value = null; await load(); }
  catch (err) { r.error = errorMessage(err); }
}

const deleting = ref(null);
const busy = ref(false);
async function doDelete() {
  busy.value = true;
  try { await api.delete(`/venues/${deleting.value.id}`); toast.success('Venue deleted.'); deleting.value = null; await load(); }
  catch (err) { toast.error(errorMessage(err)); deleting.value = null; }
  finally { busy.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Venues" :subtitle="canEdit ? 'Gyms your program can host league play in, and the courts at each one.' : 'Gyms your program uses for league play.'">
      <button v-if="canEdit" class="btn btn-primary" :disabled="auth.isSuperAdmin && !ctx.activePrograms.length" @click="open()">Add venue</button>
    </PageHeader>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!venues.length" title="No venues yet" :body="canEdit ? 'Add each gym your program can use. You’ll pick a venue and court whenever you enter gym slots.' : 'Your program director hasn’t added venues yet.'">
      <button v-if="canEdit" class="btn btn-primary" @click="open()">Add venue</button>
    </EmptyState>

    <div v-else class="grid gap-4 md:grid-cols-2">
      <article v-for="v in venues" :key="v.id" class="card card-blocky p-4" :class="!v.isActive && 'opacity-60'">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="font-semibold">{{ v.name }} <span v-if="!v.isActive" class="text-xs font-medium text-text-muted">(inactive)</span></h2>
            <p class="text-sm text-text-muted">{{ address(v) || 'No address yet' }}</p>
            <p v-if="auth.isSuperAdmin && !ctx.programId" class="text-xs text-text-muted mt-0.5">{{ v.programName }}</p>
          </div>
          <div v-if="canEdit" class="flex shrink-0">
            <button class="btn btn-ghost" @click="open(v)">Edit</button>
            <button class="btn btn-ghost hover:!text-danger" @click="deleting = v">Delete</button>
          </div>
        </div>
        <p v-if="v.notes" class="text-sm mt-2">{{ v.notes }}</p>
        <p v-if="canEdit && (v.latitude == null || v.longitude == null)" class="text-xs text-warning mt-2">Add map coordinates so travel distance can be checked when the schedule is built.</p>

        <div class="mt-3 pt-3 border-t border-border">
          <p class="text-xs text-text-muted mb-2">Courts</p>
          <ul class="flex flex-wrap gap-1.5">
            <li v-for="c in v.courts" :key="c.id" class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm">
              <button v-if="canEdit" class="hover:underline" :title="`Rename ${c.name}`" @click="renameCourt(c)">{{ c.name }}</button>
              <span v-else>{{ c.name }}</span>
              <button v-if="canEdit && v.courts.length > 1" class="text-text-muted hover:text-danger px-0.5" :aria-label="`Remove ${c.name}`" @click="removeCourt(c)">✕</button>
            </li>
          </ul>
          <form v-if="canEdit" class="flex gap-2 mt-2" @submit.prevent="addCourt(v)">
            <input v-model="courtName[v.id]" class="input !py-1" placeholder="New court name" :aria-label="`New court at ${v.name}`" />
            <button class="btn btn-secondary !py-1">Add court</button>
          </form>
        </div>
      </article>
    </div>

    <Modal v-if="editor" :title="editor.id ? 'Edit venue' : 'Add venue'" wide @close="editor = null">
      <form id="venue-form" class="grid gap-4 sm:grid-cols-2" @submit.prevent="save">
        <ProgramPicker v-if="!editor.id" v-model="editor.form.programId" class="sm:col-span-2" />
        <div class="sm:col-span-2"><label class="label" for="vf-name">Venue name</label><input id="vf-name" v-model="editor.form.name" class="input" required maxlength="80" /></div>
        <div class="sm:col-span-2"><label class="label" for="vf-addr">Street address</label><input id="vf-addr" v-model="editor.form.address" class="input" autocomplete="street-address" /></div>
        <div><label class="label" for="vf-city">City</label><input id="vf-city" v-model="editor.form.city" class="input" /></div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="label" for="vf-state">State</label><input id="vf-state" v-model="editor.form.state" class="input" maxlength="2" /></div>
          <div><label class="label" for="vf-zip">ZIP</label><input id="vf-zip" v-model="editor.form.zip" class="input" inputmode="numeric" maxlength="10" /></div>
        </div>
        <div><label class="label" for="vf-lat">Latitude <span class="font-normal text-text-muted">(optional)</span></label><input id="vf-lat" v-model="editor.form.latitude" class="input" inputmode="decimal" placeholder="41.8781" /></div>
        <div><label class="label" for="vf-lng">Longitude <span class="font-normal text-text-muted">(optional)</span></label><input id="vf-lng" v-model="editor.form.longitude" class="input" inputmode="decimal" placeholder="-87.6298" /></div>
        <p class="sm:col-span-2 -mt-2 text-xs text-text-muted">Right-click the gym in Google Maps and click the coordinates to copy them. The schedule builder uses these to keep travel reasonable.</p>
        <div v-if="!editor.id" class="sm:col-span-2">
          <label class="label" for="vf-courts">Courts</label>
          <textarea id="vf-courts" v-model="editor.form.courtsText" class="input" rows="2" placeholder="One per line, e.g. North court" />
          <p class="text-xs text-text-muted mt-1">One court per line (or comma-separated). You can add more later.</p>
        </div>
        <div class="sm:col-span-2"><label class="label" for="vf-notes">Notes <span class="font-normal text-text-muted">(optional)</span></label><input id="vf-notes" v-model="editor.form.notes" class="input" maxlength="200" placeholder="Parking, entrance, key contact…" /></div>
        <label v-if="editor.id" class="sm:col-span-2 flex items-center gap-2 text-sm">
          <input v-model="editor.form.isActive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Active (inactive venues can’t get new gym slots)
        </label>
        <p v-if="formError" class="sm:col-span-2 text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="venue-form" :disabled="saving">{{ saving ? 'Saving…' : editor.id ? 'Save venue' : 'Add venue' }}</button>
      </template>
    </Modal>

    <Modal v-if="renaming" title="Rename court" @close="renaming = null">
      <form id="court-form" @submit.prevent="saveCourtName">
        <label class="label" for="cr-name">Court name</label>
        <input id="cr-name" v-model="renaming.name" class="input" required maxlength="40" />
        <p v-if="renaming.error" class="text-sm text-danger mt-2" role="alert">{{ renaming.error }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="renaming = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="court-form">Save name</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="deleting" title="Delete venue?" confirm-label="Delete venue" :busy="busy"
      :message="`Delete ${deleting.name} and its courts? Venues that already have gym slots can’t be deleted — deactivate them instead.`"
      @confirm="doDelete" @close="deleting = null" />
  </div>
</template>
