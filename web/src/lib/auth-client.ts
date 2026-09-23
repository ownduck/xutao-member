import { createAuthClient } from 'better-auth/react'

/**
 * Same-origin client: Vite proxies `/api` → `http://localhost:3000`.
 * Better Auth default path is `/api/auth`.
 */
export const authClient = createAuthClient({
  baseURL: '',
})

export const { useSession, signIn, signOut } = authClient
