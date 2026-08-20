import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../../database/database.module';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CustomerSessionService } from './customer-session.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { OtpService } from './otp.service';
import { AppleTokenVerifierService } from './providers/apple-token-verifier.service';
import { GoogleTokenVerifierService } from './providers/google-token-verifier.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    DatabaseModule,
    MailModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<string>('JWT_ACCESS_TTL') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CustomerSessionService,
    OtpService,
    JwtStrategy,
    GoogleTokenVerifierService,
    AppleTokenVerifierService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
  ],
  exports: [
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    JwtModule,
    OtpService,
    CustomerSessionService,
  ],
})
export class AuthModule {}
