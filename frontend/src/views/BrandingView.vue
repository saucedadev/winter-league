<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, errorMessage } from '../api/client';
import { useThemeStore } from '../stores/theme';
import { useBrandingStore, DEFAULT_APP_NAME } from '../stores/branding';
import { useToast } from '../stores/toast';
import PageHeader from '../components/PageHeader.vue';
import BrandMark from '../components/BrandMark.vue';
import ThemePicker from '../components/ThemePicker.vue';

const branding = useBrandingStore();
const toast = useToast();
const MAX_KB = 300;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const form = ref({ appName: branding.appName, logo: branding.logo });
const saving = ref(false);
const error = ref('');
const fileInput = ref(null);

const dirty = computed(() => form.value.appName.trim() !== branding.appName || (form.value.logo || null) !== (branding.logo || null));
const isDefault = computed(() => form.value.appName.trim() === DEFAULT_APP_NAME && !form.value.logo);

function pickFile(e) {
  error.value = '';
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!TYPES.includes(file.type)) { error.value = 'Choose a PNG, JPEG, WebP, or SVG image.'; return; }
  if (file.size > MAX_KB * 1024) { error.value = `That file is ${Math.round(file.size / 1024)} KB. The logo must be under ${MAX_KB} KB.`; return; }
  const reader = new FileReader();
  reader.onload = () => { form.value.logo = reader.result; };
  reader.onerror = () => { error.value = 'Couldn’t read that file.'; };
  reader.readAsDataURL(file);
}

async function save() {
  error.value = '';
  saving.value = true;
  try {
    await branding.save({ appName: form.value.appName, logo: form.value.logo || null });
    form.value = { appName: branding.appName, logo: branding.logo };
    toast.success('Branding saved. Everyone sees it the next time a page loads.');
  } catch (err) { error.value = errorMessage(err); }
  finally { saving.value = false; }
}
// ---- Emails: a live preview and a test send ----
// (The server makes the PNG copy of the logo that emails use.)
const theme = useThemeStore();
const previewHtml = ref('');
const previewError = ref('');
let previewTimer = null;
let previewSeq = 0;
async function loadPreview() {
  const seq = ++previewSeq;
  const appName = form.value.appName.trim();
  if (appName.length < 2) return;
  try {
    const { data } = await api.post('/settings/email-preview', { appName, logo: form.value.logo || null });
    if (seq === previewSeq) { previewHtml.value = data.html; previewError.value = ''; }
  } catch (err) { if (seq === previewSeq) previewError.value = errorMessage(err); }
}
watch(() => [form.value.appName, form.value.logo, theme.activeTheme], () => { clearTimeout(previewTimer); previewTimer = setTimeout(loadPreview, 400); }, { immediate: true });
onBeforeUnmount(() => clearTimeout(previewTimer));

const testing = ref(false);
const testResult = ref(null);
async function sendTest() {
  testing.value = true;
  testResult.value = null;
  try {
    const { data } = await api.post('/settings/email-test');
    const logoNote = {
      api: ' Your logo is served by the app’s server, so if the server is asleep when the email is opened it may not show. Set up Vercel Blob for a logo that always shows (EMAIL-SETUP.md).',
      none: ' Your logo can’t be shown in emails yet, so they use the built-in mark. Set up Vercel Blob (EMAIL-SETUP.md).',
    }[data.logo] || '';
    testResult.value = data.provider === 'brevo'
      ? { ok: true, text: `Sent to ${data.sentTo}. It should arrive within a minute; check spam if it doesn’t.${logoNote}` }
      : { ok: false, text: `Email is in console mode, so nothing was sent: the email was written to the server log. Set up Brevo to send for real (EMAIL-SETUP.md).` };
  } catch (err) { testResult.value = { ok: false, text: errorMessage(err) }; }
  finally { testing.value = false; }
}

function resetDefaults() { form.value = { appName: DEFAULT_APP_NAME, logo: null }; }
function discard() { form.value = { appName: branding.appName, logo: branding.logo }; error.value = ''; }
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <PageHeader title="Branding & Theme" subtitle="The name, logo, and colors this conference sees everywhere: the header, the sign-in page, the browser tab, and emails." />

    <form class="card p-5 space-y-5" @submit.prevent="save">
      <div>
        <label class="label" for="br-name">App name</label>
        <input id="br-name" v-model="form.appName" class="input" maxlength="60" required placeholder="e.g. Pacific Youth Conference" />
        <p class="text-xs text-text-muted mt-1">Shown exactly as typed. Long names wrap onto two lines in the header.</p>
      </div>

      <div>
        <p class="label">Logo</p>
        <div class="flex flex-wrap items-center gap-3">
          <div class="w-16 h-16 rounded-lg border border-border grid place-items-center bg-background">
            <BrandMark :show-word="false" :size="40" :logo="form.logo || null" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary" @click="fileInput.click()">{{ form.logo ? 'Replace logo' : 'Upload logo' }}</button>
            <button v-if="form.logo" type="button" class="btn btn-ghost" @click="form.logo = null">Use the built-in mark</button>
          </div>
          <input ref="fileInput" type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" class="sr-only" aria-label="Upload logo" @change="pickFile" />
        </div>
        <p class="text-xs text-text-muted mt-2">PNG, JPEG, WebP, or SVG, under {{ MAX_KB }} KB. A transparent background works best. It’s shown 28 px tall in the header and 40 px on the sign-in page, and it becomes the browser-tab icon. Emails get a PNG copy of it, made when you save. Until you upload one, the built-in hexagon mark is used.</p>
      </div>

      <div>
        <p class="label">Preview</p>
        <div class="rounded-lg border border-border overflow-hidden">
          <div class="h-16 bg-header text-header-text border-b border-header-border flex items-center px-4 gap-6">
            <BrandMark on-header :name="form.appName || ' '" :logo="form.logo || null" />
            <span class="text-sm opacity-75 hidden sm:inline">Dashboard</span>
            <span class="text-sm opacity-75 hidden sm:inline">Schedule</span>
          </div>
          <div class="bg-background py-6 flex justify-center">
            <BrandMark :size="40" class="text-2xl" :name="form.appName || ' '" :logo="form.logo || null" />
          </div>
        </div>
        <p class="text-xs text-text-muted mt-1">Header on top, sign-in page below, in the current theme.</p>
      </div>

      <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
      <div class="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
        <button v-if="!isDefault" type="button" class="btn btn-ghost" @click="resetDefaults">Reset to defaults</button>
        <span class="flex-1" />
        <span v-if="!dirty" class="text-xs text-text-muted">Everything is saved. Change the name or logo to save again.</span>
        <button v-if="dirty" type="button" class="btn btn-secondary" @click="discard">Discard changes</button>
        <button type="submit" class="btn btn-primary" :disabled="!dirty || saving || form.appName.trim().length < 2">{{ saving ? 'Saving…' : 'Save branding' }}</button>
      </div>
    </form>

    <section class="card p-5 mt-5">
      <h2 class="font-semibold">Sitewide theme</h2>
      <p class="text-sm text-text-muted mb-3">The color theme for everyone, including the sign-in page and emails. Changes apply as soon as you pick one.</p>
      <label class="label" for="theme-select">Theme</label>
      <ThemePicker id="theme-select" class="!text-base w-full sm:w-72 !py-2" />
    </section>

    <section class="card p-5 mt-5">
      <h2 class="font-semibold">Emails</h2>
      <p class="text-sm text-text-muted mb-3">Every email the app sends uses the app name, logo, and theme color: the name across the top and as the sender’s name, the logo beside it, and a note at the bottom that replies aren’t read. This sample updates as you edit (before you save).</p>
      <div class="rounded-lg border border-border overflow-hidden bg-[#EEF1F4]">
        <iframe v-if="previewHtml" :srcdoc="previewHtml" title="Sample email" sandbox="" class="w-full h-[640px] block border-0" />
        <p v-else class="p-4 text-sm text-text-muted">{{ previewError || 'Loading the sample…' }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3 mt-3">
        <button type="button" class="btn btn-secondary" :disabled="testing" @click="sendTest">{{ testing ? 'Sending…' : 'Send me a test email' }}</button>
        <p class="text-xs text-text-muted flex-1 min-w-[14rem]">Sends this sample, with the saved branding, to your own email address.</p>
      </div>
      <p v-if="testResult" class="text-sm mt-2" :class="testResult.ok ? 'text-success' : ''" role="status">{{ testResult.text }}</p>
    </section>

    <p class="text-xs text-text-muted mt-4">Running more than one conference? Each conference gets its own copy of the app with its own database (see DEPLOYMENT.md), so each sets its own name, logo, and theme here.</p>
  </div>
</template>
