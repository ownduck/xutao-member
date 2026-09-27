import { createAuthClient } from 'better-auth/react'

/**
 * Same-origin client: Vite proxies `/api` → `http://localhost:3000`.
 * Better Auth default path is `/api/auth`.
 *
 * refetchOnWindowFocus is off: focus/visibility refetch was remounting the
 * protected shell (full-page Spin) whenever the tab regained focus.
 */
export const authClient = createAuthClient({
  baseURL: '',
  sessionOptions: {
    refetchOnWindowFocus: false,
    refetchWhenOffline: false,
  },
})

export const { useSession, signIn, signOut } = authClient
