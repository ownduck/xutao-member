import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  authPermission,
  authRole,
  authRolePermissions,
} from '../db/schema.js';
import { generateRoleKey } from './role-key.js';

@Injectable()
export class RolesService {
  async list() {
    return db
      .select({
        roleId: authRole.roleId,
        name: authRole.name,
        key: authRole.key,
        description: authRole.description,
        createTime: authRole.createTime,
        updateTime: authRole.updateTime,
      })
      .from(authRole)
      .where(eq(authRole.isDel, false))
      .orderBy(asc(authRole.roleId));
  }

  async create(body: { name: string; description?: string; key?: string }) {
    if (!body.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    const key = await this.resolveUniqueKey(
      body.key?.trim() || generateRoleKey(body.name),
    );
    const [row] = await db
      .insert(authRole)
      .values({
        name: body.name.trim(),
        key,
        description: body.description ?? null,
      })
      .returning();
    return row;
  }

  async update(
    roleId: number,
    body: {
      name?: string;
      description?: string | null;
      key?: string | null;
    },
  ) {
    await this.ensureExists(roleId);
    const patch: Partial<typeof authRole.$inferInsert> = {
      updateTime: new Date(),
    };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description;
    if (body.key !== undefined) {
      const next =
        body.key?.trim() ||
        generateRoleKey(body.name?.trim() || (await this.getName(roleId)));
      patch.key = await this.resolveUniqueKey(next, roleId);
    }

    const [row] = await db
      .update(authRole)
      .set(patch)
      .where(eq(authRole.roleId, roleId))
      .returning();
    return row;
  }

  async remove(roleId: number) {
    await this.ensureExists(roleId);
    await db
      .update(authRole)
      .set({ isDel: true, updateTime: new Date() })
      .where(eq(authRole.roleId, roleId));
    await db
      .delete(authRolePermissions)
      .where(eq(authRolePermissions.roleId, roleId));
    return { ok: true };
  }

  async getPermissions(roleId: number) {
    await this.ensureExists(roleId);
    return db
      .select({
        permissionId: authPermission.permissionId,
        parentPermissionId: authPermission.parentPermissionId,
        code: authPermission.code,
        name: authPermission.name,
        description: authPermission.description,
        rw: authRolePermissions.rw,
      })
      .from(authRolePermissions)
      .innerJoin(
        authPermission,
        eq(authPermission.permissionId, authRolePermissions.permissionId),
      )
      .where(eq(authRolePermissions.roleId, roleId))
      .orderBy(asc(authPermission.sort));
  }

  async setPermissions(
    roleId: number,
    permissionIds: number[],
    readOnlyPermissionIds: number[],
  ) {
    await this.ensureExists(roleId);

    const rwIds = [...new Set(permissionIds)];
    const roIds = [...new Set(readOnlyPermissionIds)].filter(
      (id) => !rwIds.includes(id),
    );
    const allIds = [...rwIds, ...roIds];

    if (allIds.length) {
      const found = await db
        .select({ permissionId: authPermission.permissionId })
        .from(authPermission)
        .where(inArray(authPermission.permissionId, allIds));
      if (found.length !== allIds.length) {
        throw new BadRequestException('One or more permissions not found');
      }
    }

    await db
      .delete(authRolePermissions)
      .where(eq(authRolePermissions.roleId, roleId));

    if (allIds.length) {
      await db.insert(authRolePermissions).values([
        ...rwIds.map((permissionId) => ({
          roleId,
          permissionId,
          rw: 'rw',
        })),
        ...roIds.map((permissionId) => ({
          roleId,
          permissionId,
          rw: 'ro',
        })),
      ]);
    }

    return this.getPermissions(roleId);
  }

  private async getName(roleId: number) {
    const [row] = await db
      .select({ name: authRole.name })
      .from(authRole)
      .where(eq(authRole.roleId, roleId))
      .limit(1);
    return row?.name ?? 'role';
  }

  private async resolveUniqueKey(base: string, excludeRoleId?: number) {
    let key = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60);
    if (!key) key = `role_${Date.now().toString(36)}`;
    let candidate = key;
    let i = 1;
    for (;;) {
      const conditions = [eq(authRole.key, candidate)];
      if (excludeRoleId != null) {
        conditions.push(ne(authRole.roleId, excludeRoleId));
      }
      const [hit] = await db
        .select({ roleId: authRole.roleId })
        .from(authRole)
        .where(and(...conditions))
        .limit(1);
      if (!hit) return candidate;
      candidate = `${key}_${i++}`.slice(0, 64);
    }
  }

  private async ensureExists(roleId: number) {
    const [row] = await db
      .select({ roleId: authRole.roleId })
      .from(authRole)
      .where(and(eq(authRole.roleId, roleId), eq(authRole.isDel, false)))
      .limit(1);
    if (!row) throw new NotFoundException('Role not found');
  }
}
