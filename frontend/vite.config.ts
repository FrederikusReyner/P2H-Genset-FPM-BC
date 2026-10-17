import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Saat "npm run dev": panggilan /api diteruskan ke server di komputer sendiri (port 4000).
// Saat produksi (Vercel): alamat server diisi lewat VITE_API_URL.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'P2H Genset — Berau Coal',
        short_name: 'P2H Genset',
        description: 'Pemeriksaan harian (P2H) genset semua site: isi form, pantau temuan, dan terima pemberitahuan.',
        lang: 'id',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F2F3EC',
        theme_color: '#10130D',
        categories: ['business', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'P2H baru', short_name: 'P2H baru', url: '/p2h/baru', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Temuan terbuka', short_name: 'Temuan', url: '/temuan', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 700 },
});
