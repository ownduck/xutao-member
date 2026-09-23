import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from './require-permission.decorator.js';
import { PermissionService } from './permission.service.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { id?: string };
      session?: { user?: { id?: string } };
    }>();
    const userId = request.user?.id ?? request.session?.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }

    const permissions =
      await this.permissionService.getEffectivePermissions(userId);
    if (
      !this.permissionService.hasPermission(
        permissions,
        required.code,
        required.level,
      )
    ) {
      throw new ForbiddenException('Insufficient permission');
    }
    return true;
  }
}
