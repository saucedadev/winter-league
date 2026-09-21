import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// Ports are offset from Gym Hive's (5173 / 4000) so both apps can run
// side by side on the same machine.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5174,
    // Stop with "Port 5174 is already in use" instead of quietly moving to
    // 5175, which the backend's APP_URL wouldn't allow.
    strictPort: true,
    proxy: { '/api': 'http://localhost:4100' },
  },
});
