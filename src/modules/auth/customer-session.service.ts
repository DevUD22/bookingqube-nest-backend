import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';

import { durationToMs } from '../../common/auth/duration';
import { PrismaService } from '../../database/prisma.service';

export type CustomerSessionMetadata = {
  userAgent?: string;
  ipAddress?: string;
};

type CustomerUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tokenVersion?: number;
};

type RefreshPayload = {
  sub: string;
  sid: string;
  typ: string;
};

@Injectable()
export class CustomerSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(user: CustomerUser, metadata: CustomerSessionMetadata = {}) {
    const refreshTtl = this.config.getOrThrow<string>('JWT_REFRESH_TTL');
    const accessTtl = this.config.getOrThrow<string>('JWT_ACCESS_TTL');
    const expiresAt = new Date(Date.now() + durationToMs(refreshTtl));
    const session = await this.prisma.customerSession.create({
      data: {
        userId: user.id,
        tokenHash: `pending-${randomBytes(24).toString('hex')}`,
        expiresAt,
        userAgent: metadata.userAgent?.slice(0, 500),
        ipAddress: metadata.ipAddress?.slice(0, 100),
      },
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sid: session.id, typ: 'customer_refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl as JwtSignOptions['expiresIn'],
      },
    );
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        typ: 'customer_access',
        tv: user.tokenVersion ?? 0,
        sid: session.id,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl as JwtSignOptions['expiresIn'],
      },
    );
    await this.prisma.customerSession.update({
      where: { id: session.id },
      data: { tokenHash: this.hashToken(refreshToken) },
    });

    return {
      success: true as const,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: '',
        phone: user.phone ?? '',
      },
      image_url_prefix: 'https://bookingqube.blob.core.windows.net/bqcontainer/',
      token: accessToken,
      refresh_token: refreshToken,
      expires_in: durationToMs(accessTtl) / 1000,
    };
  }

  async refresh(refreshToken: string, metadata: CustomerSessionMetadata = {}) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }
    if (payload.typ !== 'customer_refresh' || !payload.sid) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    const session = await this.prisma.customerSession.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            tokenVersion: true,
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.tokenHash !== this.hashToken(refreshToken) ||
      session.user.id !== payload.sub ||
      session.user.status !== 'active'
    ) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    await this.prisma.customerSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    return this.issue(session.user, metadata);
  }

  async logout(refreshToken: string) {
    await this.prisma.customerSession.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    return { success: true };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
