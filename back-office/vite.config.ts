import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Politique de sécurité du contenu, ajoutée au build seulement (le serveur de dev injecte des scripts en ligne) :
// seuls les fichiers du back-office s'exécutent, et les appels réseau ne vont que vers l'API configurée.
function contentSecurityPolicy(apiUrl: string): Plugin {
  let api = ''
  try {
    api = new URL(apiUrl).origin
  } catch {
    // Adresse invalide : l'écran de connexion affiche l'erreur de configuration.
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: https: ${api}`.trim(),
    `connect-src 'self' ${api}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'back-office-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_API_URL ?? 'http://localhost:4100/api')],
    server: { port: 5180, strictPort: true },
    test: { environment: 'node' },
  }
})
