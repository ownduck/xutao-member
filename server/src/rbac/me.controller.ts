import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth.js';
import { PermissionService } from './permission.service.js';

@Controller('api/me')
export class MeController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  async me(@Session() session: UserSession<typeof auth>) {
    const permissions = await this.permissionService.getEffectivePermissions(
      session.user.id,
    );
    const isSuperAdmin = await this.permissionService.isSuperAdmin(
      session.user.id,
    );
    const roles = await this.permissionService.getUserRoles(session.user.id);
    const roleKeys = await this.permissionService.getRoleKeys(session.user.id);
    return {
      user: session.user,
      permissions,
      isSuperAdmin,
      roles,
      roleKeys,
      isDealer: await this.permissionService.isDealerUser(session.user.id),
      isOps: await this.permissionService.isOpsUser(session.user.id),
    };
  }

  @Get('permissions')
  async permissions(@Session() session: UserSession<typeof auth>) {
    return this.permissionService.getEffectivePermissions(session.user.id);
  }

  /** Change password for the currently logged-in user. */
  @Put('password')
  async changePassword(
    @Session() session: UserSession<typeof auth>,
    @Body() body: { password: string },
  ) {
    const password = body?.password?.trim();
    if (!password || password.length < 6) {
      throw new BadRequestException('密码至少 6 位');
    }
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);
    await ctx.internalAdapter.updatePassword(session.user.id, hash);
    return { ok: true };
  }
}
