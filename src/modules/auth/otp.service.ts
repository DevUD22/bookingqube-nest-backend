import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';

import { hashPassword, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateAndStore(email: string): Promise<string> {
    const normalized = email.toLowerCase();
    const otp = String(randomInt(100000, 1000000));
    const otpHash = await hashPassword(otp);

    await this.prisma.$transaction([
      this.prisma.passwordResetOtp.updateMany({
        where: { email: normalized, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.passwordResetOtp.create({
        data: {
          email: normalized,
          otpHash,
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      }),
    ]);

    this.logger.log(`Password reset OTP issued for ${normalized} (expires in 10 minutes).`);
    return otp;
  }

  async generateEmailChange(userId: string, newEmail: string): Promise<string> {
    const normalized = newEmail.toLowerCase();
    const otp = String(randomInt(100000, 1000000));
    const otpHash = await hashPassword(otp);

    await this.prisma.$transaction([
      this.prisma.emailChangeOtp.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.emailChangeOtp.create({
        data: {
          userId,
          newEmail: normalized,
          otpHash,
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      }),
    ]);

    this.logger.log(`Email change OTP issued for user ${userId} (expires in 10 minutes).`);
    return otp;
  }

  async consumeEmailChange(
    userId: string,
    otp: string,
  ): Promise<{ newEmail: string } | null> {
    const record = await this.findActiveEmailChange(userId);
    if (!record) {
      return null;
    }

    const matches = await verifyPassword(otp, record.otpHash);
    if (!matches) {
      await this.prisma.emailChangeOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return null;
    }

    await this.prisma.emailChangeOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return { newEmail: record.newEmail };
  }

  async invalidateEmailChange(userId: string): Promise<void> {
    await this.prisma.emailChangeOtp.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  async verify(email: string, otp: string): Promise<boolean> {
    const record = await this.findActive(email);
    if (!record) {
      return false;
    }

    const matches = await verifyPassword(otp, record.otpHash);
    if (!matches) {
      await this.prisma.passwordResetOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
    }

    return matches;
  }

  async consume(email: string, otp: string): Promise<boolean> {
    const record = await this.findActive(email);
    if (!record) {
      return false;
    }

    const matches = await verifyPassword(otp, record.otpHash);
    if (!matches) {
      await this.prisma.passwordResetOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    await this.prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return true;
  }

  private findActive(email: string) {
    return this.prisma.passwordResetOtp.findFirst({
      where: {
        email: email.toLowerCase(),
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private findActiveEmailChange(userId: string) {
    return this.prisma.emailChangeOtp.findFirst({
      where: {
        userId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
