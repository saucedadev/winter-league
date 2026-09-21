<script setup>
import { useBrandingStore } from '../stores/branding';
const branding = useBrandingStore();
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import { ROLE_LABELS, timestamp } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import Modal from '../components/Modal.vue';

const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();
const users = ref([]);
const loading = ref(true);
const search = ref('');
const roleFilter = ref('');
const showInactive = ref(false);

const PROGRAM_ROLES = ['program_director', 'league_coach'];
const ROLE_HELP = {
  super_admin: 'Runs the whole league. Can see and change everything.',
  program_director: 'Manages one program’s venues, teams, gym slots, and blackouts.',
  league_coach: 'Sees their program’s teams and venues. Schedule access arrives with the league schedule.',
  referee_assignor: 'Will assign officials to games once the schedule is published.',
  referee: 'Will see game assignments and check in once the schedule is published.',
};

async function load() {
  loading.value = true;
  try { users.value = (await api.get('/users')).data.users; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return users.value.filter((u) =>
    (showInactive.value || u.isActive) &&
    (!roleFilter.value || u.role === roleFilter.value) &&
    (!ctx.programId || u.programId === ctx.programId || !u.programId) &&
    (!q || `${u.firstName} ${u.lastName} ${u.username} ${u.email}`.toLowerCase().includes(q)));
});

const editor = ref(null);
const saving = ref(false);
const formError = ref('');
const credentials = ref(null); // { name, username, password }

function open(u) {
  formError.value = '';
  editor.value = u
    ? { id: u.id, self: u.id === auth.user.id, form: { firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone || '', role: u.role, programId: u.programId || '', isActive: u.isActive } }
    : { id: null, form: { firstName: '', lastName: '', email: '', phone: '', role: 'program_director', programId: ctx.programId || '' } };
}
async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const f = { ...editor.value.form };
    if (f.role === 'super_admin') f.programId = '';
    if (editor.value.id) {
      await api.put(`/users/${editor.value.id}`, f);
      toast.success('Account saved.');
    } else {
      const { data } = await api.post('/users', f);
      credentials.value = { name: `${data.user.firstName} ${data.user.lastName}`, username: data.user.username, password: data.temporaryPassword, isNew: true };
    }
    editor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}
async function resetPassword() {
  const u = users.value.find((x) => x.id === editor.value.id);
  try {
    const { data } = await api.post(`/users/${u.id}/reset-password`);
    editor.value = null;
    credentials.value = { name: `${u.firstName} ${u.lastName}`, username: u.username, password: data.temporaryPassword, isNew: false };
  } catch (err) { formError.value = errorMessage(err); }
}
async function copyCredentials() {
  const c = credentials.value;
  try {
    await navigator.clipboard.writeText(`${branding.appName} sign-in\nSite: ${window.location.origin}\nUsername: ${c.username}\nTemporary password: ${c.password}\nYou’ll choose your own password when you first sign in.`);
    toast.success('Copied sign-in details.');
  } catch { toast.error('Couldn’t copy. Select the text instead.'); }
}
</script>

<template>
  <div>
    <PageHeader title="Users" :subtitle="`${branding.appName} accounts only. Gym Hive accounts are separate.`">
      <button class="btn btn-primary" @click="open()">Add user</button>
    </PageHeader>

    <div class="card card-blocky px-3 py-2.5 mb-4 flex flex-wrap items-center gap-3">
      <input v-model="search" type="search" class="input !w-full sm:!w-64" placeholder="Search name, username, email" aria-label="Search users" />
      <select v-model="roleFilter" class="input !w-auto" aria-label="Filter by role">
        <option value="">All roles</option>
        <option v-for="(label, key) in ROLE_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <label class="text-sm flex items-center gap-2"><input v-model="showInactive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Show inactive</label>
      <span class="text-xs text-text-muted ml-auto">{{ filtered.length }} shown</span>
    </div>

    <p v-if="loading" class="text-sm text-text-muted">Loading…</p>
    <div v-else class="card card-blocky overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-text-muted border-b border-border">
          <tr>
            <th class="px-4 py-2.5 font-medium">Name</th>
            <th class="px-3 py-2.5 font-medium">Role</th>
            <th class="px-3 py-2.5 font-medium">Program</th>
            <th class="px-3 py-2.5 font-medium">Last sign-in</th>
            <th class="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id" class="border-b border-border last:border-0" :class="!u.isActive && 'opacity-55'">
            <td class="px-4 py-2.5">
              <p class="font-medium">{{ u.firstName }} {{ u.lastName }} <span v-if="u.id === auth.user.id" class="text-xs text-text-muted">(you)</span></p>
              <p class="text-xs text-text-muted">{{ u.username }} · {{ u.email }}</p>
            </td>
            <td class="px-3 py-2.5">{{ ROLE_LABELS[u.role] }}<span v-if="!u.isActive" class="block text-xs text-text-muted">Inactive</span></td>
            <td class="px-3 py-2.5 text-text-muted">{{ u.programName || 'League-wide' }}</td>
            <td class="px-3 py-2.5 text-text-muted whitespace-nowrap">{{ u.lastLoginAt ? timestamp(u.lastLoginAt) : 'Never' }}<span v-if="u.mustChangePassword" class="block text-xs text-warning">Temporary password</span></td>
            <td class="px-3 py-2.5 text-right"><button class="btn btn-ghost" @click="open(u)">Edit</button></td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="5" class="px-4 py-6 text-center text-text-muted">No accounts match.</td></tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="editor" :title="editor.id ? 'Edit account' : 'Add user'" @close="editor = null">
      <form id="user-form" class="grid gap-4 grid-cols-2" @submit.prevent="save">
        <div><label class="label" for="uf-first">First name</label><input id="uf-first" v-model="editor.form.firstName" class="input" required autocomplete="off" /></div>
        <div><label class="label" for="uf-last">Last name</label><input id="uf-last" v-model="editor.form.lastName" class="input" required autocomplete="off" /></div>
        <div class="col-span-2 sm:col-span-1"><label class="label" for="uf-email">Email</label><input id="uf-email" v-model="editor.form.email" type="email" class="input" required autocomplete="off" /></div>
        <div class="col-span-2 sm:col-span-1"><label class="label" for="uf-phone">Phone <span class="font-normal text-text-muted">(optional)</span></label><input id="uf-phone" v-model="editor.form.phone" type="tel" class="input" autocomplete="off" /></div>
        <div class="col-span-2">
          <label class="label" for="uf-role">Role</label>
          <select id="uf-role" v-model="editor.form.role" class="input" :disabled="editor.self">
            <option v-for="(label, key) in ROLE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
          <p class="text-xs text-text-muted mt-1">{{ ROLE_HELP[editor.form.role] }}</p>
        </div>
        <div v-if="editor.form.role !== 'super_admin'" class="col-span-2">
          <label class="label" for="uf-program">Program{{ PROGRAM_ROLES.includes(editor.form.role) ? '' : ' (optional)' }}</label>
          <select id="uf-program" v-model="editor.form.programId" class="input" :required="PROGRAM_ROLES.includes(editor.form.role)">
            <option value="">{{ PROGRAM_ROLES.includes(editor.form.role) ? 'Choose a program' : 'League-wide' }}</option>
            <option v-for="p in ctx.programs" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <label v-if="editor.id && !editor.self" class="col-span-2 flex items-center gap-2 text-sm"><input v-model="editor.form.isActive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Active (inactive accounts can’t sign in)</label>
        <p v-if="!editor.id" class="col-span-2 text-xs text-text-muted">A username and temporary password are created for you to share. They’ll pick their own password at first sign-in.</p>
        <p v-if="formError" class="col-span-2 text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button v-if="editor.id" class="btn btn-ghost mr-auto" @click="resetPassword">Issue temporary password</button>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="user-form" :disabled="saving">{{ saving ? 'Saving…' : editor.id ? 'Save account' : 'Create account' }}</button>
      </template>
    </Modal>

    <Modal v-if="credentials" :title="credentials.isNew ? 'Account created' : 'Temporary password issued'" @close="credentials = null">
      <p class="text-sm mb-3">Share these with {{ credentials.name }}. The password is shown only once.</p>
      <dl class="card card-blocky p-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-text-muted">Username</dt><dd class="font-semibold select-all">{{ credentials.username }}</dd>
        <dt class="text-text-muted">Temporary password</dt><dd class="font-semibold select-all">{{ credentials.password }}</dd>
      </dl>
      <template #footer>
        <button class="btn btn-secondary" @click="copyCredentials">Copy sign-in details</button>
        <button class="btn btn-primary" @click="credentials = null">Done</button>
      </template>
    </Modal>
  </div>
</template>
