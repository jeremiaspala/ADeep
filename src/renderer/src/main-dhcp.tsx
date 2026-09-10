import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import DhcpConsole from './consoles/dhcp/DhcpConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <DhcpConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
