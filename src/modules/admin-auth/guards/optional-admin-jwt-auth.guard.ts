import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AuthenticatedAdmin } from '../strategies/admin-jwt.strategy';

/**
 * Optional admin JWT. When stacked after OptionalJwtAuthGuard, must not clear
 * request.user on failure — Nest Passport always assigns handleRequest's return
 * value, so returning undefined would wipe a successful customer auth.
 */
@Injectable()
export class OptionalAdminJwtAuthGuard extends AuthGuard('admin-jwt') {
  handleRequest<TUser = AuthenticatedAdmin>(
    _err: unknown,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser | undefined {
    if (user) {
      return user;
    }

    const request = context.switchToHttp().getRequest<{ user?: TUser }>();
    return request.user;
  }
}
