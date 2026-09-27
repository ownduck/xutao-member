import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

function clearAuthState(
  setUser: (v: MeUser | null) => void,
  setPermissions: (v: string[]) => void,
  setRoleKeys: (v: string[]) => void,
  setIsSuperAdmin: (v: boolean) => void,
  setIsDealerFlag: (v: boolean) => void,
  setIsOpsFlag: (v: boolean) => void,
) {
  setUser(null)
  setPermissions([])
  setRoleKeys([])
  setIsSuperAdmin(false)
  setIsDealerFlag(false)
  setIsOpsFlag(false)
  clearPermissions()
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { data: session, isPending, isRefetching } = useSession()
  const sessionUser = session?.user
  const sessionUserId = sessionUser?.id
  const sessionUserRef = useRef(sessionUser)
  sessionUserRef.current = sessionUser

  const [user, setUser] = useState<MeUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [roleKeys, setRoleKeys] = useState<string[]>([])
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isDealerFlag, setIsDealerFlag] = useState(false)
  const [isOpsFlag, setIsOpsFlag] = useState(false)
  const [meLoading, setMeLoading] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)

  const loadMe = useCallback(async () => {
    const current = sessionUserRef.current
    if (!current?.id) return

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
        id: current.id,
        name: current.name,
        email: current.email,
        image: current.image,
        isSuperAdmin: Boolean(
          (current as { isSuperAdmin?: boolean }).isSuperAdmin,
        ),
        realname: (current as { realname?: string | null }).realname,
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
      setBootstrapped(true)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!sessionUserRef.current?.id) {
      clearAuthState(
        setUser,
        setPermissions,
        setRoleKeys,
        setIsSuperAdmin,
        setIsDealerFlag,
        setIsOpsFlag,
      )
      setBootstrapped(true)
      return
    }
    await loadMe()
  }, [loadMe])

  useEffect(() => {
    // Session still resolving / background refetch — keep last known auth user.
    if (isPending || isRefetching) return

    if (!sessionUserId) {
      clearAuthState(
        setUser,
        setPermissions,
        setRoleKeys,
        setIsSuperAdmin,
        setIsDealerFlag,
        setIsOpsFlag,
      )
      setBootstrapped(true)
      return
    }

    void loadMe()
  }, [sessionUserId, isPending, isRefetching, loadMe])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      roleKeys,
      isSuperAdmin,
      // Block only the first cold start; never flip loading on tab focus refetch.
      loading: !bootstrapped && (isPending || meLoading),
      refresh,
      can: (code, mode = 'ro') => {
        if (isSuperAdmin) return true
        return readCan(code, mode)
      },
      isDealer: () => isDealerFlag,
      isOps: () => isOpsFlag || isSuperAdmin,
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
      bootstrapped,
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
