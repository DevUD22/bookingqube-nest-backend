import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ADMIN_PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedAdmin } from '../strategies/admin-jwt.strategy';

@Injectable()
export class AdminPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ADMIN_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const admin = context.switchToHttp().getRequest<{ user?: AuthenticatedAdmin }>().user;
    if (!admin || !required.every((permission) => admin.permissions.includes(permission))) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return true;
  }
}
