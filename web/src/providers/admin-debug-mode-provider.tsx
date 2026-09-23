import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  readAdminDebugModeEnabled,
  writeAdminDebugModeEnabled,
} from '../lib/admin-debug-mode'

type AdminDebugModeContextValue = {
  debugMode: boolean
  setDebugMode: (enabled: boolean) => void
}

const AdminDebugModeContext =
  createContext<AdminDebugModeContextValue | null>(null)

export function AdminDebugModeProvider({ children }: PropsWithChildren) {
  const [debugMode, setDebugModeState] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setDebugModeState(readAdminDebugModeEnabled())
    setHydrated(true)
  }, [])

  const value = useMemo(
    () => ({
      debugMode: hydrated ? debugMode : false,
      setDebugMode: (enabled: boolean) => {
        writeAdminDebugModeEnabled(enabled)
        setDebugModeState(enabled)
      },
    }),
    [debugMode, hydrated],
  )

  return (
    <AdminDebugModeContext.Provider value={value}>
      {children}
    </AdminDebugModeContext.Provider>
  )
}

export function useAdminDebugMode() {
  const context = useContext(AdminDebugModeContext)
  if (!context) {
    throw new Error(
      'useAdminDebugMode must be used within AdminDebugModeProvider',
    )
  }
  return context
}
