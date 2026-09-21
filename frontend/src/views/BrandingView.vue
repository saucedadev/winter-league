<script setup>
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import { useBrandingStore, DEFAULT_APP_NAME } from '../stores/branding';
import { useToast } from '../stores/toast';
import PageHeader from '../components/PageHeader.vue';
import BrandMark from '../components/BrandMark.vue';

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
function resetDefaults() { form.value = { appName: DEFAULT_APP_NAME, logo: null }; }
function discard() { form.value = { appName: branding.appName, logo: branding.logo }; error.value = ''; }
</script>

<template>
  <div class="max-w-3xl">
    <PageHeader title="Branding" subtitle="The name and logo this conference sees everywhere: the header, the sign-in page, the browser tab, and emails." />

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
        <p class="text-xs text-text-muted mt-2">PNG, JPEG, WebP, or SVG, under {{ MAX_KB }} KB. A transparent background works best. It’s shown 28 px tall in the header and 40 px on the sign-in page, and it becomes the browser-tab icon. Until you upload one, the built-in hexagon mark is used.</p>
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
        <button v-if="dirty" type="button" class="btn btn-secondary" @click="discard">Discard changes</button>
        <button type="submit" class="btn btn-primary" :disabled="!dirty || saving || form.appName.trim().length < 2">{{ saving ? 'Saving…' : 'Save branding' }}</button>
      </div>
    </form>

    <p class="text-xs text-text-muted mt-4">Running more than one conference? Each conference gets its own copy of the app with its own database (see DEPLOYMENT.md), so each sets its own name, logo, and theme here.</p>
  </div>
</template>
