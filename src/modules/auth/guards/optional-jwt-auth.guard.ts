import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Optional customer JWT. Preserves an existing request.user when this strategy
 * fails so stacked optional guards remain safe.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
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
