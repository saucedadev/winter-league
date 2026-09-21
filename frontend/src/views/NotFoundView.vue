<script setup>
import { useBrandingStore } from '../stores/branding';
const branding = useBrandingStore();
import AuthShell from '../components/AuthShell.vue';
</script>
<template>
  <AuthShell title="Page not found" :subtitle="`That address doesn’t match any page in ${branding.appName}.`">
    <RouterLink to="/" class="btn btn-primary w-full">Go to dashboard</RouterLink>
  </AuthShell>
</template>
