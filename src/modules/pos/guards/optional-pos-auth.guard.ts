import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AuthenticatedPosAgent } from '../strategies/pos-jwt.strategy';

/**
 * Optional POS JWT. When stacked with other optional JWT guards, preserves
 * an existing request.user if this strategy fails.
 */
@Injectable()
export class OptionalPosAuthGuard extends AuthGuard('pos-jwt') {
  handleRequest<TUser = AuthenticatedPosAgent>(
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
