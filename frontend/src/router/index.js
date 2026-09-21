import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const SA = ['super_admin'];
const MANAGERS = ['super_admin', 'program_director'];
const TEAM_VIEWERS = ['super_admin', 'program_director', 'league_coach'];

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
      { path: 'programs', component: () => import('../views/ProgramsView.vue'), meta: { roles: SA, title: 'Programs' } },
      { path: 'league', component: () => import('../views/LeagueSetupView.vue'), meta: { roles: SA, title: 'League setup' } },
      { path: 'users', component: () => import('../views/UsersView.vue'), meta: { roles: SA, title: 'Users' } },
      { path: 'activity', component: () => import('../views/ActivityView.vue'), meta: { roles: MANAGERS, title: 'Activity' } },
    ],
  },
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
  document.title = to.meta.title ? `${to.meta.title} · Winter League` : 'Winter League';
});
