import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedOrganizer } from './organizer-jwt.strategy';

export const CurrentOrganizer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedOrganizer =>
    context.switchToHttp().getRequest<{ user: AuthenticatedOrganizer }>().user,
);
