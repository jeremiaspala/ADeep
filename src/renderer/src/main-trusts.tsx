import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import TrustsConsole from './consoles/trusts/TrustsConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <TrustsConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
