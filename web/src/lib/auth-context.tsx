import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { api, type MeUser } from './api'
import { useSession } from './auth-client'
import {
  clearPermissions,
  loadPermissions,
  can as readCan,
} from './permission'

type AuthContextValue = {
  user: MeUser | null
  permissions: string[]
  roleKeys: string[]
  isSuperAdmin: boolean
  loading: boolean
  refresh: () => Promise<void>
  can: (code: string, mode?: 'ro' | 'rw') => boolean
  isDealer: () => boolean
  isOps: () => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const { data: session, isPending } = useSession()
  const [user, setUser] = useState<MeUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [roleKeys, setRoleKeys] = useState<string[]>([])
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isDealerFlag, setIsDealerFlag] = useState(false)
  const [isOpsFlag, setIsOpsFlag] = useState(false)
  const [meLoading, setMeLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setUser(null)
      setPermissions([])
      setRoleKeys([])
      setIsSuperAdmin(false)
      setIsDealerFlag(false)
      setIsOpsFlag(false)
      clearPermissions()
      return
    }

    setMeLoading(true)
    try {
      const me = await api.me()
      setUser(me.user)
      setPermissions(me.permissions ?? [])
      setRoleKeys(me.roleKeys ?? [])
      setIsSuperAdmin(Boolean(me.isSuperAdmin))
      setIsDealerFlag(Boolean(me.isDealer))
      setIsOpsFlag(Boolean(me.isOps))
      loadPermissions(me.permissions ?? [], Boolean(me.isSuperAdmin))
    } catch {
      const fallback: MeUser = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        isSuperAdmin: Boolean(
          (session.user as { isSuperAdmin?: boolean }).isSuperAdmin,
        ),
        realname: (session.user as { realname?: string | null }).realname,
      }
      setUser(fallback)
      const sa = Boolean(fallback.isSuperAdmin)
      setIsSuperAdmin(sa)
      setPermissions([])
      setRoleKeys([])
      setIsDealerFlag(false)
      setIsOpsFlag(sa)
      loadPermissions([], sa)
    } finally {
      setMeLoading(false)
    }
  }, [session])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      roleKeys,
      isSuperAdmin,
      loading: isPending || meLoading,
      refresh,
      can: (code, mode = 'ro') => {
        if (isSuperAdmin) return true
        return readCan(code, mode)
      },
      isDealer: () => isDealerFlag || roleKeys.includes('dealer'),
      isOps: () =>
        isOpsFlag || isSuperAdmin || roleKeys.includes('ops'),
    }),
    [
      user,
      permissions,
      roleKeys,
      isSuperAdmin,
      isDealerFlag,
      isOpsFlag,
      isPending,
      meLoading,
      refresh,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
