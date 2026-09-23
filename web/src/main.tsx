import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { AuthProvider } from './lib/auth-context'
import { AdminDebugModeProvider } from './providers/admin-debug-mode-provider'
import { AntdProvider } from './theme/antd'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AntdProvider>
        <AuthProvider>
          <AdminDebugModeProvider>
            <App />
          </AdminDebugModeProvider>
        </AuthProvider>
      </AntdProvider>
    </BrowserRouter>
  </StrictMode>,
)
