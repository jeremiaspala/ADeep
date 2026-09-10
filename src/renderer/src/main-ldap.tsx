import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import LdapConsole from './consoles/ldap/LdapConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <LdapConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
