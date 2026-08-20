import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { tokenVersionMatches } from '../../../common/auth/session-revocation';
import { PrismaService } from '../../../database/prisma.service';

export interface PosAccessPayload {
  sub: string;
  email: string;
  typ: 'pos_access';
  tv?: number;
  aid: string;
  eid: string;
  oid: string;
  tti?: string[];
  tvi?: string[];
  /** Sales-entry-only mode for external/cafe agents. */
  sem?: boolean;
}

export interface AuthenticatedPosAgent {
  id: string;
  email: string;
  assignmentId: string;
  eventId: string;
  organizationId: string;
  ticketTypeIds: string[];
  thirdPartyVendorIds: string[];
  salesEntryMode?: boolean;
}

@Injectable()
export class PosJwtStrategy extends PassportStrategy(Strategy, 'pos-jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('POS_JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: PosAccessPayload): Promise<AuthenticatedPosAgent> {
    if (payload.typ !== 'pos_access' || !payload.sub || !payload.aid || !payload.eid) {
      throw new UnauthorizedException('Invalid POS session.');
    }

    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        id: payload.aid,
        userId: payload.sub,
        eventId: payload.eid,
        status: 'active',
        role: { name: 'pos' },
      },
      include: { user: { select: { id: true, email: true, status: true, tokenVersion: true } } },
    });
    if (
      !assignment?.eventId ||
      assignment.user.status !== 'active' ||
      !tokenVersionMatches(payload.tv, assignment.user.tokenVersion)
    ) {
      throw new UnauthorizedException('Invalid POS session.');
    }

    return {
      id: assignment.user.id,
      email: assignment.user.email,
      assignmentId: assignment.id,
      eventId: assignment.eventId,
      organizationId: assignment.organizationId,
      ticketTypeIds: assignment.ticketTypeIds,
      thirdPartyVendorIds: [
        ...new Set(
          [...assignment.thirdPartyVendorIds, assignment.thirdPartyVendorId].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ],
      salesEntryMode: assignment.isCafeAgent === true,
    };
  }
}
