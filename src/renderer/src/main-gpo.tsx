import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import GpoConsole from './consoles/gpo/GpoConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <GpoConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
