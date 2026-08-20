import { Global, Module } from '@nestjs/common';

import { LoginLockoutService } from '../../common/auth/login-lockout.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, LoginLockoutService],
  exports: [RedisService, LoginLockoutService],
})
export class RedisModule {}
