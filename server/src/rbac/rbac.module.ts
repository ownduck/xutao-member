import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { PermissionGuard } from './permission.guard.js';
import { PermissionService } from './permission.service.js';
import { PermissionsController } from './permissions.controller.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [
    MeController,
    UsersController,
    RolesController,
    PermissionsController,
  ],
  providers: [
    PermissionService,
    PermissionGuard,
    UsersService,
    RolesService,
  ],
  exports: [PermissionService, PermissionGuard],
})
export class RbacModule {}
