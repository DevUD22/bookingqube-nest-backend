import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';

import { LoginLockoutService } from '../../common/auth/login-lockout.service';
import { upgradeHashIfNeeded, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { CafePosLoginDto } from './dto/pos-cafe.dto';
import { CafePosAccessPayload } from './strategies/cafe-pos-jwt.strategy';

const cafeAgentInclude = {
  cafe: {
    select: {
      id: true,
      name: true,
      status: true,
      tableCount: true,
      organizationId: true,
      activeEventId: true,
      activeEvent: {
        select: {
          id: true,
          slug: true,
          currency: true,
          status: true,
          startsAt: true,
          endsAt: true,
          translations: {
            where: { locale: { in: ['en', 'ar'] } },
            select: { locale: true, title: true },
            take: 2,
          },
        },
      },
    },
  },
};

@Injectable()
export class PosCafeAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly lockout: LoginLockoutService,
  ) {}

  async login(input: CafePosLoginDto) {
    const login = input.email.trim().toLowerCase();
    if (!login || !input.password) {
      throw new UnauthorizedException('Invalid cafe POS email or password.');
    }
    await this.lockout.assertNotLocked(
      'cafe_pos',
      login,
      'Invalid cafe POS email or password.',
    );

    const user = await this.prisma.user.findFirst({
      where: {
        status: 'active',
        OR: [{ email: login }, { username: login }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        phone: true,
        passwordHash: true,
        tokenVersion: true,
        cafePosAgents: {
          where: {
            status: 'active',
            ...(input.cafe_id?.trim()
              ? { cafeId: input.cafe_id.trim() }
              : {}),
          },
          include: cafeAgentInclude,
          orderBy: { updatedAt: 'desc' },
          take: 20,
        },
      },
    });

    if (
      !user ||
      !user.passwordHash ||
      !(await verifyPassword(input.password, user.passwordHash))
    ) {
      await this.lockout.recordFailure('cafe_pos', login);
      throw new UnauthorizedException('Invalid cafe POS email or password.');
    }

    await this.lockout.clear('cafe_pos', login);
    const currentPasswordHash = user.passwordHash;

    const assignments = user.cafePosAgents.filter((row) => Boolean(row.cafe));

    if (!assignments.length) {
      throw new UnauthorizedException(
        input.cafe_id?.trim()
          ? 'No active cafe POS assignment found for this cafe.'
          : 'This account is not assigned as a cafe POS agent on any cafe.',
      );
    }

    if (!input.cafe_id?.trim() && assignments.length > 1) {
      throw new BadRequestException({
        message: 'Multiple cafe assignments found. Pass cafe_id to continue.',
        errors: {
          cafe_id: [
            'cafe_id is required when the agent has multiple cafes.',
          ],
        },
        data: {
          assignments: assignments.map((row) => ({
            cafe: {
              id: row.cafe.id,
              name: row.cafe.name,
              status: row.cafe.status,
              organization_id: row.cafe.organizationId,
              active_event_id: row.cafe.activeEventId,
            },
            event: row.cafe.activeEvent
              ? this.toEventDto(row.cafe.activeEvent)
              : null,
          })),
        },
      });
    }

    const assignment = assignments[0];
    const cafe = assignment.cafe;

    void (async () => {
      const upgradedHash = await upgradeHashIfNeeded(
        input.password,
        currentPasswordHash,
      );
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          ...(upgradedHash ? { passwordHash: upgradedHash } : {}),
        },
      });
    })().catch(() => undefined);

    const accessTtl = this.config.getOrThrow<string>('CAFE_POS_JWT_ACCESS_TTL');
    const payload: CafePosAccessPayload = {
      sub: user.id,
      email: user.email,
      typ: 'cafe_pos_access',
      tv: user.tokenVersion ?? 0,
      cid: cafe.id,
      cpa: assignment.id,
      eid: cafe.activeEventId,
      oid: cafe.organizationId,
    };

    const token = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('CAFE_POS_JWT_ACCESS_SECRET'),
      expiresIn: accessTtl as JwtSignOptions['expiresIn'],
    });

    return {
      success: true,
      token,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        phone: user.phone,
        cafe: {
          id: cafe.id,
          name: cafe.name,
          status: cafe.status,
          table_count: cafe.tableCount,
          organization_id: cafe.organizationId,
          active_event_id: cafe.activeEventId,
        },
        event: cafe.activeEvent ? this.toEventDto(cafe.activeEvent) : null,
        cafe_pos_agent_id: assignment.id,
      },
    };
  }

  async me(agentId: string, cafeId: string) {
    const assignment = await this.prisma.cafePosAgent.findFirst({
      where: {
        userId: agentId,
        cafeId,
        status: 'active',
      },
      include: cafeAgentInclude,
    });

    if (!assignment) {
      throw new UnauthorizedException('Cafe POS session is no longer valid.');
    }

    const cafe = assignment.cafe;
    const user = await this.prisma.user.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        phone: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Cafe POS session is no longer valid.');
    }

    return {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        phone: user.phone,
        cafe: {
          id: cafe.id,
          name: cafe.name,
          status: cafe.status,
          table_count: cafe.tableCount,
          organization_id: cafe.organizationId,
          active_event_id: cafe.activeEventId,
        },
        event: cafe.activeEvent ? this.toEventDto(cafe.activeEvent) : null,
        cafe_pos_agent_id: assignment.id,
      },
    };
  }

  private toEventDto(event: {
    id: string;
    slug: string;
    currency: string;
    status: string;
    startsAt: Date | null;
    endsAt: Date | null;
    translations: Array<{ locale: string; title: string | null }>;
  }) {
    const en = event.translations.find((row) => row.locale === 'en');
    const ar = event.translations.find((row) => row.locale === 'ar');
    return {
      id: event.id,
      slug: event.slug,
      title: en?.title ?? ar?.title ?? event.slug,
      title_ar: ar?.title ?? null,
      currency: event.currency,
      status: event.status,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
    };
  }
}
