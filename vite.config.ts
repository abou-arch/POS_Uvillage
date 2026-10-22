import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA : la caisse s'installe et se recharge sans réseau. Le service worker (src/sw/sw.ts) met en cache l'application
    // (HTML, JS, CSS, icônes) ; les données (catalogue, ventes) sont dans IndexedDB, pas dans ce cache.
    // Une nouvelle version s'installe en arrière-plan et sert au rechargement suivant : jamais en pleine vente.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: {
        name: 'Caisse POS',
        short_name: 'Caisse',
        description: 'Écran de caisse : vente, paiement et ticket, avec ou sans connexion.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#eef2f6',
        theme_color: '#1f6fb5',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
})
