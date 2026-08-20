import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedCafePosAgent } from '../strategies/cafe-pos-jwt.strategy';

export const CurrentCafePosAgent = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext,
  ): AuthenticatedCafePosAgent | undefined => {
    return ctx.switchToHttp().getRequest().user;
  },
);
