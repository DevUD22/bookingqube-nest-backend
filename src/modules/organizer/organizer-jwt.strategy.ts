import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../database/prisma.service';

interface OrganizerAccessPayload {
  sub: string;
  sid: string;
  mid: string;
  oid: string;
  typ: 'organizer_access';
}

export interface AuthenticatedOrganizer {
  id: string;
  membershipId: string;
  sessionId: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  email: string;
  name: string;
  role: 'owner' | 'manager' | 'analyst';
}

@Injectable()
export class OrganizerJwtStrategy extends PassportStrategy(Strategy, 'organizer-jwt') {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('ADMIN_JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: OrganizerAccessPayload): Promise<AuthenticatedOrganizer> {
    if (payload.typ !== 'organizer_access' || !payload.sid || !payload.mid || !payload.oid) {
      throw new UnauthorizedException('Invalid organizer session.');
    }
    const session = await this.prisma.organizerSession.findUnique({
      where: { id: payload.sid },
      include: { organizationMember: { include: { user: true, organization: true } } },
    });
    const member = session?.organizationMember;
    if (!session || !member || session.revokedAt || session.expiresAt <= new Date() ||
      member.id !== payload.mid || member.organizationId !== payload.oid ||
      member.status !== 'active' || member.organization.status !== 'active' ||
      member.user.status !== 'active' || member.user.id !== payload.sub) {
      throw new UnauthorizedException('Invalid or expired organizer session.');
    }
    return {
      id: member.user.id,
      membershipId: member.id,
      sessionId: session.id,
      organizationId: member.organization.id,
      organizationSlug: member.organization.slug,
      organizationName: member.organization.name,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
    };
  }
}
