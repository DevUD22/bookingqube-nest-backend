import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { tokenVersionMatches } from '../../../common/auth/session-revocation';
import { PrismaService } from '../../../database/prisma.service';

export interface CafePosAccessPayload {
  sub: string;
  email: string;
  typ: 'cafe_pos_access';
  tv?: number;
  cid: string;
  cpa: string;
  eid: string | null;
  oid: string;
}

export interface AuthenticatedCafePosAgent {
  id: string;
  email: string;
  cafeId: string;
  cafePosAgentId: string;
  eventId: string | null;
  organizationId: string;
}

@Injectable()
export class CafePosJwtStrategy extends PassportStrategy(
  Strategy,
  'cafe-pos-jwt',
) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('CAFE_POS_JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: CafePosAccessPayload): Promise<AuthenticatedCafePosAgent> {
    if (
      payload.typ !== 'cafe_pos_access' ||
      !payload.sub ||
      !payload.cid ||
      !payload.cpa ||
      !payload.oid
    ) {
      throw new UnauthorizedException('Invalid cafe POS session.');
    }

    const row = await this.prisma.cafePosAgent.findFirst({
      where: {
        id: payload.cpa,
        cafeId: payload.cid,
        userId: payload.sub,
        status: 'active',
      },
      include: { user: { select: { id: true, email: true, status: true, tokenVersion: true } } },
    });
    if (
      !row ||
      row.user.status !== 'active' ||
      !tokenVersionMatches(payload.tv, row.user.tokenVersion)
    ) {
      throw new UnauthorizedException('Invalid cafe POS session.');
    }

    return {
      id: row.user.id,
      email: row.user.email,
      cafeId: row.cafeId,
      cafePosAgentId: row.id,
      eventId: payload.eid ?? null,
      organizationId: payload.oid,
    };
  }
}
