<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import ToastHost from './components/ToastHost.vue';
import AppFooter from './components/AppFooter.vue';

const route = useRoute();
// The printable guide (used to make the PDFs) carries the notice in each page's
// footer instead, so the app footer is left off that one page.
const showFooter = computed(() => !route.path.startsWith('/help-print'));
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <div class="flex-1 flex flex-col">
      <RouterView />
    </div>
    <AppFooter v-if="showFooter" />
  </div>
  <ToastHost />
</template>
