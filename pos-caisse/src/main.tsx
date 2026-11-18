import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import App from './App.tsx'
import { installRipples } from './components/fx'

installRipples() // onde au toucher sur les boutons

// Démo (npm run build:demo) : la fausse API tourne dans la page. Absent du build normal (code mort éliminé).
if (import.meta.env.MODE === 'demo') await (await import('./demo/install')).installDemoApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
