import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard } from './permission.guard.js';
import { PermissionService } from './permission.service.js';
import { RequirePermission } from './require-permission.decorator.js';
import { RolesService } from './roles.service.js';

@Controller('api/rbac/roles')
@UseGuards(PermissionGuard)
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly permissionService: PermissionService,
  ) {}

  @Get()
  async list(@Req() req: { user?: { id?: string } }) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();
    const permissions =
      await this.permissionService.getEffectivePermissions(userId);
    const ok =
      this.permissionService.hasPermission(permissions, 'role_config', 'ro') ||
      this.permissionService.hasPermission(permissions, 'user_config', 'ro');
    if (!ok) throw new ForbiddenException('Insufficient permission');
    return this.rolesService.list();
  }

  @Post()
  @RequirePermission('role_config', 'rw')
  create(
    @Body() body: { name: string; description?: string; key?: string },
  ) {
    return this.rolesService.create(body);
  }

  @Put(':id')
  @RequirePermission('role_config', 'rw')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { name?: string; description?: string | null; key?: string | null },
  ) {
    return this.rolesService.update(id, body);
  }

  @Delete(':id')
  @RequirePermission('role_config', 'rw')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.remove(id);
  }

  @Get(':id/permissions')
  @RequirePermission('role_config', 'ro')
  getPermissions(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.getPermissions(id);
  }

  @Put(':id/permissions')
  @RequirePermission('role_config', 'rw')
  setPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { permissionIds?: number[]; readOnlyPermissionIds?: number[] },
  ) {
    return this.rolesService.setPermissions(
      id,
      body.permissionIds ?? [],
      body.readOnlyPermissionIds ?? [],
    );
  }
}
