import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionGuard } from './permission.guard.js';
import { PermissionService } from './permission.service.js';

@Controller('api/rbac/permissions')
@UseGuards(PermissionGuard)
export class PermissionsController {
  constructor(private readonly permissionService: PermissionService) {}

  /** Any authenticated user (AuthGuard); used by role/user binding UIs. */
  @Get()
  list() {
    return this.permissionService.listPermissions();
  }
}
