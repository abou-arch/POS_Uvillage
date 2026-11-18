import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import App from './App.tsx'
import { installRipples } from './components/fx'

installRipples() // onde au toucher sur les boutons

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
