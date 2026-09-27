<script setup>
import { computed, ref } from 'vue';
import { api, errorMessage } from '../api/client';
import { useToast } from '../stores/toast';
import { timestamp, longDate, todayISO } from '../utils/format';
import Modal from './Modal.vue';

// The System Admin's side of draft review: share the draft with Program
// Directors, follow each program's sign-off, answer flags, and sign off for
// programs that have no director. `review` comes from GET /runs/:id/review.
const props = defineProps({ runId: { type: String, required: true }, review: { type: Object, default: null } });
const emit = defineEmits(['updated']);
const toast = useToast();

const plusDays = (n) => { const d = new Date(`${todayISO()}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const deadline = ref(props.review?.deadline || plusDays(7));
const busy = ref('');

async function share() {
  busy.value = 'share';
  try {
    const { data } = await api.post(`/schedule/runs/${props.runId}/share`, { deadline: deadline.value || null });
    toast.success(props.review?.shared ? 'Deadline updated.' : `Shared with ${data.review.counts.total} programs. Their directors have been emailed.`);
    editingDeadline.value = false;
    emit('updated', data.review);
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = ''; }
}
const editingDeadline = ref(false);

async function signOnBehalf(r) {
  busy.value = r.programId;
  try {
    const { data } = await api.post(`/schedule/runs/${props.runId}/review/${r.programId}/sign-off`, { note: '' });
    toast.success(`Signed off for ${r.programName}. It’s recorded as signed off on their behalf.`);
    emit('updated', data.review);
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = ''; }
}

const resolving = ref(null);
const resolveNote = ref('');
async function resolve() {
  busy.value = resolving.value.id;
  try {
    const { data } = await api.post(`/schedule/flags/${resolving.value.id}/resolve`, { note: resolveNote.value.trim() });
    toast.success('Flag resolved. The director has been told.');
    resolving.value = null; resolveNote.value = '';
    emit('updated', data.review);
  } catch (err) { toast.error(errorMessage(err)); }
  finally { busy.value = ''; }
}

const openFlags = computed(() => (props.review?.flags || []).filter((f) => f.status === 'open'));
const resolvedFlags = computed(() => (props.review?.flags || []).filter((f) => f.status === 'resolved'));
const showResolved = ref(false);
const STATUS_STYLE = { signed_off: 'bg-success text-black', flagged: 'bg-unavailable text-white', waiting: 'bg-pending text-black' };
</script>

<template>
  <section class="card p-5 mb-5" aria-labelledby="review-heading">
    <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div>
        <h2 id="review-heading" class="font-semibold">Director review</h2>
        <p v-if="!review?.shared" class="text-sm text-text-muted max-w-3xl">Before publishing, share the draft with the Program Directors. Each director sees their own program’s games (read-only) and signs off, or flags a game that doesn’t work. Publishing unlocks when every program has signed off. After the deadline you can publish anyway, and that’s recorded.</p>
        <p v-else class="text-sm text-text-muted">
          Shared {{ timestamp(review.sharedAt) }} ·
          <strong class="text-text">{{ review.counts.signedOff }} of {{ review.counts.total }}</strong> signed off
          <template v-if="review.counts.flagged"> · {{ review.counts.flagged }} flagged</template>
          · <template v-if="review.deadline">deadline {{ longDate(review.deadline) }}<template v-if="review.deadlinePassed"> (passed)</template></template><template v-else>no deadline</template>
          <button class="underline ml-1" @click="editingDeadline = !editingDeadline; deadline = review.deadline || plusDays(7)">Change</button>
        </p>
      </div>
      <div v-if="!review?.shared || editingDeadline" class="flex flex-wrap items-end gap-2">
        <div>
          <label class="label" for="review-deadline">Sign-off deadline</label>
          <input id="review-deadline" v-model="deadline" type="date" :min="todayISO()" class="input !w-auto" />
        </div>
        <button class="btn btn-primary" :disabled="busy === 'share'" @click="share">{{ review?.shared ? 'Save deadline' : 'Share with directors' }}</button>
      </div>
    </div>

    <template v-if="review?.shared">
      <div class="overflow-x-auto border border-border rounded-lg">
        <table class="w-full text-sm">
          <thead class="text-left text-text-muted border-b border-border">
            <tr><th class="px-3 py-2 font-medium">Program</th><th class="px-3 py-2 font-medium">Status</th><th class="px-3 py-2 font-medium">Details</th><th class="px-3 py-2" /></tr>
          </thead>
          <tbody>
            <tr v-for="r in review.reviews" :key="r.id" class="border-b border-border last:border-0 align-top">
              <td class="px-3 py-2">
                <p class="font-medium">{{ r.programName }}</p>
                <p class="text-xs text-text-muted">{{ r.directorNames || 'No director' }}</p>
              </td>
              <td class="px-3 py-2"><span class="badge" :class="STATUS_STYLE[r.status]">{{ r.statusLabel }}</span></td>
              <td class="px-3 py-2 text-xs text-text-muted">
                <p v-if="r.status !== 'waiting' && r.decidedByName">{{ r.status === 'flagged' ? 'Flagged' : 'Signed off' }} by {{ r.decidedByName }}{{ r.onBehalf ? ' on the program’s behalf (no director)' : '' }} · {{ timestamp(r.decidedAt) }}</p>
                <p v-if="r.note" class="italic">“{{ r.note }}”</p>
                <p v-if="r.status === 'waiting' && r.resetReason" class="font-medium text-text">Needs to review again: {{ r.resetReason }}</p>
                <p v-if="r.openFlags">{{ r.openFlags }} open flag{{ r.openFlags === 1 ? '' : 's' }} below</p>
              </td>
              <td class="px-3 py-2 text-right whitespace-nowrap">
                <button v-if="!r.hasDirector && r.status !== 'signed_off'" class="btn btn-secondary !py-1 !px-2.5 text-xs" :disabled="busy === r.programId" @click="signOnBehalf(r)">Sign off for them</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="openFlags.length" class="mt-4">
        <h3 class="font-semibold text-sm mb-2">Flagged games</h3>
        <ul class="space-y-2">
          <li v-for="f in openFlags" :key="f.id" class="rounded-lg border border-border p-3 text-sm flex flex-wrap items-start gap-3">
            <div class="flex-1 min-w-[14rem]">
              <p class="font-medium">{{ f.gameLabel }}<span v-if="!f.gameId" class="text-xs text-text-muted"> (since removed)</span></p>
              <p class="italic">“{{ f.note }}”</p>
              <p class="text-xs text-text-muted">{{ f.programName }} · {{ f.createdByName }} · {{ timestamp(f.createdAt) }}</p>
            </div>
            <button class="btn btn-secondary !py-1 !px-2.5 text-xs" @click="resolving = f; resolveNote = ''">Resolve</button>
          </li>
        </ul>
        <p class="text-xs text-text-muted mt-2">Fix the game with Move, Flip, Remove or Add game below (that program then reviews again), or resolve the flag with a note if it stays as it is.</p>
      </div>
      <div v-if="resolvedFlags.length" class="mt-3">
        <button class="text-xs underline text-text-muted" @click="showResolved = !showResolved">{{ showResolved ? 'Hide' : 'Show' }} {{ resolvedFlags.length }} resolved flag{{ resolvedFlags.length === 1 ? '' : 's' }}</button>
        <ul v-if="showResolved" class="mt-2 space-y-1 text-xs text-text-muted">
          <li v-for="f in resolvedFlags" :key="f.id">{{ f.gameLabel }}: “{{ f.note }}” ({{ f.programName }}) · resolved by {{ f.resolvedByName }}{{ f.resolutionNote ? `: ${f.resolutionNote}` : '' }}</li>
        </ul>
      </div>
    </template>

    <Modal v-if="resolving" title="Resolve this flag" @close="resolving = null">
      <p class="text-sm font-medium">{{ resolving.gameLabel }}</p>
      <p class="text-sm italic mb-3">“{{ resolving.note }}”</p>
      <label class="label" for="resolve-note">Note for the director (optional)</label>
      <textarea id="resolve-note" v-model="resolveNote" rows="2" class="input" maxlength="300" placeholder="e.g. Moved to Nov 12, or: checked with the other program and the date has to stay." />
      <template #footer>
        <button class="btn btn-secondary" @click="resolving = null">Cancel</button>
        <button class="btn btn-primary" :disabled="busy === resolving.id" @click="resolve">Resolve flag</button>
      </template>
    </Modal>
  </section>
</template>
