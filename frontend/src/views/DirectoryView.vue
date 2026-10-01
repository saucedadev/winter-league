<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import { formatPhone } from '../utils/phone';
import PageHeader from '../components/PageHeader.vue';
import Modal from '../components/Modal.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import ProgramPicker from '../components/ProgramPicker.vue';
import PhoneInput from '../components/PhoneInput.vue';

// A program's contact list (a Rolodex). Contacts aren't app accounts and
// can't sign in; the System Admin still creates accounts under Users.
const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();
const contacts = ref([]);
const loading = ref(true);
const search = ref('');
const roleFilter = ref('');
const showProgram = computed(() => auth.isSuperAdmin && !ctx.programId);

async function load() {
  loading.value = true;
  try { contacts.value = (await api.get('/directory', { params: ctx.query })).data.contacts; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);
watch(() => ctx.programId, load);

const customRoles = computed(() => [...new Set(contacts.value.filter((c) => c.role === 'other' && c.roleOther).map((c) => c.roleOther))].sort());
const roleOptions = computed(() => [['coach', 'Coach'], ['referee', 'Referee'], ...customRoles.value.map((r) => [`other:${r}`, r]), ['none', 'No role']]);
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return contacts.value.filter((c) => {
    if (roleFilter.value) {
      if (roleFilter.value === 'none' && c.role) return false;
      if (roleFilter.value.startsWith('other:') && !(c.role === 'other' && c.roleOther === roleFilter.value.slice(6))) return false;
      if (['coach', 'referee'].includes(roleFilter.value) && c.role !== roleFilter.value) return false;
    }
    if (!q) return true;
    return [c.firstName, c.lastName, `${c.firstName} ${c.lastName}`, c.email, c.phone, c.roleLabel, c.programName].some((v) => v && String(v).toLowerCase().includes(q));
  });
});

// ---- add / edit ----
const editor = ref(null);
const saving = ref(false);
const formError = ref('');
function open(c) {
  formError.value = '';
  editor.value = c
    ? { id: c.id, form: { programId: c.programId, firstName: c.firstName, lastName: c.lastName, email: c.email || '', phone: c.phone || '', role: c.role || '', roleOther: c.roleOther || '' } }
    : { id: null, form: { programId: ctx.programId || '', firstName: '', lastName: '', email: '', phone: '', role: '', roleOther: '' } };
}
async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const f = { ...editor.value.form, role: editor.value.form.role || null };
    if (f.role !== 'other') f.roleOther = null;
    if (editor.value.id) await api.put(`/directory/${editor.value.id}`, f);
    else await api.post('/directory', f);
    toast.success(editor.value.id ? 'Contact saved.' : `Added ${f.firstName} ${f.lastName} to the directory.`);
    editor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}

// ---- delete ----
const deleting = ref(null);
const busy = ref(false);
async function doDelete() {
  busy.value = true;
  try {
    const { data } = await api.delete(`/directory/${deleting.value.id}`);
    toast.success(`Removed from the directory.${data.teamsCleared ? ` ${data.teamsCleared} team${data.teamsCleared === 1 ? ' now has' : 's now have'} no head coach.` : ''}`);
    deleting.value = null;
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}

// ---- a Coach account now exists: move their teams over ----
async function switchToAccount(c) {
  busy.value = true;
  try {
    const { data } = await api.post(`/directory/${c.id}/switch-to-account`, { userId: c.matchingUserId });
    toast.success(`${c.firstName} ${c.lastName}’s Coach account is now head coach of ${data.teamsUpdated} team${data.teamsUpdated === 1 ? '' : 's'}.`);
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Directory" :subtitle="`Contacts for ${ctx.current ? ctx.current.name : auth.isSuperAdmin ? 'every program' : 'your program'}: people you need to reach. They don’t get an app account.`">
      <button class="btn btn-primary" :disabled="auth.isSuperAdmin && !ctx.programs.length" @click="open()">Add contact</button>
    </PageHeader>

    <div class="card card-blocky p-3 mb-4 flex flex-wrap items-center gap-2">
      <input v-model="search" type="search" class="input !w-auto flex-1 min-w-[12rem]" placeholder="Search name, email, phone, role" aria-label="Search the directory" />
      <select v-model="roleFilter" class="input !w-auto" aria-label="Filter by role">
        <option value="">All roles</option>
        <option v-for="[v, l] in roleOptions" :key="v" :value="v">{{ l }}</option>
      </select>
      <p class="text-xs text-text-muted ml-auto">{{ filtered.length }} contact{{ filtered.length === 1 ? '' : 's' }}</p>
    </div>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <EmptyState v-else-if="!contacts.length" title="No contacts yet"
      body="Add the people your program works with: coaches who don’t have an app account yet, referees, team managers, gym contacts. A coach added here can be set as a team’s head coach until their account is created.">
      <button class="btn btn-primary" @click="open()">Add contact</button>
    </EmptyState>
    <EmptyState v-else-if="!filtered.length" title="No contacts match" body="Try a different search or role." />

    <div v-else class="card card-blocky overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-text-muted border-b border-border">
          <tr>
            <th class="px-4 py-2.5 font-medium">Name</th>
            <th class="px-3 py-2.5 font-medium">Role</th>
            <th class="px-3 py-2.5 font-medium">Email</th>
            <th class="px-3 py-2.5 font-medium">Phone</th>
            <th class="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.id" class="border-b border-border last:border-0 align-top">
            <td class="px-4 py-2.5">
              <p class="font-medium">{{ c.firstName }} {{ c.lastName }}</p>
              <p v-if="showProgram" class="text-xs text-text-muted">{{ c.programName }}</p>
              <p v-if="c.coachOfCount" class="text-xs text-text-muted">Head coach: {{ c.coachOfTeams }}</p>
              <p v-if="c.coachOfCount && c.matchingUserId" class="text-xs mt-1">
                <span class="font-medium">Now has a Coach account.</span>
                <button class="underline ml-1" :disabled="busy" @click="switchToAccount(c)">Use the account for {{ c.coachOfCount === 1 ? 'their team' : 'their teams' }}</button>
              </p>
            </td>
            <td class="px-3 py-2.5">{{ c.roleLabel || '—' }}</td>
            <td class="px-3 py-2.5"><a v-if="c.email" :href="`mailto:${c.email}`" class="underline break-all">{{ c.email }}</a><span v-else class="text-text-muted">—</span></td>
            <td class="px-3 py-2.5 whitespace-nowrap"><a v-if="c.phone" :href="`tel:${c.phone}`" class="underline">{{ formatPhone(c.phone) }}</a><span v-else class="text-text-muted">—</span></td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap">
              <button class="btn btn-ghost" @click="open(c)">Edit</button>
              <button class="btn btn-ghost hover:!text-danger" @click="deleting = c">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="editor" :title="editor.id ? 'Edit contact' : 'Add contact'" @close="editor = null">
      <form id="contact-form" class="grid gap-4 grid-cols-2" @submit.prevent="save">
        <ProgramPicker v-if="!editor.id" v-model="editor.form.programId" class="col-span-2" />
        <div><label class="label" for="dc-first">First name</label><input id="dc-first" v-model="editor.form.firstName" class="input" required maxlength="60" autocomplete="off" /></div>
        <div><label class="label" for="dc-last">Last name</label><input id="dc-last" v-model="editor.form.lastName" class="input" required maxlength="60" autocomplete="off" /></div>
        <div class="col-span-2 sm:col-span-1"><label class="label" for="dc-email">Email <span class="font-normal text-text-muted">(optional)</span></label><input id="dc-email" v-model="editor.form.email" type="email" class="input" autocomplete="off" /></div>
        <div class="col-span-2 sm:col-span-1"><label class="label" for="dc-phone">Phone <span class="font-normal text-text-muted">(optional)</span></label><PhoneInput id="dc-phone" v-model="editor.form.phone" /></div>
        <div class="col-span-2 sm:col-span-1">
          <label class="label" for="dc-role">Role <span class="font-normal text-text-muted">(optional)</span></label>
          <select id="dc-role" v-model="editor.form.role" class="input">
            <option value="">No role</option>
            <option value="coach">Coach</option>
            <option value="referee">Referee</option>
            <option value="other">Other (type it in)…</option>
          </select>
        </div>
        <div v-if="editor.form.role === 'other'" class="col-span-2 sm:col-span-1">
          <label class="label" for="dc-role-other">Role name</label>
          <input id="dc-role-other" v-model="editor.form.roleOther" class="input" required maxlength="40" list="dc-custom-roles" placeholder="e.g. Team manager" autocomplete="off" />
          <datalist id="dc-custom-roles"><option v-for="r in customRoles" :key="r" :value="r" /></datalist>
        </div>
        <p v-if="editor.form.role === 'coach'" class="col-span-2 text-xs text-text-muted">A Coach from the directory can be picked as a team’s head coach (Teams page) until the league admin creates their Coach account.</p>
        <p class="col-span-2 text-xs text-text-muted">Adding someone here doesn’t give them an app account. Only the league admin can create accounts.</p>
        <p v-if="formError" class="col-span-2 text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="contact-form" :disabled="saving">{{ saving ? 'Saving…' : editor.id ? 'Save contact' : 'Add contact' }}</button>
      </template>
    </Modal>

    <ConfirmDialog v-if="deleting" title="Remove this contact?" confirm-label="Remove" :busy="busy"
      :message="`Remove ${deleting.firstName} ${deleting.lastName} from the directory?${deleting.coachOfCount ? ` They’re the head coach of ${deleting.coachOfTeams}, which will show no head coach.` : ''}`"
      @confirm="doDelete" @close="deleting = null" />
  </div>
</template>
