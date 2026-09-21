<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import BrandMark from '../components/BrandMark.vue';
import ThemePicker from '../components/ThemePicker.vue';
import ProgramSwitcher from '../components/ProgramSwitcher.vue';
import { useRequestBadge } from '../stores/requestBadge';

const auth = useAuthStore();
const ctx = useProgramContext();
const badge = useRequestBadge();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const menuRoot = ref(null);

const role = computed(() => auth.user?.role);
const primaryNav = computed(() => [
  { to: '/', label: 'Dashboard', show: true },
  { to: '/schedule', label: 'Schedule', show: true, exact: true },
  { to: '/requests', label: 'Requests', show: ['super_admin', 'program_director', 'league_coach'].includes(role.value), badge: true },
  { to: '/slots', label: 'Gym slots', show: auth.canManage },
  { to: '/blackouts', label: 'Blackouts', show: auth.canManage },
  { to: '/venues', label: 'Venues', show: ['super_admin', 'program_director', 'league_coach'].includes(role.value) },
  { to: '/teams', label: 'Teams', show: ['super_admin', 'program_director', 'league_coach'].includes(role.value) },
].filter((n) => n.show));

const adminNav = computed(() => [
  { to: '/schedule/builder', label: 'Schedule builder', show: auth.isSuperAdmin },
  { to: '/programs', label: 'Programs', show: auth.isSuperAdmin },
  { to: '/league', label: 'League setup', show: auth.isSuperAdmin },
  { to: '/users', label: 'Users', show: auth.isSuperAdmin },
  { to: '/activity', label: 'Activity', show: auth.canManage },
].filter((n) => n.show));

const isActive = (to) => {
  if (to === '/') return route.path === '/';
  if (to === '/schedule') return route.path === '/schedule'; // builder has its own entry
  return route.path.startsWith(to);
};

function onDocClick(e) { if (menuOpen.value && !menuRoot.value?.contains(e.target)) menuOpen.value = false; }
onMounted(() => { document.addEventListener('click', onDocClick); ctx.load().catch(() => {}); badge.refresh(); });
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
watch(() => route.fullPath, () => { menuOpen.value = false; badge.refresh(); });

function signOut() {
  auth.clear();
  ctx.reset();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="h-16 border-b border-border bg-header text-header-text flex items-center px-4 md:px-6 gap-3 sticky top-0 z-30">
      <RouterLink to="/" class="shrink-0" aria-label="Winter League home"><BrandMark on-header /></RouterLink>

      <nav class="hidden xl:flex items-center gap-0.5 ml-2 min-w-0" aria-label="Main">
        <RouterLink v-for="n in primaryNav" :key="n.to" :to="n.to"
          class="px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
          :class="isActive(n.to) ? 'bg-header-accent text-header-accent-contrast' : 'text-header-text/75 hover:text-header-text'">
          {{ n.label }}<span v-if="n.badge && badge.count" class="ml-1.5 badge bg-pending text-black !py-0 !px-1.5" :aria-label="`${badge.count} waiting on you`">{{ badge.count }}</span>
        </RouterLink>
      </nav>

      <div class="flex-1" />

      <ProgramSwitcher v-if="auth.isSuperAdmin" class="hidden md:flex" />
      <span v-else-if="auth.user?.programName" class="hidden md:inline text-sm text-header-text/75 truncate max-w-[14rem]">{{ auth.user.programName }}</span>
      <ThemePicker v-if="auth.isSuperAdmin" class="hidden sm:block" />

      <div ref="menuRoot" class="relative">
        <button class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5" :aria-expanded="menuOpen" aria-haspopup="menu" @click="menuOpen = !menuOpen">
          <span class="relative w-8 h-8 rounded-full bg-header-accent text-header-accent-contrast grid place-items-center text-xs font-bold">
            <span v-if="badge.count" class="xl:hidden absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-pending ring-2 ring-header" :aria-label="`${badge.count} request(s) waiting on you`" />
            {{ (auth.user?.firstName?.[0] || '') + (auth.user?.lastName?.[0] || '') }}
          </span>
          <span class="hidden sm:block text-left leading-tight whitespace-nowrap">
            <span class="block font-medium">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</span>
            <span class="block text-xs text-header-text/70">{{ auth.roleLabel }}</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" class="opacity-70"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
        </button>

        <div v-if="menuOpen" role="menu" class="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-surface text-text shadow-xl z-40 overflow-hidden">
          <div class="px-4 py-3 border-b border-border sm:hidden">
            <p class="font-medium text-sm">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</p>
            <p class="text-xs text-text-muted">{{ auth.roleLabel }}<template v-if="auth.user?.programName"> · {{ auth.user.programName }}</template></p>
          </div>
          <div class="xl:hidden py-1 border-b border-border">
            <RouterLink v-for="n in primaryNav" :key="n.to" :to="n.to" role="menuitem"
              class="block px-4 py-2 text-sm hover:bg-background" :class="isActive(n.to) && 'font-semibold text-accent'">{{ n.label }}<span v-if="n.badge && badge.count" class="ml-1.5 badge bg-pending text-black !py-0 !px-1.5">{{ badge.count }}</span></RouterLink>
          </div>
          <div v-if="adminNav.length" class="py-1 border-b border-border">
            <RouterLink v-for="n in adminNav" :key="n.to" :to="n.to" role="menuitem"
              class="block px-4 py-2 text-sm hover:bg-background" :class="isActive(n.to) && 'font-semibold text-accent'">{{ n.label }}</RouterLink>
          </div>
          <div v-if="auth.isSuperAdmin" class="md:hidden px-4 py-3 border-b border-border space-y-2">
            <ProgramSwitcher />
            <ThemePicker class="sm:hidden w-full" />
          </div>
          <div class="py-1">
            <RouterLink to="/change-password" role="menuitem" class="block px-4 py-2 text-sm hover:bg-background">Change password</RouterLink>
            <button role="menuitem" class="block w-full text-left px-4 py-2 text-sm hover:bg-background" @click="signOut">Sign out</button>
          </div>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full max-w-7xl mx-auto px-4 md:px-6 py-6">
      <RouterView :key="ctx.programId" />
    </main>
  </div>
</template>
