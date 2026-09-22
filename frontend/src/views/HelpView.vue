<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useBrandingStore } from '../stores/branding';
import { GUIDES, ROLE_GUIDE, guidesFor, findGuide, pdfUrl, renderGuide } from '../help/guides';
import '../help/guide.css';

const auth = useAuthStore();
const branding = useBrandingStore();
const route = useRoute();
const router = useRouter();

const available = computed(() => guidesFor(auth.user?.role));
const ownId = computed(() => ROLE_GUIDE[auth.user?.role] || GUIDES[0].id);
// Anyone may open a guide by link, but the list shows the ones meant for them.
const guide = computed(() => findGuide(route.params.guide) || findGuide(ownId.value));
watch(() => route.params.guide, (id) => { if (!id || !findGuide(id)) router.replace(`/help/${ownId.value}`); }, { immediate: true });

const rendered = computed(() => (guide.value ? renderGuide(guide.value, branding.appName) : { html: '', toc: [] }));
const tocOpen = ref(false);

// Links inside a guide: other guides open in the app; #section links scroll.
const content = ref(null);
function onContentClick(e) {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (href.startsWith('/help/')) { e.preventDefault(); router.push(href); }
}
function jump(id) {
  tocOpen.value = false;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
watch(guide, async () => { await nextTick(); window.scrollTo({ top: 0 }); });
</script>

<template>
  <div v-if="guide" class="grid gap-6 lg:grid-cols-[15rem_1fr] items-start">
    <!-- Sidebar: which guides, and this guide's sections -->
    <aside class="lg:sticky lg:top-20 space-y-4">
      <div v-if="available.length > 1" class="card card-blocky p-2">
        <p class="px-2 pt-1 pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Guides</p>
        <nav aria-label="Guides">
          <RouterLink v-for="g in available" :key="g.id" :to="`/help/${g.id}`"
            class="block rounded-lg px-3 py-2 text-sm hover:bg-background"
            :class="g.id === guide.id && 'bg-background font-semibold text-accent'" :aria-current="g.id === guide.id ? 'page' : undefined">
            {{ g.title }}<span v-if="g.id === ownId" class="text-xs text-text-muted font-normal"> · yours</span>
          </RouterLink>
        </nav>
      </div>
      <div class="card card-blocky p-2">
        <button type="button" class="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted lg:cursor-default"
          :aria-expanded="tocOpen" @click="tocOpen = !tocOpen">
          On this page
          <svg class="lg:hidden transition-transform" :class="tocOpen && 'rotate-180'" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
        </button>
        <ol class="mt-1 lg:block" :class="!tocOpen && 'hidden'">
          <li v-for="s in rendered.toc" :key="s.id">
            <a :href="`#${s.id}`" class="block rounded-lg px-3 py-1.5 text-sm hover:bg-background" @click.prevent="jump(s.id)">{{ s.text }}</a>
          </li>
        </ol>
      </div>
    </aside>

    <div class="min-w-0">
      <div class="flex flex-wrap items-center justify-end gap-2 mb-2">
        <a :href="pdfUrl(guide.id)" :download="`${branding.appName} - ${guide.title}.pdf`" class="btn btn-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="mr-1.5 -ml-0.5"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          Download PDF
        </a>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -- trusted, bundled guide content -->
      <article ref="content" class="guide card p-5 sm:p-8" @click="onContentClick" v-html="rendered.html" />
      <p class="text-xs text-text-muted mt-4">Something missing or unclear? Tell your league’s System Admin so the guide can be improved.</p>
    </div>
  </div>
</template>
