<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import { useToast } from '../stores/toast';
import { CATEGORY, addDays, startOfWeek, todayISO, weekday, monthDay, dateRange, timeRange, hoursBetween, longDate } from '../utils/format';
import PageHeader from '../components/PageHeader.vue';
import Modal from '../components/Modal.vue';
import ProgramPicker from '../components/ProgramPicker.vue';

const auth = useAuthStore();
const ctx = useProgramContext();
const toast = useToast();

const season = ref(null);
const weekStart = ref(startOfWeek(todayISO()));
const slots = ref([]);
const blackouts = ref([]);
const venues = ref([]);
const loading = ref(true);
const error = ref('');
const venueFilter = ref('');
const hiddenCats = ref(new Set());

const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)));
const weekEnd = computed(() => days.value[6]);
const today = todayISO();
const showProgramCode = computed(() => auth.isSuperAdmin && !ctx.programId);

const visibleSlots = computed(() => slots.value.filter((s) => !hiddenCats.value.has(s.category)));
const byDay = computed(() => Object.fromEntries(days.value.map((d) => [d, visibleSlots.value.filter((s) => s.date === d)])));

// Program-wide blackouts (no venue) are shown on the day header itself.
function dayBlackout(date) {
  if (!ctx.programId) return null;
  return blackouts.value.find((b) => !b.venueId && date >= b.startDate && date <= b.endDate) || null;
}

const weekSummary = computed(() => {
  const hrs = visibleSlots.value.reduce((a, s) => a + hoursBetween(s.startTime, s.endTime), 0);
  return `${visibleSlots.value.length} slot${visibleSlots.value.length === 1 ? '' : 's'} · ${Math.round(hrs * 10) / 10} hrs`;
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = { ...ctx.query, from: weekStart.value, to: weekEnd.value, ...(venueFilter.value ? { venueId: venueFilter.value } : {}) };
    const [s, b] = await Promise.all([
      api.get('/slots', { params }),
      api.get('/blackouts', { params: { ...ctx.query, from: weekStart.value, to: weekEnd.value } }),
    ]);
    slots.value = s.data.slots;
    blackouts.value = b.data.blackouts;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function loadVenues(programId = ctx.programId) {
  const { data } = await api.get('/venues', { params: programId ? { programId } : {} });
  return data.venues.filter((v) => v.isActive);
}

onMounted(async () => {
  try {
    const [seasonRes, venueList] = await Promise.all([api.get('/league/seasons'), loadVenues()]);
    season.value = seasonRes.data.seasons.find((s) => s.isActive) || null;
    venues.value = venueList;
    // Before the season starts, open on its first week instead of an empty "this week".
    if (season.value && today < season.value.startDate) weekStart.value = startOfWeek(season.value.startDate);
  } catch (err) {
    error.value = errorMessage(err);
  }
  await load();
});
watch([weekStart, venueFilter], load);

const shiftWeek = (n) => { weekStart.value = addDays(weekStart.value, 7 * n); };
const jumpTo = (e) => { if (e.target.value) weekStart.value = startOfWeek(e.target.value); };
function toggleCat(key) {
  const next = new Set(hiddenCats.value);
  next.has(key) ? next.delete(key) : next.add(key);
  hiddenCats.value = next;
}

// ----------------------- Add / edit -----------------------
const editor = ref(null); // { mode: 'create' | 'edit', form, slot? }
const editorVenues = ref([]);
const saving = ref(false);
const formError = ref('');
const result = ref(null); // { created, skipped } after a repeat create

const blankForm = (date) => ({
  programId: ctx.programId || '',
  venueId: venueFilter.value || '',
  courtId: '',
  category: 'PRACTICE',
  date: date || (season.value && today < season.value.startDate ? season.value.startDate : today),
  startTime: '18:00',
  endTime: '20:00',
  repeat: false,
  repeatUntil: '',
  skipBlackouts: true,
  notes: '',
});

async function openCreate(date) {
  formError.value = '';
  result.value = null;
  const form = blankForm(date);
  editorVenues.value = form.programId ? venues.value : [];
  if (editorVenues.value.length === 1) form.venueId = editorVenues.value[0].id;
  editor.value = { mode: 'create', form };
  syncCourt();
}

async function openEdit(slot) {
  formError.value = '';
  result.value = null;
  editorVenues.value = ctx.programId ? venues.value : await loadVenues(slot.programId);
  editor.value = {
    mode: 'edit',
    slot,
    form: { programId: slot.programId, venueId: slot.venueId, courtId: slot.courtId, category: slot.category, date: slot.date,
      startTime: slot.startTime, endTime: slot.endTime, notes: slot.notes || '' },
  };
}

const courtsForVenue = computed(() => editorVenues.value.find((v) => v.id === editor.value?.form.venueId)?.courts || []);
function syncCourt() {
  const f = editor.value?.form;
  if (!f) return;
  if (!courtsForVenue.value.some((c) => c.id === f.courtId)) f.courtId = courtsForVenue.value.length === 1 ? courtsForVenue.value[0].id : '';
}
watch(() => editor.value?.form.venueId, syncCourt);
watch(() => editor.value?.form.programId, async (pid, old) => {
  if (!editor.value || editor.value.mode !== 'create' || !pid || pid === old) return;
  editorVenues.value = await loadVenues(pid);
  editor.value.form.venueId = editorVenues.value.length === 1 ? editorVenues.value[0].id : '';
});
watch(() => editor.value?.form.repeat, (on) => {
  const f = editor.value?.form;
  if (on && f && !f.repeatUntil) {
    const eightWeeks = addDays(f.date, 7 * 8);
    f.repeatUntil = season.value && eightWeeks > season.value.endDate ? season.value.endDate : eightWeeks;
  }
});

const repeatPreview = computed(() => {
  const f = editor.value?.form;
  if (!f?.repeat || !f.date || !f.repeatUntil || f.repeatUntil <= f.date) return '';
  const n = Math.floor((new Date(`${f.repeatUntil}T12:00:00`) - new Date(`${f.date}T12:00:00`)) / (7 * 86400000)) + 1;
  return `Up to ${n} ${weekday(f.date, 'long')} slots, ${monthDay(f.date)} through ${monthDay(f.repeatUntil)}. Dates that conflict are skipped and listed afterward.`;
});

async function save() {
  const f = editor.value.form;
  formError.value = '';
  if (!f.courtId) { formError.value = 'Choose a venue and court.'; return; }
  if (f.startTime >= f.endTime) { formError.value = 'End time must be after start time.'; return; }
  saving.value = true;
  try {
    if (editor.value.mode === 'create') {
      const body = { programId: f.programId, courtId: f.courtId, category: f.category, date: f.date, startTime: f.startTime,
        endTime: f.endTime, notes: f.notes, skipBlackouts: f.skipBlackouts, ...(f.repeat ? { repeatWeeklyUntil: f.repeatUntil } : {}) };
      const { data } = await api.post('/slots', body);
      const n = data.slots.length;
      toast.success(`Added ${n} gym slot${n === 1 ? '' : 's'}.`);
      if (data.skipped.length) result.value = { created: n, skipped: data.skipped };
      else editor.value = null;
      weekStart.value = startOfWeek(f.date);
    } else {
      await api.put(`/slots/${editor.value.slot.id}`, { courtId: f.courtId, category: f.category, date: f.date, startTime: f.startTime, endTime: f.endTime, notes: f.notes });
      toast.success('Gym slot saved.');
      editor.value = null;
    }
    await load();
  } catch (err) {
    formError.value = errorMessage(err);
    const skipped = err.response?.data?.skipped;
    if (skipped?.length > 1) result.value = { created: 0, skipped };
  } finally {
    saving.value = false;
  }
}

const deleting = ref(false);
async function remove(scope) {
  deleting.value = true;
  try {
    const { data } = await api.delete(`/slots/${editor.value.slot.id}`, { params: { scope } });
    toast.success(data.deleted > 1 ? `Deleted ${data.deleted} gym slots.` : 'Gym slot deleted.');
    editor.value = null;
    await load();
  } catch (err) {
    formError.value = errorMessage(err);
  } finally {
    deleting.value = false;
  }
}
const confirmDelete = ref(false);
watch(editor, () => { confirmDelete.value = false; });
</script>

<template>
  <div>
    <PageHeader title="Gym slots"
      :subtitle="`Gym time available for league play${ctx.current ? ` at ${ctx.current.name}` : auth.isSuperAdmin ? ' across all programs' : ''}.`">
      <button class="btn btn-primary" :disabled="!season" :title="season ? '' : 'A season must be active first'" @click="openCreate()">Add gym slots</button>
    </PageHeader>

    <div v-if="!season && !loading" class="card card-blocky border-l-4 border-l-warning px-4 py-3 mb-4 text-sm">
      No season is active. {{ auth.isSuperAdmin ? 'Create one under League setup before adding gym slots.' : 'Your league administrator needs to open the season before gym slots can be added.' }}
    </div>

    <!-- Toolbar -->
    <div class="card card-blocky px-3 py-2.5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="flex items-center gap-1">
        <button class="btn btn-ghost" aria-label="Previous week" @click="shiftWeek(-1)">‹</button>
        <p class="font-semibold text-sm min-w-[9.5rem] text-center" aria-live="polite">{{ dateRange(weekStart, weekEnd) }}, {{ weekEnd.slice(0, 4) }}</p>
        <button class="btn btn-ghost" aria-label="Next week" @click="shiftWeek(1)">›</button>
      </div>
      <button class="text-sm text-accent font-medium hover:underline" @click="weekStart = startOfWeek(today)">This week</button>
      <label class="text-sm flex items-center gap-2">
        <span class="text-text-muted">Go to</span>
        <input type="date" class="input !w-auto !py-1" :min="season?.startDate" :max="season?.endDate" @change="jumpTo" />
      </label>
      <select v-if="ctx.programId && venues.length > 1" v-model="venueFilter" class="input !w-auto !py-1" aria-label="Filter by venue">
        <option value="">All venues</option>
        <option v-for="v in venues" :key="v.id" :value="v.id">{{ v.name }}</option>
      </select>
      <div class="flex-1" />
      <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show slot types">
        <button v-for="(c, key) in CATEGORY" :key="key" type="button"
          class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity"
          :class="hiddenCats.has(key) ? 'border-border opacity-50 line-through' : 'border-border'"
          :aria-pressed="!hiddenCats.has(key)" @click="toggleCat(key)">
          <span class="w-2.5 h-2.5 rounded-sm" :class="c.cls" />{{ c.label }}
        </button>
        <span class="flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-muted"><span class="w-2.5 h-2.5 rounded-sm hatch-blackout ring-1 ring-text-muted/60" />Blacked out</span>
      </div>
    </div>

    <p v-if="error" class="text-danger text-sm mb-3">{{ error }}</p>
    <p class="text-xs text-text-muted mb-2">{{ loading ? 'Loading…' : weekSummary }}</p>

    <!-- Week board -->
    <div class="grid gap-3 lg:grid-cols-7" :class="loading && 'opacity-60'">
      <section v-for="d in days" :key="d" class="card card-blocky flex flex-col min-h-[5rem] lg:min-h-[18rem] overflow-hidden"
        :class="d === today && 'ring-2 ring-accent'">
        <header class="px-3 py-2 border-b border-border flex items-baseline justify-between gap-2"
          :class="dayBlackout(d) && 'hatch-blackout text-white'">
          <div>
            <span class="text-sm font-semibold">{{ weekday(d) }}</span>
            <span class="text-sm ml-1" :class="dayBlackout(d) ? 'text-white/85' : 'text-text-muted'">{{ monthDay(d) }}</span>
          </div>
          <button v-if="season && d >= season.startDate && d <= season.endDate" class="text-lg leading-none px-1 rounded opacity-60 hover:opacity-100"
            :aria-label="`Add a gym slot on ${longDate(d)}`" @click="openCreate(d)">+</button>
        </header>
        <p v-if="dayBlackout(d)" class="px-3 py-1.5 text-xs bg-unavailable text-white">Blacked out: {{ dayBlackout(d).reason }}</p>

        <ol class="p-2 flex flex-col gap-1.5 flex-1">
          <li v-for="s in byDay[d]" :key="s.id">
            <button class="relative w-full text-left rounded-md border border-[var(--color-slot-border)] text-white px-2.5 py-2 text-xs leading-snug hover:brightness-110 overflow-hidden"
              :class="CATEGORY[s.category].cls" :aria-label="`${s.categoryLabel}, ${timeRange(s.startTime, s.endTime)}, ${s.venueName} ${s.courtName}${s.isBlackedOut ? ', blacked out' : ''}. Edit.`"
              @click="openEdit(s)">
              <span v-if="s.isBlackedOut" class="absolute inset-0 hatch-blackout" aria-hidden="true" />
              <span class="relative block">
                <span class="block font-semibold text-[0.8125rem]">{{ timeRange(s.startTime, s.endTime) }}</span>
                <span class="block opacity-90">{{ CATEGORY[s.category].short }}<template v-if="showProgramCode"> · {{ s.shortCode }}</template></span>
                <span class="block opacity-90 truncate" :title="s.venueName">{{ s.venueName }}</span>
                <span class="block opacity-90 truncate">{{ s.courtName }}</span>
                <span v-if="s.isBlackedOut" class="block mt-1 font-semibold">Blacked out: {{ s.blackoutReason }}</span>
                <span v-else-if="s.notes" class="block mt-1 italic opacity-90 truncate">{{ s.notes }}</span>
              </span>
            </button>
          </li>
          <li v-if="!byDay[d].length && !loading" class="text-xs text-text-muted px-1 py-1 lg:py-2">No slots</li>
        </ol>
      </section>
    </div>

    <!-- Editor -->
    <Modal v-if="editor" :title="result ? 'Some dates were skipped' : editor.mode === 'create' ? 'Add gym slots' : 'Edit gym slot'" wide @close="editor = null">
      <div v-if="result" class="space-y-3 text-sm">
        <p>{{ result.created ? `Added ${result.created} slot${result.created === 1 ? '' : 's'}.` : 'No slots were added.' }}
          These {{ result.skipped.length }} date{{ result.skipped.length === 1 ? ' was' : 's were' }} skipped:</p>
        <ul class="card card-blocky divide-y divide-border">
          <li v-for="s in result.skipped" :key="s.date" class="px-3 py-2 flex flex-wrap gap-x-3">
            <span class="font-medium w-36">{{ weekday(s.date) }}, {{ monthDay(s.date) }}</span>
            <span class="text-text-muted">{{ s.reason }}</span>
          </li>
        </ul>
      </div>

      <form v-else id="slot-form" class="grid gap-4 sm:grid-cols-2" @submit.prevent="save">
        <ProgramPicker v-if="editor.mode === 'create'" v-model="editor.form.programId" class="sm:col-span-2" />

        <div>
          <label class="label" for="sf-venue">Venue</label>
          <select id="sf-venue" v-model="editor.form.venueId" class="input" required :disabled="!editorVenues.length">
            <option value="" disabled>{{ editorVenues.length ? 'Choose a venue' : auth.isSuperAdmin && !editor.form.programId ? 'Choose a program first' : 'Add a venue first' }}</option>
            <option v-for="v in editorVenues" :key="v.id" :value="v.id">{{ v.name }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="sf-court">Court</label>
          <select id="sf-court" v-model="editor.form.courtId" class="input" required :disabled="!courtsForVenue.length">
            <option value="" disabled>Choose a court</option>
            <option v-for="c in courtsForVenue" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>

        <fieldset class="sm:col-span-2">
          <legend class="label">Slot type</legend>
          <div class="grid gap-2 sm:grid-cols-3">
            <label v-for="(c, key) in CATEGORY" :key="key"
              class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer"
              :class="editor.form.category === key ? 'border-accent ring-1 ring-accent' : 'border-border'">
              <input v-model="editor.form.category" type="radio" :value="key" class="sr-only" />
              <span class="w-3 h-3 rounded-sm" :class="c.cls" />{{ c.label }}
            </label>
          </div>
        </fieldset>

        <div>
          <label class="label" for="sf-date">{{ editor.form.repeat ? 'First date' : 'Date' }}</label>
          <input id="sf-date" v-model="editor.form.date" type="date" class="input" :min="season?.startDate" :max="season?.endDate" required />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="label" for="sf-start">Start</label><input id="sf-start" v-model="editor.form.startTime" type="time" step="900" class="input" required /></div>
          <div><label class="label" for="sf-end">End</label><input id="sf-end" v-model="editor.form.endTime" type="time" step="900" class="input" required /></div>
        </div>

        <div v-if="editor.mode === 'create'" class="sm:col-span-2 rounded-lg border border-border p-3 space-y-3">
          <label class="flex items-center gap-2 text-sm font-medium">
            <input v-model="editor.form.repeat" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" />
            Repeat every {{ editor.form.date ? weekday(editor.form.date, 'long') : 'week' }}
          </label>
          <template v-if="editor.form.repeat">
            <div class="grid gap-3 sm:grid-cols-2 items-end">
              <div>
                <label class="label" for="sf-until">Repeat through</label>
                <input id="sf-until" v-model="editor.form.repeatUntil" type="date" class="input" :min="editor.form.date" :max="season?.endDate" required />
              </div>
              <label class="flex items-center gap-2 text-sm pb-2">
                <input v-model="editor.form.skipBlackouts" type="checkbox" class="w-4 h-4 accent-[var(--color-accent)]" />
                Skip blackout dates
              </label>
            </div>
            <p class="text-xs text-text-muted">{{ repeatPreview }}</p>
          </template>
        </div>

        <div class="sm:col-span-2">
          <label class="label" for="sf-notes">Notes <span class="font-normal text-text-muted">(optional)</span></label>
          <input id="sf-notes" v-model="editor.form.notes" class="input" maxlength="200" placeholder="e.g. Use the north entrance after 6pm" />
        </div>

        <p v-if="editor.mode === 'edit' && editor.slot.isBlackedOut" class="sm:col-span-2 text-sm rounded-lg bg-unavailable text-white px-3 py-2">
          This date is blacked out ({{ editor.slot.blackoutReason }}). The slot is kept and becomes usable again if the blackout is removed.
        </p>
        <p v-if="formError" class="sm:col-span-2 text-sm text-danger" role="alert">{{ formError }}</p>
      </form>

      <template #footer>
        <template v-if="result">
          <button class="btn btn-primary" @click="editor = null">Done</button>
        </template>
        <template v-else>
          <div v-if="editor.mode === 'edit'" class="mr-auto flex flex-wrap items-center gap-2">
            <template v-if="!confirmDelete">
              <button class="btn btn-ghost !text-danger" @click="confirmDelete = true">Delete…</button>
            </template>
            <template v-else>
              <button class="btn btn-danger" :disabled="deleting" @click="remove('one')">Delete this slot</button>
              <button v-if="editor.slot.seriesId" class="btn btn-secondary !text-danger" :disabled="deleting" @click="remove('following')">This and following weeks</button>
            </template>
          </div>
          <button class="btn btn-secondary" @click="editor = null">Cancel</button>
          <button class="btn btn-primary" type="submit" form="slot-form" :disabled="saving">
            {{ saving ? 'Saving…' : editor.mode === 'create' ? (editor.form.repeat ? 'Add weekly slots' : 'Add slot') : 'Save changes' }}
          </button>
        </template>
      </template>
    </Modal>
  </div>
</template>
