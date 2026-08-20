import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';

import { generateRecoveryCodes, hashRecoveryCode } from '../../common/auth/mfa-recovery';
import { generateTotpSecret, totpAuthUrl, verifyTotp } from '../../common/auth/totp';
import { decryptSecret, encryptSecret } from '../../common/crypto/secret-box';
import { LoginLockoutService } from '../../common/auth/login-lockout.service';
import { revokeAuthSessionsForUser } from '../../common/auth/session-revocation';
import { hashPassword, upgradeHashIfNeeded, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import {
  AdminLoginDto,
  AdminMfaEnrollDto,
  UpdateAdminProfileDto,
  UploadAdminAvatarDto,
} from './dto/admin-auth.dto';
import { AuthenticatedAdmin } from './strategies/admin-jwt.strategy';

interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  typ: 'admin_refresh';
}

interface MfaEnrollPayload {
  sub: string;
  aid: string;
  sec: string;
  typ: 'admin_mfa_enroll';
}

interface SecuritySettingRow {
  enabled: boolean;
  config_json: unknown;
}

interface AdminMfaStateRow {
  mfa_secret_enc: string | null;
  mfa_enabled_at: Date | null;
}

const adminInclude = {
  user: true,
  avatarMedia: true,
  role: { include: { permissions: { include: { permission: true } } } },
} satisfies Prisma.AdminProfileInclude;

type AdminProfileRecord = Prisma.AdminProfileGetPayload<{ include: typeof adminInclude }>;

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mediaStorage: MediaStorageService,
    private readonly lockout: LoginLockoutService,
  ) {}

  async login(input: AdminLoginDto, metadata: SessionMetadata) {
    const email = input.email.trim().toLowerCase();
    await this.lockout.assertNotLocked(
      'admin',
      email,
      'Invalid admin email or password.',
    );
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { adminProfile: { include: adminInclude } },
    });
    if (
      !user ||
      user.status !== 'active' ||
      !user.passwordHash ||
      !user.adminProfile ||
      user.adminProfile.status !== 'active' ||
      !(await verifyPassword(input.password, user.passwordHash))
    ) {
      await this.lockout.recordFailure('admin', email);
      throw new UnauthorizedException('Invalid admin email or password.');
    }
    await this.lockout.clear('admin', email);
    const permissions = user.adminProfile.role.permissions.map(
      (item) => item.permission.key,
    );
    if (!permissions.includes('panel.access')) {
      throw new UnauthorizedException('This account does not have panel access.');
    }
    if (await this.isAdminMfaRequired()) {
      const enrolled = await this.hasEnrolledMfa(user.adminProfile.id);
      if (!enrolled) {
        return this.beginMfaEnrollment(user.adminProfile);
      }
      await this.assertMfaCode(user.adminProfile.id, input.totp_code);
    }

    const upgradedHash = await upgradeHashIfNeeded(input.password, user.passwordHash);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(upgradedHash ? { passwordHash: upgradedHash } : {}),
      },
    });
    return this.createSession(user.adminProfile, metadata);
  }

  async enrollMfa(input: AdminMfaEnrollDto, metadata: SessionMetadata) {
    let payload: MfaEnrollPayload;
    try {
      payload = await this.jwt.verifyAsync<MfaEnrollPayload>(input.challenge_token, {
        secret: this.config.getOrThrow<string>('ADMIN_JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(
        'Authenticator setup expired. Sign in again to get a new QR code.',
      );
    }
    if (payload.typ !== 'admin_mfa_enroll' || !payload.aid || !payload.sec) {
      throw new UnauthorizedException('Invalid authenticator setup token.');
    }

    const keyMaterial = this.mfaKeyMaterial();
    let secret: string;
    try {
      secret = decryptSecret(payload.sec, keyMaterial);
    } catch {
      throw new UnauthorizedException('Authenticator setup is invalid. Sign in again.');
    }
    if (!verifyTotp(secret, input.totp_code)) {
      throw new UnauthorizedException('Invalid Google Authenticator code.');
    }

    const adminProfile = await this.prisma.adminProfile.findUnique({
      where: { id: payload.aid },
      include: adminInclude,
    });
    if (
      !adminProfile ||
      adminProfile.status !== 'active' ||
      adminProfile.user.status !== 'active' ||
      adminProfile.user.id !== payload.sub
    ) {
      throw new UnauthorizedException('Admin profile not found.');
    }

    const recoveryCount = await this.getRecoveryCodesCount();
    const recoveryCodes = generateRecoveryCodes(recoveryCount);
    await this.persistEnrolledMfa(
      adminProfile.id,
      encryptSecret(secret, keyMaterial),
      recoveryCodes.map((code) => hashRecoveryCode(code)),
    );

    const session = await this.createSession(adminProfile, metadata);
    return {
      ...session,
      data: {
        ...session.data,
        recovery_codes: recoveryCodes,
      },
    };
  }

  async refresh(refreshToken: string, metadata: SessionMetadata) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('ADMIN_JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired admin refresh token.');
    }
    if (payload.typ !== 'admin_refresh' || !payload.sid) {
      throw new UnauthorizedException('Invalid admin refresh token.');
    }

    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sid },
      include: { adminProfile: { include: adminInclude } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.tokenHash !== this.hashToken(refreshToken) ||
      session.adminProfile.user.id !== payload.sub ||
      session.adminProfile.status !== 'active' ||
      session.adminProfile.user.status !== 'active'
    ) {
      throw new UnauthorizedException('Invalid or expired admin refresh token.');
    }

    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    return this.createSession(session.adminProfile, metadata);
  }

  async logout(refreshToken: string) {
    await this.prisma.adminSession.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    return { success: true };
  }

  me(admin: AuthenticatedAdmin) {
    return {
      success: true,
      data: this.toAdminDto(admin),
    };
  }

  async updateProfile(admin: AuthenticatedAdmin, input: UpdateAdminProfileDto) {
    const name = input.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('Name must be at least 2 characters.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: admin.id },
      include: { adminProfile: { include: adminInclude } },
    });
    if (!user?.adminProfile) {
      throw new UnauthorizedException('Admin profile not found.');
    }

    const newPassword = input.new_password?.trim() || '';
    if (newPassword) {
      if (!input.current_password?.trim()) {
        throw new BadRequestException(
          'Current password is required to set a new password.',
        );
      }
      if (
        !user.passwordHash ||
        !(await verifyPassword(input.current_password, user.passwordHash))
      ) {
        throw new BadRequestException('Current password is incorrect.');
      }
      if (newPassword.length < 8) {
        throw new BadRequestException(
          'New password must be at least 8 characters.',
        );
      }
      if (newPassword !== (input.new_password_confirmation || '').trim()) {
        throw new BadRequestException('Password confirmation does not match.');
      }
    }

    if (newPassword) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            name,
            passwordHash: await hashPassword(newPassword),
            tokenVersion: { increment: 1 },
          },
        });
        await revokeAuthSessionsForUser(tx, user.id, {
          exceptAdminSessionId: admin.sessionId,
        });
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { name },
      });
    }

    const refreshed = await this.prisma.adminProfile.findUniqueOrThrow({
      where: { id: user.adminProfile.id },
      include: adminInclude,
    });

    return {
      success: true,
      message: newPassword ? 'Profile and password updated.' : 'Profile updated.',
      data: this.toAdminDtoFromProfile(refreshed),
    };
  }

  async uploadAvatar(admin: AuthenticatedAdmin, input: UploadAdminAvatarDto) {
    const profile = await this.prisma.adminProfile.findUnique({
      where: { id: admin.adminProfileId },
      include: adminInclude,
    });
    if (!profile) {
      throw new UnauthorizedException('Admin profile not found.');
    }

    const asset = await this.mediaStorage.uploadDataUrl({
      folder: `settings/admin-avatars/${admin.id}`,
      dataUrl: input.data_url,
      fileName: input.file_name?.trim() || 'avatar',
      maxBytes: 5 * 1024 * 1024,
      allowJpgAlias: true,
      altText: `${profile.user.name} avatar`,
      uploadedByUserId: admin.id,
      errorLabel: 'avatar',
    });

    const updated = await this.prisma.adminProfile.update({
      where: { id: profile.id },
      data: { avatarMediaId: asset.id },
      include: adminInclude,
    });

    return {
      success: true,
      message: 'Profile image updated.',
      data: this.toAdminDtoFromProfile(updated),
    };
  }

  async removeAvatar(admin: AuthenticatedAdmin) {
    const updated = await this.prisma.adminProfile.update({
      where: { id: admin.adminProfileId },
      data: { avatarMediaId: null },
      include: adminInclude,
    });

    return {
      success: true,
      message: 'Profile image removed.',
      data: this.toAdminDtoFromProfile(updated),
    };
  }

  private toAdminDto(admin: AuthenticatedAdmin) {
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
      avatar_url: admin.avatarUrl,
    };
  }

  private toAdminDtoFromProfile(profile: AdminProfileRecord) {
    return {
      id: profile.user.id,
      name: profile.user.name,
      email: profile.user.email,
      role: profile.role.name,
      permissions: profile.role.permissions.map((item) => item.permission.key),
      avatar_url: profile.avatarMedia?.url ?? null,
    };
  }

  private async createSession(
    adminProfile: AdminProfileRecord,
    metadata: SessionMetadata,
  ) {
    const refreshTtl = this.config.getOrThrow<string>('ADMIN_JWT_REFRESH_TTL');
    const expiresAt = new Date(Date.now() + this.durationToMs(refreshTtl));
    const session = await this.prisma.adminSession.create({
      data: {
        adminProfileId: adminProfile.id,
        tokenHash: `pending-${randomBytes(24).toString('hex')}`,
        expiresAt,
        userAgent: metadata.userAgent?.slice(0, 500),
        ipAddress: metadata.ipAddress?.slice(0, 100),
      },
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: adminProfile.user.id, sid: session.id, typ: 'admin_refresh' },
      {
        secret: this.config.getOrThrow<string>('ADMIN_JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl as JwtSignOptions['expiresIn'],
      },
    );
    const accessToken = await this.jwt.signAsync(
      {
        sub: adminProfile.user.id,
        email: adminProfile.user.email,
        sid: session.id,
        typ: 'admin_access',
      },
      {
        secret: this.config.getOrThrow<string>('ADMIN_JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'ADMIN_JWT_ACCESS_TTL',
        ) as JwtSignOptions['expiresIn'],
      },
    );
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: { tokenHash: this.hashToken(refreshToken) },
    });

    return {
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in:
          this.durationToMs(
            this.config.getOrThrow<string>('ADMIN_JWT_ACCESS_TTL'),
          ) / 1000,
        admin: this.toAdminDtoFromProfile(adminProfile),
      },
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async isAdminMfaRequired() {
    const config = await this.getSecurityConfig();
    if (!config) return false;
    return String(config.admin_mfa_required ?? '1') === '1';
  }

  private async getRecoveryCodesCount() {
    const config = await this.getSecurityConfig();
    const count = Number(config?.admin_recovery_codes_count ?? 8);
    return Number.isFinite(count) && count > 0 ? Math.min(24, Math.floor(count)) : 8;
  }

  private async getMfaIssuer() {
    const config = await this.getSecurityConfig();
    const issuer = String(config?.admin_mfa_issuer ?? 'BookingQube Admin').trim();
    return issuer || 'BookingQube Admin';
  }

  private async getSecurityConfig() {
    const rows = await this.prisma.$queryRaw<SecuritySettingRow[]>(Prisma.sql`
      SELECT enabled, config_json
      FROM app_settings
      WHERE "group" = 'security'
      LIMIT 1
    `);
    const row = rows[0];
    if (!row?.enabled) return null;
    return row.config_json && typeof row.config_json === 'object' && !Array.isArray(row.config_json)
      ? (row.config_json as Record<string, unknown>)
      : {};
  }

  private async hasEnrolledMfa(adminProfileId: string) {
    const state = await this.getMfaState(adminProfileId);
    return Boolean(state?.mfa_enabled_at && state.mfa_secret_enc);
  }

  private async beginMfaEnrollment(adminProfile: AdminProfileRecord) {
    const secret = generateTotpSecret();
    const issuer = await this.getMfaIssuer();
    const otpauthUrl = totpAuthUrl(secret, adminProfile.user.email, issuer);
    const challengeToken = await this.jwt.signAsync(
      {
        sub: adminProfile.user.id,
        aid: adminProfile.id,
        sec: encryptSecret(secret, this.mfaKeyMaterial()),
        typ: 'admin_mfa_enroll',
      },
      {
        secret: this.config.getOrThrow<string>('ADMIN_JWT_ACCESS_SECRET'),
        expiresIn: '10m' as JwtSignOptions['expiresIn'],
      },
    );
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    } catch {
      qrDataUrl = '';
    }

    return {
      success: true,
      mfa_enrollment_required: true,
      data: {
        challenge_token: challengeToken,
        otpauth_url: otpauthUrl,
        qr_data_url: qrDataUrl,
        secret,
        issuer,
        email: adminProfile.user.email,
      },
    };
  }

  private async persistEnrolledMfa(
    adminProfileId: string,
    encryptedSecret: string,
    recoveryHashes: string[],
  ) {
    try {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE admin_profiles
        SET
          mfa_secret_enc = ${encryptedSecret},
          mfa_enabled_at = NOW(),
          mfa_recovery_hashes = ARRAY[${Prisma.join(recoveryHashes)}]::text[]
        WHERE id = ${adminProfileId}::uuid
      `);
    } catch {
      throw new UnauthorizedException(
        'Google Authenticator storage is not ready. Run the latest migrations.',
      );
    }
  }

  private async getMfaState(adminProfileId: string) {
    try {
      const rows = await this.prisma.$queryRaw<AdminMfaStateRow[]>(Prisma.sql`
        SELECT mfa_secret_enc, mfa_enabled_at
        FROM admin_profiles
        WHERE id = ${adminProfileId}::uuid
        LIMIT 1
      `);
      return rows[0] ?? null;
    } catch {
      throw new UnauthorizedException(
        'Google Authenticator enforcement is enabled, but MFA storage is not ready. Run the latest migrations.',
      );
    }
  }

  private async assertMfaCode(adminProfileId: string, totpCode?: string) {
    const state = await this.getMfaState(adminProfileId);
    if (!state?.mfa_enabled_at || !state.mfa_secret_enc) {
      throw new UnauthorizedException(
        'Google Authenticator is required. Complete MFA enrollment before signing in.',
      );
    }
    if (!totpCode?.trim()) {
      throw new UnauthorizedException('Google Authenticator code is required.');
    }

    let secret: string;
    try {
      secret = decryptSecret(state.mfa_secret_enc, this.mfaKeyMaterial());
    } catch {
      throw new UnauthorizedException(
        'Authenticator secret is invalid. Please re-enroll Google Authenticator.',
      );
    }
    if (!verifyTotp(secret, totpCode)) {
      throw new UnauthorizedException('Invalid Google Authenticator code.');
    }
  }

  private mfaKeyMaterial() {
    const keyMaterial =
      this.config.get<string>('MFA_ENCRYPTION_KEY') ||
      this.config.get<string>('APP_KEY') ||
      this.config.get<string>('ADMIN_JWT_ACCESS_SECRET');
    if (!keyMaterial) {
      throw new UnauthorizedException('MFA is not configured on the server.');
    }
    return keyMaterial;
  }

  private durationToMs(value: string) {
    const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
    if (!match) throw new Error(`Invalid duration: ${value}`);
    const amount = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    return amount * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  }
}
