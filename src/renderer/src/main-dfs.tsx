import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import DfsConsole from './consoles/dfs/DfsConsole'
import { ConfirmProvider, Toasts } from './components/ui'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfirmProvider>
      <DfsConsole />
      <Toasts />
    </ConfirmProvider>
  </StrictMode>
)
