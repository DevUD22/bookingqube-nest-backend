import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

import { upgradeHashIfNeeded, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { OrganizerLoginDto } from './dto/organizer-auth.dto';
import { AuthenticatedOrganizer } from './organizer-jwt.strategy';

interface SessionMetadata { userAgent?: string; ipAddress?: string }
interface RefreshPayload { sub: string; sid: string; mid: string; oid: string; typ: 'organizer_refresh' }
const membershipInclude = { user: true, organization: true } satisfies Prisma.OrganizationMemberInclude;
type MembershipRecord = Prisma.OrganizationMemberGetPayload<{ include: typeof membershipInclude }>;

@Injectable()
export class OrganizerAuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async login(input: OrganizerLoginDto, metadata: SessionMetadata) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: { organizationMemberships: { where: { status: 'active', organization: { status: 'active' } }, include: { organization: true } } },
    });
    const membership = user?.organizationMemberships.find((item) => !input.organization_slug || item.organization.slug === input.organization_slug);
    if (!user || user.status !== 'active' || !user.passwordHash || !membership || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid organizer email or password.');
    }
    const upgradedHash = await upgradeHashIfNeeded(input.password, user.passwordHash);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(upgradedHash ? { passwordHash: upgradedHash } : {}),
      },
    });
    return this.createSession({ ...membership, user }, metadata);
  }

  async refresh(refreshToken: string, metadata: SessionMetadata) {
    let payload: RefreshPayload;
    try { payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, { secret: this.config.getOrThrow<string>('ADMIN_JWT_REFRESH_SECRET') }); }
    catch { throw new UnauthorizedException('Invalid or expired organizer refresh token.'); }
    if (payload.typ !== 'organizer_refresh') throw new UnauthorizedException('Invalid organizer refresh token.');
    const session = await this.prisma.organizerSession.findUnique({ where: { id: payload.sid }, include: { organizationMember: { include: membershipInclude } } });
    const member = session?.organizationMember;
    if (!session || !member || session.revokedAt || session.expiresAt <= new Date() || session.tokenHash !== this.hashToken(refreshToken) || member.id !== payload.mid || member.organizationId !== payload.oid || member.user.id !== payload.sub || member.status !== 'active' || member.organization.status !== 'active' || member.user.status !== 'active') {
      throw new UnauthorizedException('Invalid or expired organizer refresh token.');
    }
    await this.prisma.organizerSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
    return this.createSession(member, metadata);
  }

  async logout(refreshToken: string) {
    await this.prisma.organizerSession.updateMany({ where: { tokenHash: this.hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
    return { success: true };
  }

  me(organizer: AuthenticatedOrganizer) { return { success: true, data: organizer }; }

  private async createSession(member: MembershipRecord, metadata: SessionMetadata) {
    const refreshTtl = this.config.getOrThrow<string>('ADMIN_JWT_REFRESH_TTL');
    const session = await this.prisma.organizerSession.create({ data: { organizationMemberId: member.id, tokenHash: `pending-${randomBytes(24).toString('hex')}`, expiresAt: new Date(Date.now() + this.durationToMs(refreshTtl)), userAgent: metadata.userAgent?.slice(0, 500), ipAddress: metadata.ipAddress?.slice(0, 100) } });
    const base = { sub: member.user.id, sid: session.id, mid: member.id, oid: member.organizationId };
    const refreshToken = await this.jwt.signAsync({ ...base, typ: 'organizer_refresh' }, { secret: this.config.getOrThrow<string>('ADMIN_JWT_REFRESH_SECRET'), expiresIn: refreshTtl as JwtSignOptions['expiresIn'] });
    const accessTtl = this.config.getOrThrow<string>('ADMIN_JWT_ACCESS_TTL');
    const accessToken = await this.jwt.signAsync({ ...base, typ: 'organizer_access' }, { secret: this.config.getOrThrow<string>('ADMIN_JWT_ACCESS_SECRET'), expiresIn: accessTtl as JwtSignOptions['expiresIn'] });
    await this.prisma.organizerSession.update({ where: { id: session.id }, data: { tokenHash: this.hashToken(refreshToken) } });
    return { success: true, data: { access_token: accessToken, refresh_token: refreshToken, expires_in: this.durationToMs(accessTtl) / 1000, organizer: { id: member.user.id, name: member.user.name, email: member.user.email, role: member.role, organization: { id: member.organization.id, slug: member.organization.slug, name: member.organization.name } } } };
  }
  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private durationToMs(value: string) { const match = /^(\d+)(s|m|h|d)$/.exec(value.trim()); if (!match) throw new Error(`Invalid duration: ${value}`); return Number(match[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's'|'m'|'h'|'d']; }
}
