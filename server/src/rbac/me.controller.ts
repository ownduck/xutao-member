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
    const userId = session.user.id;
    const [permissions, flags] = await Promise.all([
      this.permissionService.getEffectivePermissions(userId),
      this.permissionService.getActorFlags(userId),
    ]);
    return {
      user: session.user,
      permissions,
      isSuperAdmin: flags.isSuperAdmin,
      roles: flags.roles,
      roleKeys: flags.roleKeys,
      isDealer: flags.isDealer,
      isOps: flags.isOps,
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
