<script setup>
import { useBrandingStore } from '../stores/branding';

// Footer on every screen, including the sign-in page. The app name comes from
// Branding & Theme. The copyright line is fixed here on purpose: it is the
// software owner's notice, so it is not read from .env or from Branding and a
// deployment can't change it. (See LICENSE.)
const branding = useBrandingStore();
</script>

<template>
  <footer class="app-footer border-t border-border px-4 py-4 text-center text-xs text-text-muted">
    <p class="font-medium text-text">{{ branding.appName }}</p>
    <p class="mt-0.5">© 2026 Saucidion, LLC. All rights reserved.</p>
  </footer>
</template>
