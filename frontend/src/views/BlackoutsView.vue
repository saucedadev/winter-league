<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import { dateRange, todayISO } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ProgramPicker from '../components/ProgramPicker.vue';

const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();
const list = ref([]);
const loading = ref(true);
const showPast = ref(false);
const today = todayISO();

const visible = computed(() => list.value.filter((b) => showPast.value || b.endDate >= today));
const pastCount = computed(() => list.value.filter((b) => b.endDate < today).length);

async function load() {
  loading.value = true;
  try { list.value = (await api.get('/blackouts', { params: ctx.query })).data.blackouts; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);

const editor = ref(null);
const venues = ref([]);
const saving = ref(false);
const formError = ref('');

async function venuesFor(programId) {
  if (!programId) return [];
  return (await api.get('/venues', { params: { programId } })).data.venues;
}
async function open(b) {
  formError.value = '';
  const programId = b?.programId || ctx.programId || '';
  venues.value = await venuesFor(programId);
  editor.value = b
    ? { id: b.id, form: { programId, venueId: b.venueId || '', startDate: b.startDate, endDate: b.endDate, reason: b.reason } }
    : { id: null, form: { programId, venueId: '', startDate: today, endDate: today, reason: '' } };
}
watch(() => editor.value?.form.programId, async (pid, old) => {
  if (editor.value && !editor.value.id && pid && pid !== old) { venues.value = await venuesFor(pid); editor.value.form.venueId = ''; }
});
watch(() => editor.value?.form.startDate, (s) => {
  const f = editor.value?.form;
  if (f && s && f.endDate < s) f.endDate = s;
});

async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const f = editor.value.form;
    const { data } = editor.value.id ? await api.put(`/blackouts/${editor.value.id}`, f) : await api.post('/blackouts', f);
    const n = data.blackout.affectedSlots;
    const gm = data.affectedGames;
    toast.success(`Blackout saved.${n ? ` ${n} gym slot${n === 1 ? ' is' : 's are'} now marked blacked out.` : ''}`);
    if (gm) toast.show(`${gm} published game${gm === 1 ? ' falls' : 's fall'} on these dates. The league admin will see ${gm === 1 ? 'it' : 'them'} flagged in the schedule builder.`, 'error', 8000);
    editor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

const deleting = ref(null);
const busy = ref(false);
async function doDelete() {
  busy.value = true;
  try { await api.delete(`/blackouts/${deleting.value.id}`); toast.success('Blackout removed.'); deleting.value = null; await load(); }
  catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Blackout dates" subtitle="Days a gym can’t be used. Gym slots on these dates are kept but marked blacked out, and weekly repeats skip them.">
      <button class="btn btn-primary" :disabled="auth.isSuperAdmin && !ctx.activePrograms.length" @click="open()">Add blackout</button>
    </PageHeader>

    <div v-if="pastCount" class="mb-3">
      <label class="text-sm flex items-center gap-2"><input v-model="showPast" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Show {{ pastCount }} past blackout{{ pastCount === 1 ? '' : 's' }}</label>
    </div>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!visible.length" title="No upcoming blackouts" body="Add holidays, building closures, or school events so no one schedules league play on those days.">
      <button class="btn btn-primary" @click="open()">Add blackout</button>
    </EmptyState>
    <ul v-else class="card card-blocky divide-y divide-border">
      <li v-for="b in visible" :key="b.id" class="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1" :class="b.endDate < today && 'opacity-60'">
        <span class="w-1.5 self-stretch rounded-sm bg-unavailable" aria-hidden="true" />
        <div class="min-w-[9rem]">
          <p class="font-semibold text-sm">{{ dateRange(b.startDate, b.endDate) }}</p>
          <p class="text-xs text-text-muted">{{ b.startDate.slice(0, 4) }}</p>
        </div>
        <div class="flex-1 min-w-[12rem]">
          <p class="text-sm font-medium">{{ b.reason }}</p>
          <p class="text-xs text-text-muted">{{ b.venueName || 'All venues' }}<template v-if="auth.isSuperAdmin && !ctx.programId"> · {{ b.programName }}</template>
            · {{ b.affectedSlots }} slot{{ b.affectedSlots === 1 ? '' : 's' }} affected</p>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-ghost" @click="open(b)">Edit</button>
          <button class="btn btn-ghost hover:!text-danger" @click="deleting = b">Remove</button>
        </div>
      </li>
    </ul>

    <Modal v-if="editor" :title="editor.id ? 'Edit blackout' : 'Add blackout'" @close="editor = null">
      <form id="bo-form" class="space-y-4" @submit.prevent="save">
        <ProgramPicker v-if="!editor.id" v-model="editor.form.programId" />
        <div>
          <label class="label" for="bo-venue">Applies to</label>
          <select id="bo-venue" v-model="editor.form.venueId" class="input">
            <option value="">Every venue in the program</option>
            <option v-for="v in venues" :key="v.id" :value="v.id">{{ v.name }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="bo-start">First day</label><input id="bo-start" v-model="editor.form.startDate" type="date" class="input" required /></div>
          <div><label class="label" for="bo-end">Last day</label><input id="bo-end" v-model="editor.form.endDate" type="date" class="input" :min="editor.form.startDate" required /></div>
        </div>
        <div>
          <label class="label" for="bo-reason">Reason</label>
          <input id="bo-reason" v-model="editor.form.reason" class="input" maxlength="120" placeholder="e.g. School holiday concert" required />
        </div>
        <p v-if="formError" class="text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="bo-form" :disabled="saving">{{ saving ? 'Saving…' : 'Save blackout' }}</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="deleting" title="Remove blackout?" confirm-label="Remove blackout" :busy="busy"
      :message="`${deleting.reason} (${dateRange(deleting.startDate, deleting.endDate)}). ${deleting.affectedSlots ? `${deleting.affectedSlots} gym slot(s) on these dates become usable again.` : ''}`"
      @confirm="doDelete" @close="deleting = null" />
  </div>
</template>
