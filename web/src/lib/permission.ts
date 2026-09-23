import type { AdminMenuItem } from '../config/adminMenu'

let permissions: string[] = []
let superAdmin = false

export function loadPermissions(
  list: string[],
  isSuperAdminFlag = false,
): void {
  permissions = Array.isArray(list) ? [...list] : []
  superAdmin = Boolean(isSuperAdminFlag)
}

export function clearPermissions(): void {
  permissions = []
  superAdmin = false
}

/** Check access. `rw` implies `ro`. Super admin always passes. */
export function can(code: string, mode: 'ro' | 'rw' = 'ro'): boolean {
  if (superAdmin) return true
  if (mode === 'rw') {
    return permissions.includes(`${code}:rw`)
  }
  return (
    permissions.includes(`${code}:ro`) || permissions.includes(`${code}:rw`)
  )
}

/** Filter menus by `permission` requiring at least read access. */
export function filterMenus(menus: AdminMenuItem[]): AdminMenuItem[] {
  if (superAdmin) return menus

  return menus
    .map((item) => {
      const children = item.children
        ? filterMenus(item.children)
        : undefined
      return { ...item, children }
    })
    .filter((item) => {
      const hasChildren = Boolean(item.children?.length)
      if (hasChildren) return true
      if (!item.permission) return true
      if (item.children && item.children.length === 0) {
        return item.permission ? can(item.permission, 'ro') : false
      }
      return can(item.permission, 'ro')
    })
    .map((item) => {
      if (item.children && item.children.length === 0) {
        const { children: _c, ...rest } = item
        return rest
      }
      return item
    })
}
