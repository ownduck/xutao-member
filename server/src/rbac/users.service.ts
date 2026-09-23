import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { auth } from '../auth/auth.js';
import { createCredentialUser } from '../auth/create-user.js';
import { db } from '../db/index.js';
import {
  authRole,
  authUserRoles,
  user,
} from '../db/schema.js';
import { PermissionService } from './permission.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly permissionService: PermissionService) {}

  async list() {
    const users = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        realname: user.realname,
        isSuperAdmin: user.isSuperAdmin,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .orderBy(asc(user.createdAt));

    const links = await db
      .select({
        userId: authUserRoles.userId,
        roleId: authUserRoles.roleId,
        roleName: authRole.name,
      })
      .from(authUserRoles)
      .innerJoin(authRole, eq(authRole.roleId, authUserRoles.roleId))
      .where(eq(authRole.isDel, false));

    const rolesByUser = new Map<
      string,
      { roleId: number; name: string }[]
    >();
    for (const link of links) {
      const list = rolesByUser.get(link.userId) ?? [];
      list.push({ roleId: link.roleId, name: link.roleName });
      rolesByUser.set(link.userId, list);
    }

    return users.map((u) => ({
      ...u,
      roles: rolesByUser.get(u.id) ?? [],
    }));
  }

  async create(body: {
    email: string;
    password: string;
    name: string;
    realname?: string;
    roleIds?: number[];
  }) {
    if (!body.email || !body.password || !body.name) {
      throw new BadRequestException('email, password, name are required');
    }

    let created;
    try {
      created = await createCredentialUser({
        email: body.email,
        password: body.password,
        name: body.name,
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'USER_ALREADY_EXISTS') {
        throw new BadRequestException('User already exists');
      }
      throw e;
    }

    await db
      .update(user)
      .set({
        realname: body.realname ?? null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, created.id));

    if (body.roleIds?.length) {
      await this.setRoles(created.id, body.roleIds);
    }

    return this.getById(created.id);
  }

  async resetPassword(id: string, password: string) {
    await this.ensureExists(id);
    if (await this.permissionService.isSuperAdmin(id)) {
      throw new ForbiddenException('Cannot reset super admin password');
    }
    if (!password || password.length < 8) {
      throw new BadRequestException('密码至少 8 位');
    }

    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);
    await ctx.internalAdapter.updatePassword(id, hash);
    return { ok: true };
  }

  async update(
    id: string,
    body: { email?: string; name?: string; realname?: string | null },
  ) {
    await this.ensureExists(id);
    if (await this.permissionService.isSuperAdmin(id)) {
      throw new ForbiddenException('Cannot modify super admin');
    }

    const patch: Partial<typeof user.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase();
      if (!email) throw new BadRequestException('邮箱不能为空');
      const [dup] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      if (dup && dup.id !== id) {
        throw new BadRequestException('邮箱已被占用');
      }
      patch.email = email;
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('用户名不能为空');
      patch.name = name;
    }
    if (body.realname !== undefined) patch.realname = body.realname;

    await db.update(user).set(patch).where(eq(user.id, id));
    return this.getById(id);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    if (await this.permissionService.isSuperAdmin(id)) {
      throw new ForbiddenException('Cannot delete super admin');
    }
    await db.delete(user).where(eq(user.id, id));
    return { ok: true };
  }

  async getRoles(userId: string) {
    await this.ensureExists(userId);
    return db
      .select({
        roleId: authRole.roleId,
        name: authRole.name,
        description: authRole.description,
      })
      .from(authUserRoles)
      .innerJoin(authRole, eq(authRole.roleId, authUserRoles.roleId))
      .where(
        and(eq(authUserRoles.userId, userId), eq(authRole.isDel, false)),
      );
  }

  async setRoles(userId: string, roleIds: number[]) {
    await this.ensureExists(userId);
    if (await this.permissionService.isSuperAdmin(userId)) {
      throw new ForbiddenException('Cannot modify super admin roles');
    }

    const uniqueIds = [...new Set(roleIds)];
    if (uniqueIds.length) {
      const roles = await db
        .select({ roleId: authRole.roleId })
        .from(authRole)
        .where(
          and(inArray(authRole.roleId, uniqueIds), eq(authRole.isDel, false)),
        );
      if (roles.length !== uniqueIds.length) {
        throw new BadRequestException('One or more roles not found');
      }
    }

    await db.delete(authUserRoles).where(eq(authUserRoles.userId, userId));
    if (uniqueIds.length) {
      await db.insert(authUserRoles).values(
        uniqueIds.map((roleId) => ({ userId, roleId })),
      );
    }
    return this.getRoles(userId);
  }

  private async getById(id: string) {
    const [u] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        realname: user.realname,
        isSuperAdmin: user.isSuperAdmin,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    if (!u) throw new NotFoundException('User not found');
    const roles = await this.getRoles(id);
    return { ...u, roles };
  }

  private async ensureExists(id: string) {
    const [u] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    if (!u) throw new NotFoundException('User not found');
  }
}
