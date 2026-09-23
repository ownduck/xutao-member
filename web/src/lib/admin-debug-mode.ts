export const ADMIN_DEBUG_MODE_STORAGE_KEY = 'member-admin-debug-mode'

export function readAdminDebugModeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ADMIN_DEBUG_MODE_STORAGE_KEY) === '1'
}

export function writeAdminDebugModeEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    ADMIN_DEBUG_MODE_STORAGE_KEY,
    enabled ? '1' : '0',
  )
}
