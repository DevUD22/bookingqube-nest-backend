import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedPosAgent } from '../strategies/pos-jwt.strategy';

export const CurrentPosAgent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPosAgent | undefined => {
    return ctx.switchToHttp().getRequest().user;
  },
);
