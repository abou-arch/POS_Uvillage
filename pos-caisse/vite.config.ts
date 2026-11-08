import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Politique de sécurité du contenu (CSP), ajoutée au build seulement : le serveur de dev injecte des scripts en ligne
// qu'elle bloquerait. Seuls les fichiers de la caisse s'exécutent, et les appels réseau ne vont que vers l'API
// configurée : un script injecté ne pourrait ni se lancer ni envoyer le token ou les clients ailleurs.
// frame-ancestors (contre l'intégration dans une page piégée) ne passe pas par une balise meta : voir docs/SECURITE.md.
function contentSecurityPolicy(apiUrl: string): Plugin {
  let api = ''
  try {
    api = new URL(apiUrl).origin
  } catch {
    // Adresse invalide : la caisse affiche l'erreur de configuration et n'appelle rien.
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: https: ${api}`.trim(), // photos d'articles servies par l'API ou un CDN
    `connect-src 'self' ${api}`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'caisse-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [
      react(),
      contentSecurityPolicy(env.VITE_API_URL ?? 'http://localhost:4000/api'), // même défaut que src/api/client.ts
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
  }
})
