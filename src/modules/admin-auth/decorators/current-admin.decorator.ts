import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedAdmin } from '../strategies/admin-jwt.strategy';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAdmin =>
    context.switchToHttp().getRequest<{ user: AuthenticatedAdmin }>().user,
);
