<script setup>
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useBrandingStore } from '../stores/branding';
import { findGuide, renderGuide } from '../help/guides';
import '../help/guide.css';

// A guide with no app chrome, always in the light theme. The PDF build
// script prints this page (npm run guides:pdf). ?name= sets the conference
// name printed in the guide.
const route = useRoute();
const branding = useBrandingStore();
const guide = computed(() => findGuide(route.params.guide));
const appName = computed(() => route.query.name || branding.appName);
const rendered = computed(() => (guide.value ? renderGuide(guide.value, appName.value, { lazy: false }) : null));
onMounted(() => {
  document.documentElement.dataset.theme = 'light';
  document.documentElement.classList.remove('dark');
  document.title = guide.value ? `${appName.value} - ${guide.value.title}` : 'Guide not found';
});
</script>

<template>
  <div class="bg-white min-h-screen">
    <main v-if="rendered" class="max-w-3xl mx-auto px-6 py-8">
      <p class="text-xs uppercase tracking-wide text-text-muted mb-4">{{ appName }} · User guide</p>
      <!-- eslint-disable-next-line vue/no-v-html -- trusted, bundled guide content -->
      <article class="guide" v-html="rendered.html" />
    </main>
    <p v-else class="p-8">Guide not found.</p>
  </div>
</template>
