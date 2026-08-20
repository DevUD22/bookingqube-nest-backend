import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../database/prisma.service';

interface AdminAccessPayload {
  sub: string;
  email: string;
  sid: string;
  typ: 'admin_access';
}

export interface AuthenticatedAdmin {
  id: string;
  adminProfileId: string;
  sessionId: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  avatarUrl: string | null;
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('ADMIN_JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AdminAccessPayload): Promise<AuthenticatedAdmin> {
    if (payload.typ !== 'admin_access' || !payload.sid) {
      throw new UnauthorizedException('Invalid admin session.');
    }
    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sid },
      include: {
        adminProfile: {
          include: {
            user: true,
            avatarMedia: true,
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.adminProfile.status !== 'active' ||
      session.adminProfile.user.status !== 'active' ||
      session.adminProfile.user.id !== payload.sub
    ) {
      throw new UnauthorizedException('Invalid or expired admin session.');
    }

    const { adminProfile } = session;
    return {
      id: adminProfile.user.id,
      adminProfileId: adminProfile.id,
      sessionId: session.id,
      email: adminProfile.user.email,
      name: adminProfile.user.name,
      role: adminProfile.role.name,
      permissions: adminProfile.role.permissions.map((item) => item.permission.key),
      avatarUrl: adminProfile.avatarMedia?.url ?? null,
    };
  }
}
