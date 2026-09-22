<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useProgramContext } from '../stores/programContext';
import BrandMark from '../components/BrandMark.vue';
import ThemePicker from '../components/ThemePicker.vue';
import ProgramSwitcher from '../components/ProgramSwitcher.vue';
import { useRequestBadge } from '../stores/requestBadge';
import { useBrandingStore } from '../stores/branding';

const auth = useAuthStore();
const ctx = useProgramContext();
const badge = useRequestBadge();
const branding = useBrandingStore();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const menuRoot = ref(null);

const role = computed(() => auth.user?.role);
const primaryNav = computed(() => [
  { to: '/', label: 'Dashboard', show: true },
  { to: '/my-games', label: 'My games', show: role.value === 'referee' },
  { to: '/schedule', label: 'Schedule', show: true, exact: true },
  { to: '/assignments', label: 'Assignments', show: role.value === 'referee_assignor' },
  { to: '/referees', label: 'Referees', show: role.value === 'referee_assignor' },
  { to: '/payouts', label: 'Payouts', show: role.value === 'referee_assignor' },
  { to: '/requests', label: 'Requests', show: ['super_admin', 'program_director', 'league_coach'].includes(role.value), badge: true },
  { to: '/slots', label: 'Gym slots', show: auth.canManage },
  { to: '/blackouts', label: 'Blackouts', show: auth.canManage },
  { to: '/venues', label: 'Venues', show: ['super_admin', 'program_director', 'league_coach'].includes(role.value) },
  { to: '/teams', label: 'Teams', show: ['super_admin', 'program_director', 'league_coach'].includes(role.value) },
].filter((n) => n.show));

// The account menu, in sections. Each role sees only the sections it has
// links in. Links that are also in the desktop header (primaryNav) are
// marked inHeader and hidden from the menu on wide screens.
const inHeader = (to) => primaryNav.value.some((n) => n.to === to);
const menuGroups = computed(() => {
  const sa = auth.isSuperAdmin;
  const coachOrDirector = ['super_admin', 'program_director', 'league_coach'].includes(role.value);
  const groups = [
    { id: 'league', label: 'League', items: [
      { to: '/', label: 'Dashboard' },
      { to: '/my-games', label: 'My games', show: role.value === 'referee' },
      { to: '/schedule', label: 'Schedule' },
      { to: '/requests', label: 'Requests', show: coachOrDirector, badge: true },
    ] },
    { id: 'officials', label: 'Referees', items: [
      { to: '/assignments', label: 'Assignments', show: role.value === 'referee_assignor' },
      { to: '/referees', label: 'Referees', show: role.value === 'referee_assignor' },
      { to: '/payouts', label: 'Payouts', show: role.value === 'referee_assignor' },
    ] },
    { id: 'program', label: sa ? 'Programs & gyms' : 'My program', items: [
      { to: '/slots', label: 'Gym slots', show: auth.canManage },
      { to: '/blackouts', label: 'Blackouts', show: auth.canManage },
      { to: '/venues', label: 'Venues', show: coachOrDirector },
      { to: '/teams', label: 'Teams', show: coachOrDirector },
      { to: '/activity', label: 'Activity', show: auth.canManage && !sa },
    ] },
    { id: 'scheduling', label: 'Scheduling', items: [{ to: '/schedule/builder', label: 'Schedule builder', show: sa }] },
    { id: 'referees', label: 'Referees', items: [
      { to: '/assignments', label: 'Referee assignments', show: sa },
      { to: '/referees', label: 'Referees', show: sa },
      { to: '/payouts', label: 'Referee payouts', show: sa },
    ] },
    { id: 'admin', label: 'League admin', items: [
      { to: '/programs', label: 'Programs', show: sa },
      { to: '/league', label: 'League setup', show: sa },
      { to: '/users', label: 'Users', show: sa },
      { to: '/branding', label: 'Branding & theme', show: sa },
      { to: '/activity', label: 'Activity', show: sa },
    ] },
  ];
  return groups
    .map((g) => {
      const items = g.items.filter((i) => i.show !== false).map((i) => ({ ...i, inHeader: inHeader(i.to) }));
      return { ...g, items, allInHeader: items.every((i) => i.inHeader) };
    })
    .filter((g) => g.items.length);
});
// On wide screens (xl, 1280px+) the header shows the main links, so the menu
// only lists the rest.
const wideQuery = window.matchMedia('(min-width: 1280px)');
const isWide = ref(wideQuery.matches);
const onWideChange = (e) => { isWide.value = e.matches; };
const menuLinkCount = computed(() => menuGroups.value.reduce((n, g) => n + g.items.filter((i) => !(isWide.value && i.inHeader)).length, 0));
// Long menus (the System Admin's on phones and tablets) collapse to section
// headings, with the section holding the current page open. Shorter menus,
// including the admin's on a wide screen, just show everything.
const collapsible = computed(() => menuLinkCount.value > 10);
const openGroups = ref(new Set());
const groupOpen = (g) => !collapsible.value || openGroups.value.has(g.id);
function toggleGroup(g) {
  const next = new Set(openGroups.value);
  if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
  openGroups.value = next;
}
const groupHasActive = (g) => g.items.some((i) => isActive(i.to));

const isActive = (to) => {
  if (to === '/') return route.path === '/';
  if (to === '/schedule') return route.path === '/schedule'; // builder has its own entry
  return route.path.startsWith(to);
};

const menuButton = ref(null);
function closeMenu({ focusButton = false } = {}) {
  menuOpen.value = false;
  if (focusButton) menuButton.value?.focus();
}
function onDocClick(e) { if (menuOpen.value && !menuRoot.value?.contains(e.target)) closeMenu(); }
function onKeydown(e) { if (e.key === 'Escape' && menuOpen.value) closeMenu({ focusButton: true }); }
// Phones: while the menu is open, the page behind it (and the dimmed layer) mustn't scroll.
const isPhone = () => window.matchMedia('(max-width: 639px)').matches;
watch(menuOpen, (open) => {
  if (open) openGroups.value = new Set(menuGroups.value.filter(groupHasActive).map((g) => g.id));
  document.documentElement.style.overflow = open && isPhone() ? 'hidden' : '';
});
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
  wideQuery.addEventListener('change', onWideChange);
  ctx.load().catch(() => {});
  badge.refresh();
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
  wideQuery.removeEventListener('change', onWideChange);
  document.documentElement.style.overflow = '';
});
watch(() => route.fullPath, () => { closeMenu(); badge.refresh(); });

function signOut() {
  auth.clear();
  ctx.reset();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="h-16 border-b border-header-border bg-header text-header-text flex items-center px-4 md:px-6 gap-3 sticky top-0 z-30">
      <RouterLink to="/" class="shrink-0 min-w-0" :aria-label="`${branding.appName} home`"><BrandMark on-header /></RouterLink>

      <nav class="hidden xl:flex items-center gap-0.5 ml-2 min-w-0" aria-label="Main">
        <RouterLink v-for="n in primaryNav" :key="n.to" :to="n.to"
          class="px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
          :class="isActive(n.to) ? 'bg-header-accent text-header-accent-contrast' : 'text-header-text/75 hover:text-header-text'">
          {{ n.label }}<span v-if="n.badge && badge.count" class="ml-1.5 badge bg-highlight text-black !py-0 !px-1.5" :aria-label="`${badge.count} waiting on you`">{{ badge.count }}</span>
        </RouterLink>
      </nav>

      <div class="flex-1" />

      <ProgramSwitcher v-if="auth.isSuperAdmin" class="hidden md:flex" />
      <span v-else-if="auth.user?.programName" class="hidden md:inline text-sm text-header-text/75 truncate max-w-[14rem]">{{ auth.user.programName }}</span>
      <ThemePicker v-if="auth.isSuperAdmin" class="hidden sm:block xl:hidden 2xl:block" />

      <div ref="menuRoot" class="relative">
        <button ref="menuButton" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5" :aria-expanded="menuOpen" aria-controls="account-menu"
          :aria-label="menuOpen ? 'Close menu' : 'Open menu'" @click="menuOpen = !menuOpen">
          <span class="relative w-8 h-8 rounded-full bg-header-accent text-header-accent-contrast grid place-items-center text-xs font-bold">
            <span v-if="badge.count" class="xl:hidden absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-highlight ring-2 ring-header" :aria-label="`${badge.count} request(s) waiting on you`" />
            {{ (auth.user?.firstName?.[0] || '') + (auth.user?.lastName?.[0] || '') }}
          </span>
          <span class="hidden sm:block text-left leading-tight whitespace-nowrap">
            <span class="block font-medium">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</span>
            <span class="block text-xs text-header-text/70">{{ auth.roleLabel }}</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" class="opacity-70"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
        </button>

        <!-- Phones: a light dimmed layer behind the menu. Tapping it closes the
             menu without also pressing whatever is underneath. -->
        <div v-if="menuOpen" class="sm:hidden fixed inset-x-0 top-16 bottom-0 z-30 bg-black/25" aria-hidden="true" @click="closeMenu()" />
        <!-- A panel on top of the page, anchored under the avatar and capped to the
             screen height: the links scroll and the account section stays pinned. -->
        <div v-if="menuOpen" id="account-menu"
          class="fixed right-2 top-[4.25rem] z-40 w-[min(20rem,calc(100vw-1rem))] max-h-[calc(100dvh-5rem)] flex flex-col bg-surface text-text rounded-xl border border-border shadow-xl overflow-hidden
                 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-72">
          <div class="px-4 py-3 border-b border-border sm:hidden">
            <p class="font-medium">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</p>
            <p class="text-xs text-text-muted">{{ auth.roleLabel }}<template v-if="auth.user?.programName"> · {{ auth.user.programName }}</template></p>
          </div>

          <nav class="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1" aria-label="Menu">
            <div v-if="auth.isSuperAdmin" class="md:hidden px-4 py-3 border-b border-border">
              <ProgramSwitcher />
            </div>
            <section v-for="g in menuGroups" :key="g.id" class="border-b border-border last:border-b-0 py-1" :class="g.allInHeader && 'xl:hidden'">
              <button v-if="collapsible" type="button" class="w-full flex items-center justify-between px-4 py-2.5 sm:py-2 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text"
                :aria-expanded="groupOpen(g)" :aria-controls="`menu-group-${g.id}`" @click="toggleGroup(g)">
                <span>{{ g.label }}<span v-if="!groupOpen(g) && g.items.some((i) => i.badge) && badge.count" class="ml-2 badge bg-highlight text-black !py-0 !px-1.5 normal-case tracking-normal">{{ badge.count }}</span></span>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" class="transition-transform" :class="groupOpen(g) && 'rotate-180'"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
              </button>
              <p v-else-if="menuGroups.length > 1" class="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted" :class="g.allInHeader && 'xl:hidden'">{{ g.label }}</p>
              <ul v-show="groupOpen(g)" :id="`menu-group-${g.id}`">
                <li v-for="n in g.items" :key="n.to" :class="n.inHeader && 'xl:hidden'">
                  <RouterLink :to="n.to" class="flex items-center px-4 py-3 sm:py-2 text-sm hover:bg-background"
                    :class="isActive(n.to) && 'font-semibold text-accent'" :aria-current="isActive(n.to) ? 'page' : undefined">
                    {{ n.label }}<span v-if="n.badge && badge.count" class="ml-1.5 badge bg-highlight text-black !py-0 !px-1.5">{{ badge.count }}</span>
                  </RouterLink>
                </li>
              </ul>
            </section>
          </nav>

          <!-- Always visible, however long the list above. -->
          <div class="shrink-0 border-t border-border py-1 bg-surface pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_-6px_10px_-8px_rgba(0,0,0,0.25)]">
            <RouterLink to="/help" class="block px-4 py-3 sm:py-2 text-sm hover:bg-background" :class="route.path.startsWith('/help') && 'font-semibold text-accent'">Help &amp; user guide</RouterLink>
            <RouterLink to="/change-password" class="block px-4 py-3 sm:py-2 text-sm hover:bg-background">Change password</RouterLink>
            <button type="button" class="block w-full text-left px-4 py-3 sm:py-2 text-sm hover:bg-background" @click="signOut">Sign out</button>
          </div>
        </div>
      </div>
    </header>

    <main class="flex-1 w-full max-w-7xl mx-auto px-4 md:px-6 py-6">
      <RouterView :key="ctx.programId" />
    </main>
  </div>
</template>
