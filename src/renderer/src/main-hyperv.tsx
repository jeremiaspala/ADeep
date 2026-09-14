import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import HyperVConsole from './consoles/hyperv/HyperVConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <HyperVConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
