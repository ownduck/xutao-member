import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'require_permission';

export type PermissionLevel = 'ro' | 'rw';

export type RequiredPermission = {
  code: string;
  level: PermissionLevel;
};

export const RequirePermission = (code: string, level: PermissionLevel) =>
  SetMetadata(PERMISSION_KEY, { code, level } satisfies RequiredPermission);
