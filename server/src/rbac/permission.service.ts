import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  authPermission,
  authRole,
  authRolePermissions,
  authUserRoles,
  user,
} from '../db/schema.js';
import { ROLE_KEY_DEALER, ROLE_KEY_OPS } from './role-key.js';

@Injectable()
export class PermissionService {
  async getEffectivePermissions(userId: string): Promise<string[]> {
    const [u] = await db
      .select({
        id: user.id,
        isSuperAdmin: user.isSuperAdmin,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!u) {
      return [];
    }

    if (u.isSuperAdmin) {
      const all = await db
        .select({ code: authPermission.code })
        .from(authPermission);
      return all.map((p) => `${p.code}:rw`);
    }

    const roleRows = await db
      .select({ roleId: authUserRoles.roleId })
      .from(authUserRoles)
      .where(eq(authUserRoles.userId, userId));

    if (roleRows.length === 0) {
      return [];
    }

    const roleIds = roleRows.map((r) => r.roleId);
    const rows = await db
      .select({
        code: authPermission.code,
        rw: authRolePermissions.rw,
      })
      .from(authRolePermissions)
      .innerJoin(
        authPermission,
        eq(authPermission.permissionId, authRolePermissions.permissionId),
      )
      .where(inArray(authRolePermissions.roleId, roleIds));

    const merged = new Map<string, 'ro' | 'rw'>();
    for (const row of rows) {
      const level = row.rw === 'rw' ? 'rw' : 'ro';
      const prev = merged.get(row.code);
      if (!prev || (prev === 'ro' && level === 'rw')) {
        merged.set(row.code, level);
      }
    }

    return [...merged.entries()].map(([code, level]) => `${code}:${level}`);
  }

  hasPermission(
    permissions: string[],
    code: string,
    level: 'ro' | 'rw',
  ): boolean {
    const rw = `${code}:rw`;
    const ro = `${code}:ro`;
    if (level === 'rw') {
      return permissions.includes(rw);
    }
    return permissions.includes(rw) || permissions.includes(ro);
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const [u] = await db
      .select({ isSuperAdmin: user.isSuperAdmin })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return !!u?.isSuperAdmin;
  }

  async getUserRoles(userId: string) {
    return db
      .select({
        roleId: authRole.roleId,
        name: authRole.name,
        key: authRole.key,
      })
      .from(authUserRoles)
      .innerJoin(authRole, eq(authRole.roleId, authUserRoles.roleId))
      .where(and(eq(authUserRoles.userId, userId), eq(authRole.isDel, false)));
  }

  async getRoleKeys(userId: string): Promise<string[]> {
    if (await this.isSuperAdmin(userId)) {
      return [ROLE_KEY_DEALER, ROLE_KEY_OPS];
    }
    const roles = await this.getUserRoles(userId);
    return roles
      .map((r) => r.key)
      .filter((k): k is string => !!k && k.length > 0);
  }

  async hasRoleKey(userId: string, key: string): Promise<boolean> {
    if (await this.isSuperAdmin(userId)) return true;
    const keys = await this.getRoleKeys(userId);
    return keys.includes(key);
  }

  async isDealerUser(userId: string): Promise<boolean> {
    if (await this.isSuperAdmin(userId)) return false;
    return this.hasRoleKey(userId, ROLE_KEY_DEALER);
  }

  async isOpsUser(userId: string): Promise<boolean> {
    if (await this.isSuperAdmin(userId)) return true;
    return this.hasRoleKey(userId, ROLE_KEY_OPS);
  }

  async assertNotSuperAdminTarget(userId: string): Promise<void> {
    if (await this.isSuperAdmin(userId)) {
      throw new Error('SUPER_ADMIN_PROTECTED');
    }
  }

  async listPermissions() {
    return db
      .select()
      .from(authPermission)
      .where(and(eq(authPermission.hide, false)))
      .orderBy(asc(authPermission.sort));
  }
}
