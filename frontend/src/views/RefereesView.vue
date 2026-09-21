<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { dateRange, money, timestamp } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import Modal from '../components/Modal.vue';

const toast = useToast();
const data = ref(null);
const loading = ref(true);
const showInactive = ref(false);

async function load() {
  loading.value = true;
  try { data.value = (await api.get('/referees/roster')).data; }
  catch (err) { toast.error(errorMessage(err)); }
  finally { loading.value = false; }
}
onMounted(load);
const referees = computed(() => (data.value?.referees || []).filter((r) => showInactive.value || r.isActive));
const inactiveCount = computed(() => (data.value?.referees || []).filter((r) => !r.isActive).length);
const rateOf = (r) => (r.payRateCents == null ? data.value.settings.defaultPayCents : r.payRateCents);

// ---- settings ----
const settingsOpen = ref(false);
const settingsForm = ref(null);
function openSettings() {
  const s = data.value.settings;
  settingsForm.value = { refereesPerGame: s.refereesPerGame, defaultPay: (s.defaultPayCents / 100).toFixed(2), checkInOpensMinutes: s.checkInOpensMinutes, checkInClosesMinutes: s.checkInClosesMinutes };
  settingsOpen.value = true;
}
const toCents = (v) => (v === '' || v == null ? null : Math.round(Number(v) * 100));
async function saveSettings() {
  const f = settingsForm.value;
  try {
    await api.put('/referees/settings', { refereesPerGame: f.refereesPerGame, defaultPayCents: toCents(f.defaultPay), checkInOpensMinutes: f.checkInOpensMinutes, checkInClosesMinutes: f.checkInClosesMinutes });
    toast.success('Referee settings saved.');
    settingsOpen.value = false;
    await load();
  } catch (err) { toast.error(errorMessage(err)); }
}

// ---- add / edit ----
const editor = ref(null);
const saving = ref(false);
const formError = ref('');
const created = ref(null);
function openNew() { formError.value = ''; editor.value = { id: null, form: { firstName: '', lastName: '', email: '', phone: '', rate: '' } }; }
function openEdit(r) {
  formError.value = '';
  editor.value = { id: r.id, name: `${r.firstName} ${r.lastName}`, form: { email: r.email, phone: r.phone || '', rate: r.payRateCents == null ? '' : (r.payRateCents / 100).toFixed(2), notes: r.notes || '', isActive: r.isActive } };
}
async function save() {
  saving.value = true;
  formError.value = '';
  const f = editor.value.form;
  try {
    if (editor.value.id) {
      await api.put(`/referees/roster/${editor.value.id}`, { email: f.email, phone: f.phone, payRateCents: toCents(f.rate), notes: f.notes, isActive: f.isActive });
      toast.success(f.isActive ? 'Referee updated.' : 'Referee deactivated and removed from upcoming games.');
    } else {
      const { data: r } = await api.post('/referees/roster', { firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone, payRateCents: toCents(f.rate) });
      created.value = { ...r.referee, temporaryPassword: r.temporaryPassword };
    }
    editor.value = null;
    await load();
  } catch (err) { formError.value = errorMessage(err); }
  finally { saving.value = false; }
}
</script>

<template>
  <div>
    <PageHeader title="Referees" subtitle="The officials roster, their pay rates, and the league’s referee settings.">
      <RouterLink to="/payouts" class="btn btn-secondary">Payouts</RouterLink>
      <button class="btn btn-secondary" :disabled="!data" @click="openSettings">Settings</button>
      <button class="btn btn-primary" @click="openNew">Add referee</button>
    </PageHeader>

    <p v-if="loading && !data" class="text-sm text-text-muted">Loading…</p>
    <template v-else-if="data">
      <div class="card card-blocky p-4 mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <p><span class="text-text-muted">Referees per game</span> <span class="font-semibold ml-1">{{ data.settings.refereesPerGame }}</span></p>
        <p><span class="text-text-muted">Default pay</span> <span class="font-semibold ml-1">{{ money(data.settings.defaultPayCents) }} per game</span></p>
        <p><span class="text-text-muted">Check-in window</span> <span class="font-semibold ml-1">{{ data.settings.checkInOpensMinutes }} min before to {{ data.settings.checkInClosesMinutes }} min after tip-off</span></p>
      </div>

      <label v-if="inactiveCount" class="text-sm flex items-center gap-2 mb-3"><input v-model="showInactive" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" /> Show {{ inactiveCount }} inactive</label>
      <EmptyState v-if="!referees.length" title="No referees yet" body="Add the officials who work league games. Each gets a username and a temporary password to sign in with.">
        <button class="btn btn-primary" @click="openNew">Add referee</button>
      </EmptyState>
      <div v-else class="card card-blocky overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-text-muted border-b border-border">
            <th class="px-4 py-2 font-medium">Referee</th><th class="px-4 py-2 font-medium">Contact</th>
            <th class="px-4 py-2 font-medium text-right">Upcoming</th><th class="px-4 py-2 font-medium text-right">Worked</th><th class="px-4 py-2 font-medium text-right">No-shows</th>
            <th class="px-4 py-2 font-medium text-right">Rate</th><th class="px-4 py-2 font-medium">Unavailable</th><th class="px-4 py-2"><span class="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            <tr v-for="r in referees" :key="r.id" class="border-b border-border last:border-0 align-top" :class="!r.isActive && 'opacity-60'">
              <td class="px-4 py-2.5">
                <p class="font-medium">{{ r.firstName }} {{ r.lastName }}<span v-if="!r.isActive" class="badge badge-outline ml-2">Inactive</span></p>
                <p class="text-xs text-text-muted">{{ r.username }} · {{ r.lastLoginAt ? `last signed in ${timestamp(r.lastLoginAt)}` : 'hasn’t signed in yet' }}</p>
              </td>
              <td class="px-4 py-2.5 text-xs"><p>{{ r.email }}</p><p class="text-text-muted">{{ r.phone || '—' }}</p></td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ r.upcoming }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ r.worked }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums" :class="r.noShows && 'font-bold'">{{ r.noShows }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ money(rateOf(r)) }}<span v-if="r.payRateCents == null" class="block text-xs text-text-muted">default</span></td>
              <td class="px-4 py-2.5 text-xs">
                <p v-for="u in r.unavailable.slice(0, 3)" :key="u.id">{{ dateRange(u.startDate, u.endDate) }}<span v-if="u.note" class="text-text-muted"> · {{ u.note }}</span></p>
                <p v-if="r.unavailable.length > 3" class="text-text-muted">+{{ r.unavailable.length - 3 }} more</p>
                <p v-if="!r.unavailable.length" class="text-text-muted">—</p>
              </td>
              <td class="px-4 py-2.5 text-right"><button class="btn btn-ghost text-xs" @click="openEdit(r)">Edit</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Modal v-if="editor" :title="editor.id ? `Edit ${editor.name}` : 'Add referee'" @close="editor = null">
      <form id="ref-form" class="space-y-4" @submit.prevent="save">
        <div v-if="!editor.id" class="grid grid-cols-2 gap-3">
          <div><label class="label" for="rf-first">First name</label><input id="rf-first" v-model="editor.form.firstName" class="input" required /></div>
          <div><label class="label" for="rf-last">Last name</label><input id="rf-last" v-model="editor.form.lastName" class="input" required /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="rf-email">Email</label><input id="rf-email" v-model="editor.form.email" type="email" class="input" required /></div>
          <div><label class="label" for="rf-phone">Phone <span class="font-normal text-text-muted">(optional)</span></label><input id="rf-phone" v-model="editor.form.phone" type="tel" class="input" /></div>
        </div>
        <div>
          <label class="label" for="rf-rate">Pay per game <span class="font-normal text-text-muted">(blank = league default, {{ money(data.settings.defaultPayCents) }})</span></label>
          <input id="rf-rate" v-model="editor.form.rate" class="input" inputmode="decimal" placeholder="e.g. 45.00" />
        </div>
        <div v-if="editor.id"><label class="label" for="rf-notes">Notes</label><textarea id="rf-notes" v-model="editor.form.notes" rows="2" class="input" placeholder="Certifications, preferred divisions…" /></div>
        <label v-if="editor.id" class="text-sm flex items-start gap-2">
          <input v-model="editor.form.isActive" type="checkbox" class="w-4 h-4 mt-0.5 accent-[var(--color-accent)]" />
          <span>Active<span class="block text-xs text-text-muted">Deactivating stops them signing in and removes them from every upcoming game.</span></span>
        </label>
        <p v-if="formError" class="text-sm text-danger" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="editor = null">Cancel</button>
        <button class="btn btn-primary" type="submit" form="ref-form" :disabled="saving">{{ saving ? 'Saving…' : editor.id ? 'Save' : 'Add referee' }}</button>
      </template>
    </Modal>

    <Modal v-if="created" title="Referee added" @close="created = null">
      <p class="text-sm mb-3">Share these sign-in details with {{ created.firstName }}. The temporary password is shown only once; they’ll choose their own the first time they sign in.</p>
      <dl class="rounded-lg border border-border p-3 text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt class="text-text-muted">Username</dt><dd class="font-mono font-semibold">{{ created.username }}</dd>
        <dt class="text-text-muted">Temporary password</dt><dd class="font-mono font-semibold">{{ created.temporaryPassword }}</dd>
      </dl>
      <template #footer><button class="btn btn-primary" @click="created = null">Done</button></template>
    </Modal>

    <Modal v-if="settingsOpen" title="Referee settings" @close="settingsOpen = false">
      <form id="rs-form" class="space-y-4" @submit.prevent="saveSettings">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="rs-per">Referees per game</label><input id="rs-per" v-model.number="settingsForm.refereesPerGame" type="number" min="1" max="4" class="input" /></div>
          <div><label class="label" for="rs-pay">Default pay per game ($)</label><input id="rs-pay" v-model="settingsForm.defaultPay" class="input" inputmode="decimal" /></div>
          <div><label class="label" for="rs-open">Check-in opens (min before)</label><input id="rs-open" v-model.number="settingsForm.checkInOpensMinutes" type="number" min="0" class="input" /></div>
          <div><label class="label" for="rs-close">Check-in closes (min after)</label><input id="rs-close" v-model.number="settingsForm.checkInClosesMinutes" type="number" min="0" class="input" /></div>
        </div>
        <p class="text-xs text-text-muted">Changing pay only affects games checked in from now on. Games already worked keep the rate they were worked at. Lowering referees per game removes only empty slots.</p>
      </form>
      <template #footer>
        <button class="btn btn-secondary" @click="settingsOpen = false">Cancel</button>
        <button class="btn btn-primary" type="submit" form="rs-form">Save settings</button>
      </template>
    </Modal>
  </div>
</template>
