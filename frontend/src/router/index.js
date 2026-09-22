import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useBrandingStore } from '../stores/branding';

const SA = ['super_admin'];
const MANAGERS = ['super_admin', 'program_director'];
const TEAM_VIEWERS = ['super_admin', 'program_director', 'league_coach'];
const REF_MANAGERS = ['super_admin', 'referee_assignor'];

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/forgot-username', component: () => import('../views/ForgotUsernameView.vue'), meta: { public: true } },
  { path: '/forgot-password', component: () => import('../views/ForgotPasswordView.vue'), meta: { public: true } },
  { path: '/reset-password', component: () => import('../views/ResetPasswordView.vue'), meta: { public: true } },
  { path: '/change-password', name: 'change-password', component: () => import('../views/ChangePasswordView.vue'), meta: { allowDuringForcedChange: true } },
  {
    path: '/',
    component: () => import('../layouts/AppLayout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('../views/DashboardView.vue') },
      { path: 'slots', name: 'slots', component: () => import('../views/GymSlotsView.vue'), meta: { roles: MANAGERS, title: 'Gym slots' } },
      { path: 'blackouts', component: () => import('../views/BlackoutsView.vue'), meta: { roles: MANAGERS, title: 'Blackout dates' } },
      { path: 'venues', component: () => import('../views/VenuesView.vue'), meta: { roles: TEAM_VIEWERS, title: 'Venues' } },
      { path: 'teams', component: () => import('../views/TeamsView.vue'), meta: { roles: TEAM_VIEWERS, title: 'Teams' } },
      { path: 'branding', component: () => import('../views/BrandingView.vue'), meta: { roles: SA, title: 'Branding & theme' } },
      { path: 'programs', component: () => import('../views/ProgramsView.vue'), meta: { roles: SA, title: 'Programs' } },
      { path: 'league', component: () => import('../views/LeagueSetupView.vue'), meta: { roles: SA, title: 'League setup' } },
      { path: 'users', component: () => import('../views/UsersView.vue'), meta: { roles: SA, title: 'Users' } },
      { path: 'schedule', component: () => import('../views/ScheduleView.vue'), meta: { title: 'Schedule' } },
      { path: 'schedule/builder', component: () => import('../views/ScheduleBuilderView.vue'), meta: { roles: SA, title: 'Schedule builder' } },
      { path: 'requests', component: () => import('../views/RequestsView.vue'), meta: { roles: TEAM_VIEWERS, title: 'Change requests' } },
      { path: 'assignments', component: () => import('../views/AssignmentsView.vue'), meta: { roles: REF_MANAGERS, title: 'Referee assignments' } },
      { path: 'referees', component: () => import('../views/RefereesView.vue'), meta: { roles: REF_MANAGERS, title: 'Referees' } },
      { path: 'payouts', component: () => import('../views/PayoutsView.vue'), meta: { roles: REF_MANAGERS, title: 'Referee payouts' } },
      { path: 'my-games', component: () => import('../views/MyGamesView.vue'), meta: { roles: ['referee'], title: 'My games' } },
      { path: 'help/:guide?', component: () => import('../views/HelpView.vue'), meta: { title: 'Help' } },
      { path: 'activity', component: () => import('../views/ActivityView.vue'), meta: { roles: MANAGERS, title: 'Activity' } },
    ],
  },
  // Print-ready guide with no app chrome, used to build the downloadable PDFs.
  { path: '/help-print/:guide', component: () => import('../views/GuidePrintView.vue'), meta: { public: true, title: 'Guide' } },
  { path: '/:pathMatch(.*)*', component: () => import('../views/NotFoundView.vue'), meta: { public: true } },
];

export const router = createRouter({ history: createWebHistory(), routes, scrollBehavior: () => ({ top: 0 }) });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.init();
  if (to.meta.public) {
    if (auth.isAuthenticated && to.name === 'login') return { name: 'home' };
    return true;
  }
  if (!auth.isAuthenticated) return { name: 'login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  if (auth.user.mustChangePassword && !to.meta.allowDuringForcedChange) return { name: 'change-password' };
  if (to.meta.roles && !to.meta.roles.includes(auth.user.role)) return { name: 'home' };
  return true;
});

router.afterEach((to) => {
  useBrandingStore().setPageTitle(to.meta.title);
});
