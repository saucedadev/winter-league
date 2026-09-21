<script setup>
import AuthShell from '../components/AuthShell.vue';
</script>
<template>
  <AuthShell title="Page not found" subtitle="That address doesn’t match any page in Winter League.">
    <RouterLink to="/" class="btn btn-primary w-full">Go to dashboard</RouterLink>
  </AuthShell>
</template>
