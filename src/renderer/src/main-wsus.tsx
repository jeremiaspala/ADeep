import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import WsusConsole from './consoles/wsus/WsusConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <WsusConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
