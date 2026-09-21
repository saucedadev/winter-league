<script setup>
import PhoneInput from '../components/PhoneInput.vue';
import { formatPhone } from '../utils/phone';
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import PageHeader from '../components/PageHeader.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';

const ctx = useProgramContext();
const toast = useToast();
const loading = ref(true);
const activeCount = computed(() => ctx.activePrograms.length);
const atCap = computed(() => activeCount.value >= ctx.maxPrograms);

async function load() {
  loading.value = true;
  try { await ctx.load(true); } catch (err) { toast.error(errorMessage(err)); } finally { loading.value = false; }
}
onMounted(load);

const editor = ref(null);
const saving = ref(false);
const formError = ref('');
function open(p) {
  formError.value = '';
  editor.value = p
    ? { id: p.id, form: { name: p.name, shortCode: p.shortCode, city: p.city || '', contactEmail: p.contactEmail || '', contactPhone: p.contactPhone || '', isActive: p.isActive } }
    : { id: null, form: { name: '', shortCode: '', city: '', contactEmail: '', contactPhone: '' } };
}
async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const f = editor.value.form;
    if (editor.value.id) await api.put(`/programs/${editor.value.id}`, f);
    else await api.post('/programs', f);
    toast.success(editor.value.id ? 'Program saved.' : `Added ${f.name}.`);
    editor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

const deleting = ref(null);
const busy = ref(false);
async function doDelete() {
  busy.value = true;
  try { await api.delete(`/programs/${deleting.value.id}`); toast.success('Program deleted.'); deleting.value = null; await load(); }
  catch (err) { toast.error(errorMessage(err)); deleting.value = null; }
  finally { busy.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Programs" :subtitle="`${activeCount} of ${ctx.maxPrograms} league spots filled.`">
      <button class="btn btn-primary" :disabled="atCap" :title="atCap ? 'The league is full' : ''" @click="open()">Add program</button>
    </PageHeader>

    <div class="flex gap-1 mb-5" aria-hidden="true">
      <span v-for="i in ctx.maxPrograms" :key="i" class="h-2 flex-1 rounded-sm" :class="i <= activeCount ? 'bg-accent' : 'bg-border'" />
    </div>

    <p v-if="loading && !ctx.programs.length" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!ctx.programs.length" title="No programs yet" body="Add each member organization. Program Directors can then sign in and enter their venues, teams, and gym time.">
      <button class="btn btn-primary" @click="open()">Add program</button>
    </EmptyState>

    <div v-else class="card card-blocky overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-text-muted border-b border-border">
          <tr>
            <th class="px-4 py-2.5 font-medium">Program</th>
            <th class="px-3 py-2.5 font-medium">Contact</th>
            <th class="px-3 py-2.5 font-medium text-right">Directors</th>
            <th class="px-3 py-2.5 font-medium text-right">Venues</th>
            <th class="px-3 py-2.5 font-medium text-right">Teams</th>
            <th class="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in ctx.programs" :key="p.id" class="border-b border-border last:border-0" :class="!p.isActive && 'opacity-60'">
            <td class="px-4 py-2.5">
              <p class="font-medium">{{ p.name }} <span class="text-text-muted font-normal">{{ p.shortCode }}</span></p>
              <p class="text-xs text-text-muted">{{ p.city || '—' }}{{ p.isActive ? '' : ' · inactive' }}</p>
            </td>
            <td class="px-3 py-2.5 text-text-muted">{{ p.contactEmail || '—' }}<br v-if="p.contactPhone" />{{ formatPhone(p.contactPhone) }}</td>
            <td class="px-3 py-2.5 text-right" :class="!p.directorCount && p.isActive && 'text-warning font-medium'">{{ p.directorCount }}</td>
            <td class="px-3 py-2.5 text-right">{{ p.venueCount }}</td>
            <td class="px-3 py-2.5 text-right">{{ p.teamCount }}</td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap">
              <button class="btn btn-ghost" @click="open(p)">Edit</button>
              <button class="btn btn-ghost hover:!text-danger" @click="deleting = p">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="editor" :title="editor.id ? 'Edit program' : 'Add program'" @close="editor = null">
      <form id="prog-form" class="grid gap-4 sm:grid-cols-3" @submit.prevent="save">
        <div class="sm:col-span-2"><label class="label" for="pf-name">Program name</label><input id="pf-name" v-model="editor.form.name" class="input" required maxlength="80" /></div>
        <div><label class="label" for="pf-code">Short code</label><input id="pf-code" v-model="editor.form.shortCode" class="input uppercase" required maxlength="6" placeholder="NFH" /></div>
        <div class="sm:col-span-3"><label class="label" for="pf-city">City</label><input id="pf-city" v-model="editor.form.city" class="input" /></div>
        <div class="sm:col-span-2"><label class="label" for="pf-email">Contact email</label><input id="pf-email" v-model="editor.form.contactEmail" type="email" class="input" /></div>
        <div><label class="label" for="pf-phone">Contact phone</label><PhoneInput id="pf-phone" v-model="editor.form.contactPhone" /></div>
        <label v-if="editor.id" class="sm:col-span-3 flex items-center gap-2 text-sm"><input v-model="editor.form.isActive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Active in the league</label>
        <p class="sm:col-span-3 text-xs text-text-muted">The short code appears on schedules where space is tight.</p>
        <p v-if="formError" class="sm:col-span-3 text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="prog-form" :disabled="saving">{{ saving ? 'Saving…' : editor.id ? 'Save program' : 'Add program' }}</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="deleting" title="Delete program?" confirm-label="Delete program" :busy="busy"
      :message="`Delete ${deleting.name}? Programs that already have venues, teams, or users can’t be deleted — deactivate them instead.`"
      @confirm="doDelete" @close="deleting = null" />
  </div>
</template>
