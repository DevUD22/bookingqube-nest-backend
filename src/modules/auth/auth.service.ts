import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { revokeAuthSessionsForUser } from '../../common/auth/session-revocation';
import { LoginLockoutService } from '../../common/auth/login-lockout.service';
import { hashPassword, upgradeHashIfNeeded, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  CustomerSessionMetadata,
  CustomerSessionService,
} from './customer-session.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
import { AppleTokenVerifierService } from './providers/apple-token-verifier.service';
import { GoogleTokenVerifierService } from './providers/google-token-verifier.service';

interface OtherSocialData {
  name?: string;
  email?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: CustomerSessionService,
    private readonly otpService: OtpService,
    private readonly googleVerifier: GoogleTokenVerifierService,
    private readonly appleVerifier: AppleTokenVerifierService,
    private readonly mailService: MailService,
    private readonly lockout: LoginLockoutService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    if (dto.password !== dto.password_confirmation) {
      throw new BadRequestException({
        message: 'Passwords do not match.',
        errors: { password_confirmation: ['Passwords do not match.'] },
      });
    }

    const passwordHash = await hashPassword(dto.password);
    const name = dto.name.trim();
    const phone = dto.phone?.trim() || undefined;
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing?.passwordHash) {
      return { message: 'Registration successful.' };
    }

    try {
      if (existing) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            name,
            passwordHash,
            phone: phone ?? existing.phone,
            status: 'active',
          },
        });
      } else {
        await this.prisma.user.create({
          data: {
            email,
            name,
            passwordHash,
            phone,
            status: 'active',
          },
        });
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { message: 'Registration successful.' };
      }
      throw error;
    }

    this.mailService.queueUserRegistrationEmail({
      to: email,
      name,
    });

    return { message: 'Registration successful.' };
  }

  async login(dto: LoginDto, metadata: CustomerSessionMetadata = {}) {
    const email = dto.email.trim().toLowerCase();
    await this.lockout.assertNotLocked(
      'customer',
      email,
      'Invalid email or password.',
    );
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.status !== 'active' || !user.passwordHash || !(await verifyPassword(dto.password, user.passwordHash))) {
      await this.lockout.recordFailure('customer', email);
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.lockout.clear('customer', email);
    const upgradedHash = await upgradeHashIfNeeded(dto.password, user.passwordHash);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(upgradedHash ? { passwordHash: upgradedHash } : {}),
      },
    });

    return this.buildLoginResponse(user, metadata);
  }

  async socialLogin(dto: SocialLoginDto, metadata: CustomerSessionMetadata = {}) {
    let otherData: OtherSocialData = {};
    try {
      otherData = dto.other_data ? (JSON.parse(dto.other_data) as OtherSocialData) : {};
    } catch {
      throw new BadRequestException('Invalid social login payload.');
    }

    let email = '';
    let name = otherData.name?.trim() || '';
    let appleSub: string | null = null;

    if (dto.provider === 'google') {
      const claimedEmail = otherData.email?.trim();
      if (!claimedEmail) {
        throw new BadRequestException('Google account email is required.');
      }
      const verified = await this.googleVerifier.verify(dto.access_token, claimedEmail);
      email = verified.email;
      name = name || email;
    } else {
      const verified = await this.appleVerifier.verify(dto.access_token);
      appleSub = verified.sub?.trim() || null;
      if (!appleSub) {
        throw new UnauthorizedException('Apple identity token is missing a subject.');
      }
      email = (verified.email || '').trim().toLowerCase();
      name = name || 'Apple User';
    }

    const user = appleSub
      ? await this.loginOrLinkAppleUser({ appleSub, email, name })
      : await this.loginOrCreateVerifiedSocialUser(email.toLowerCase(), name);

    return this.buildLoginResponse(user, metadata);
  }

  refresh(refreshToken: string, metadata: CustomerSessionMetadata = {}) {
    return this.sessions.refresh(refreshToken, metadata);
  }

  logout(refreshToken: string) {
    return this.sessions.logout(refreshToken);
  }

  private async loginOrLinkAppleUser(input: {
    appleSub: string;
    email: string;
    name: string;
  }) {
    const bySub = await this.prisma.user.findUnique({
      where: { appleSub: input.appleSub },
    });
    if (bySub) {
      if (bySub.status !== 'active') {
        throw new UnauthorizedException('This account is not active.');
      }
      return this.prisma.user.update({
        where: { id: bySub.id },
        data: { lastLoginAt: new Date() },
      });
    }

    if (!input.email) {
      throw new BadRequestException(
        'Apple did not share an email for this account. Use the Apple ID already linked to BookingQube, or share your email on first Sign in with Apple.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      if (existing.appleSub && existing.appleSub !== input.appleSub) {
        throw new UnauthorizedException('This email is already linked to a different Apple account.');
      }
      if (existing.passwordHash && !existing.appleSub) {
        throw new UnauthorizedException(
          'This email is already registered. Sign in with your password instead.',
        );
      }
      if (existing.status !== 'active') {
        throw new UnauthorizedException('This account is not active.');
      }
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          appleSub: input.appleSub,
          lastLoginAt: new Date(),
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        },
      });
    }

    return this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        appleSub: input.appleSub,
        status: 'active',
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  }

  private async loginOrCreateVerifiedSocialUser(email: string, name: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.status !== 'active') {
        throw new UnauthorizedException('This account is not active.');
      }
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          lastLoginAt: new Date(),
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        },
      });
    }
    return this.prisma.user.create({
      data: {
        email,
        name,
        status: 'active',
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      const otp = await this.otpService.generateAndStore(email);
      await this.mailService.sendPasswordResetOtp({
        to: email,
        name: user.name,
        otp,
      });
    }

    return {
      message: 'If an account exists for this email, a verification code has been sent.',
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const ok = await this.otpService.verify(dto.email.trim().toLowerCase(), dto.otp);

    if (!ok) {
      throw new BadRequestException({
        message: 'Invalid or expired code.',
        errors: { otp: ['Invalid or expired code.'] },
      });
    }

    return { message: 'Code verified.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.password_confirmation) {
      throw new BadRequestException({
        message: 'Passwords do not match.',
        errors: { password_confirmation: ['Passwords do not match.'] },
      });
    }

    const email = dto.email.trim().toLowerCase();
    const consumed = await this.otpService.consume(email, dto.otp);

    if (!consumed) {
      throw new BadRequestException({
        message: 'Invalid or expired code.',
        errors: { otp: ['Invalid or expired code.'] },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('Account not found.');
    }

    const passwordHash = await hashPassword(dto.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      });
      await revokeAuthSessionsForUser(tx, user.id);
    });

    return { message: 'Password reset successfully.' };
  }

  private buildLoginResponse(
    user: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      tokenVersion?: number;
    },
    metadata: CustomerSessionMetadata = {},
  ) {
    return this.sessions.issue(user, metadata);
  }
}
