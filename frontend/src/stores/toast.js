import { defineStore } from 'pinia';

let seq = 0;
export const useToast = defineStore('toast', {
  state: () => ({ items: [] }),
  actions: {
    show(message, kind = 'success', ms = 3500) {
      const id = ++seq;
      this.items.push({ id, message, kind });
      setTimeout(() => this.dismiss(id), ms);
    },
    success(m) { this.show(m, 'success'); },
    error(m) { this.show(m, 'error', 6000); },
    dismiss(id) { this.items = this.items.filter((t) => t.id !== id); },
  },
});
