import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard } from './permission.guard.js';
import { RequirePermission } from './require-permission.decorator.js';
import { UsersService } from './users.service.js';

@Controller('api/rbac/users')
@UseGuards(PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('user_config', 'ro')
  list() {
    return this.usersService.list();
  }

  @Post()
  @RequirePermission('user_config', 'rw')
  create(
    @Body()
    body: {
      email: string;
      password: string;
      name: string;
      realname?: string;
      roleIds?: number[];
    },
  ) {
    return this.usersService.create(body);
  }

  @Put(':id/password')
  @RequirePermission('user_config', 'rw')
  resetPassword(
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    return this.usersService.resetPassword(id, body.password);
  }

  @Put(':id/roles')
  @RequirePermission('user_config', 'rw')
  setRoles(@Param('id') id: string, @Body() body: { roleIds: number[] }) {
    return this.usersService.setRoles(id, body.roleIds ?? []);
  }

  @Put(':id')
  @RequirePermission('user_config', 'rw')
  update(
    @Param('id') id: string,
    @Body()
    body: { email?: string; name?: string; realname?: string | null },
  ) {
    return this.usersService.update(id, body);
  }

  @Delete(':id')
  @RequirePermission('user_config', 'rw')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Get(':id/roles')
  @RequirePermission('user_config', 'ro')
  getRoles(@Param('id') id: string) {
    return this.usersService.getRoles(id);
  }
}
