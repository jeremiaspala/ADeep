import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import SitesConsole from './consoles/sites/SitesConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <SitesConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
