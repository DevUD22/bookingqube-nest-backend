import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';

import { LoginLockoutService } from '../../common/auth/login-lockout.service';
import { upgradeHashIfNeeded, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { PosLoginDto } from './dto/pos-auth.dto';
import { PosAccessPayload } from './strategies/pos-jwt.strategy';

const assignmentSelect = {
  id: true,
  eventId: true,
  organizationId: true,
  ticketTypeIds: true,
  thirdPartyVendorId: true,
  thirdPartyVendorIds: true,
  isCafeAgent: true,
  event: {
    select: {
      id: true,
      slug: true,
      currency: true,
      status: true,
      startsAt: true,
      endsAt: true,
      requiresWaiver: true,
      translations: {
        where: { locale: { in: ['en', 'ar'] } },
        select: { locale: true, title: true, waiverContent: true },
        take: 2,
      },
    },
  },
} satisfies Prisma.StaffAssignmentSelect;

/** Resolve POS shareholder scope from multi + legacy single vendor fields. */
function resolveVendorIds(row: {
  thirdPartyVendorId: string | null;
  thirdPartyVendorIds: string[];
}): string[] {
  return [
    ...new Set(
      [...row.thirdPartyVendorIds, row.thirdPartyVendorId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
}

type AssignmentRecord = Prisma.StaffAssignmentGetPayload<{
  select: typeof assignmentSelect;
}>;

@Injectable()
export class PosAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly lockout: LoginLockoutService,
  ) {}

  async login(input: PosLoginDto) {
    const login = input.email.trim().toLowerCase();
    if (!login || !input.password) {
      throw new UnauthorizedException('Invalid POS email or password.');
    }
    await this.lockout.assertNotLocked(
      'pos',
      login,
      'Invalid POS email or password.',
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
        staffAssignments: {
          where: {
            status: 'active',
            eventId: { not: null },
            role: { name: 'pos' },
            ...(input.event_id?.trim()
              ? { eventId: input.event_id.trim() }
              : {}),
          },
          select: assignmentSelect,
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
      await this.lockout.recordFailure('pos', login);
      throw new UnauthorizedException('Invalid POS email or password.');
    }

    await this.lockout.clear('pos', login);
    const currentPasswordHash = user.passwordHash;

    const assignments = user.staffAssignments.filter(
      (row): row is AssignmentRecord & {
        eventId: string;
        event: NonNullable<AssignmentRecord['event']>;
      } => Boolean(row.eventId && row.event),
    );

    if (!assignments.length) {
      throw new UnauthorizedException(
        input.event_id?.trim()
          ? 'No active POS assignment found for this event.'
          : 'This account is not assigned as a POS agent on any event.',
      );
    }

    if (!input.event_id?.trim() && assignments.length > 1) {
      throw new BadRequestException({
        message: 'Multiple event assignments found. Pass event_id to continue.',
        errors: {
          event_id: [
            'event_id is required when the agent has multiple events.',
          ],
        },
        data: {
          assignments: assignments.map((row) => ({
            event: this.toEventDto(row.event!),
          })),
        },
      });
    }

    const assignment = assignments[0];
    const vendorIds = resolveVendorIds(assignment);

    // Fire-and-forget last login / hash upgrade — do not block token issuance.
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

    const accessTtl = this.config.getOrThrow<string>('POS_JWT_ACCESS_TTL');
    const payload: PosAccessPayload = {
      sub: user.id,
      email: user.email,
      typ: 'pos_access',
      tv: user.tokenVersion ?? 0,
      aid: assignment.id,
      eid: assignment.eventId,
      oid: assignment.organizationId,
      tti: assignment.ticketTypeIds,
      tvi: vendorIds,
      sem: assignment.isCafeAgent,
    };

    const token = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('POS_JWT_ACCESS_SECRET'),
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
        workspace_mode: assignment.isCafeAgent ? 'sales_entry' : 'pos',
        event: this.toEventDto(assignment.event),
      },
    };
  }

  private toEventDto(event: NonNullable<AssignmentRecord['event']>) {
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
      requires_waiver: event.requiresWaiver,
      waiver_form: en?.waiverContent?.trim() || null,
      waiver_form_ar: ar?.waiverContent?.trim() || null,
    };
  }
}
