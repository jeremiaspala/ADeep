import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import DnsConsole from './consoles/dns/DnsConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <DnsConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
