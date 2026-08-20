import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { AppSettingGroup, Prisma } from '@prisma/client';
import * as net from 'net';
import * as tls from 'tls';

import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import { ReportTimezoneService } from '../reporting/report-timezone.service';
import {
  TestAppSettingDto,
  UploadAppSettingAssetDto,
  UpsertAppSettingDto,
  WEBSITE_ASSET_FIELDS,
} from './dto/admin-app-settings.dto';

const GROUPS: AppSettingGroup[] = [
  'website',
  'social',
  'mail',
  'sms',
  'regional',
  'security',
];

const GROUP_KEYS: Record<AppSettingGroup, string[]> = {
  website: [
    'site_name',
    'site_slogan',
    'logo',
    'small_logo',
    'site_favicon',
    'address',
    'phone',
    'email',
  ],
  social: [
    'facebook',
    'twitter',
    'instagram',
    'linkedin',
    'google_map_lat',
    'google_map_long',
    'google_client_id',
    'google_client_secret',
    'google_map_key',
    'google_analytics_code',
    'facebook_app_id',
    'facebook_app_secret',
  ],
  mail: [
    'mail_driver',
    'mail_host',
    'mail_port',
    'mail_username',
    'mail_password',
    'mail_encryption',
    'mail_sender_email',
    'mail_sender_name',
    'send_email_online',
    'send_email_offline',
  ],
  sms: [
    'sms_provider',
    'sms_auth_key',
    'sms_auth_token',
    'sms_sender_id',
    'sms_api_base_url',
    'send_sms_online',
    'send_sms_offline',
  ],
  regional: ['timezone_default', 'currency_default'],
  security: [
    'admin_mfa_required',
    'admin_mfa_issuer',
    'admin_mfa_grace_period_days',
    'admin_recovery_codes_count',
    'password_min_length',
    'password_require_uppercase',
    'password_require_number',
    'password_require_symbol',
    'login_max_attempts',
    'login_lockout_minutes',
    'session_timeout_minutes',
  ],
};

const SECRET_KEYS = new Set([
  'google_client_secret',
  'facebook_app_secret',
  'mail_password',
  'sms_auth_token',
]);

const TESTABLE = new Set<AppSettingGroup>(['mail', 'sms', 'social']);
/** Groups that must pass Test connection before they can be enabled. */
const REQUIRE_TEST_ON_ENABLE = new Set<AppSettingGroup>(['mail', 'sms']);

function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 12) return 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢';
  return `${value.slice(0, 6)}â€¢â€¢â€¢â€¢${value.slice(-4)}`;
}

function isMasked(value: string) {
  return value.includes('â€¢â€¢â€¢â€¢');
}

const FLAG_DEFAULTS: Record<string, string> = {
  send_email_online: '1',
  send_email_offline: '1',
  sms_provider: 'smscountry',
  sms_api_base_url: 'https://restapi.smscountry.com/v0.1',
  send_sms_online: '1',
  send_sms_offline: '1',
  admin_mfa_required: '1',
  admin_mfa_issuer: 'BookingQube Admin',
  admin_recovery_codes_count: '8',
  password_min_length: '12',
  password_require_uppercase: '1',
  password_require_number: '1',
  password_require_symbol: '1',
  login_max_attempts: '5',
  login_lockout_minutes: '15',
  session_timeout_minutes: '480',
};

function emptyConfig(group: AppSettingGroup): Record<string, string> {
  return Object.fromEntries(
    GROUP_KEYS[group].map((key) => [key, FLAG_DEFAULTS[key] ?? '']),
  );
}

function asConfig(value: unknown, group: AppSettingGroup): Record<string, string> {
  const base = emptyConfig(group);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const raw = value as Record<string, unknown>;
  for (const key of GROUP_KEYS[group]) {
    const next = raw[key];
    if (next == null || (typeof next === 'string' && next.trim() === '')) {
      base[key] = FLAG_DEFAULTS[key] ?? '';
      continue;
    }
    base[key] = typeof next === 'string' ? next : String(next);
  }
  return base;
}

@Injectable()
export class AdminAppSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    @Optional()
    @Inject(forwardRef(() => ReportTimezoneService))
    private readonly reportTz?: ReportTimezoneService,
  ) {}

  async list() {
    const rows = await Promise.all(GROUPS.map((group) => this.ensureRow(group)));
    return rows.map((row) => this.serialize(row));
  }

  async get(group: string) {
    const normalized = this.parseGroup(group);
    const row = await this.ensureRow(normalized);
    const data = this.serialize(row);
    if (normalized !== 'security') return data;
    return {
      ...data,
      mfa_enrolled_count: await this.countEnrolledAdmins(),
    };
  }

  async resetAdminMfa(group: string) {
    const normalized = this.parseGroup(group);
    if (normalized !== 'security') {
      throw new BadRequestException('Authenticator reset is only available on Login security.');
    }
    try {
      const updated = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE admin_profiles
        SET
          mfa_secret_enc = NULL,
          mfa_enabled_at = NULL,
          mfa_recovery_hashes = ARRAY[]::TEXT[]
        WHERE mfa_enabled_at IS NOT NULL
           OR mfa_secret_enc IS NOT NULL
      `);
      return {
        success: true,
        message:
          'Google Authenticator was reset. The QR code will be shown again on the next admin sign-in.',
        reset_count: Number(updated) || 0,
        mfa_enrolled_count: 0,
      };
    } catch {
      throw new BadRequestException(
        'Unable to reset Google Authenticator. Make sure the latest MFA migrations have been applied.',
      );
    }
  }

  private async countEnrolledAdmins() {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM admin_profiles
        WHERE mfa_enabled_at IS NOT NULL
      `);
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  async upsert(group: string, body: UpsertAppSettingDto, adminUserId?: string) {
    const normalized = this.parseGroup(group);
    const existing = await this.ensureRow(normalized);
    const current = asConfig(existing.configJson, normalized);
    const incoming = body.config ?? {};
    const next = { ...current };

    for (const key of GROUP_KEYS[normalized]) {
      if (!(key in incoming)) continue;
      const value = String(incoming[key] ?? '').trim();
      if (SECRET_KEYS.has(key) && (!value || isMasked(value))) {
        continue;
      }
      next[key] = value;
    }

    let enabled = body.enabled ?? existing.enabled;
    let lastTestedAt = existing.lastTestedAt;
    let lastTestOk = existing.lastTestOk;
    let lastTestMessage = existing.lastTestMessage;

    if (enabled && REQUIRE_TEST_ON_ENABLE.has(normalized)) {
      const test = await this.runTest(normalized, next);
      lastTestedAt = new Date();
      lastTestOk = test.ok;
      lastTestMessage = test.message;
      if (!test.ok) {
        throw new BadRequestException(
          `Cannot enable ${normalized} settings: ${test.message}`,
        );
      }
    }

    const updated = await this.prisma.appSetting.update({
      where: { id: existing.id },
      data: {
        enabled,
        configJson: next,
        lastTestedAt,
        lastTestOk,
        lastTestMessage,
        updatedByUserId: adminUserId ?? null,
      },
    });

    if (normalized === 'regional') {
      this.reportTz?.invalidate();
    }

    return this.serialize(updated);
  }

  async testConnection(group: string, body: TestAppSettingDto) {
    const normalized = this.parseGroup(group);
    if (!TESTABLE.has(normalized)) {
      throw new BadRequestException(
        `${normalized} settings do not support a connection test.`,
      );
    }

    const existing = await this.ensureRow(normalized);
    const stored = asConfig(existing.configJson, normalized);
    const merged = { ...stored };

    if (body.config) {
      for (const key of GROUP_KEYS[normalized]) {
        if (!(key in body.config)) continue;
        const value = String(body.config[key] ?? '').trim();
        if (SECRET_KEYS.has(key) && (!value || isMasked(value))) continue;
        merged[key] = value;
      }
    }

    const result = await this.runTest(normalized, merged);

    const updated = await this.prisma.appSetting.update({
      where: { id: existing.id },
      data: {
        lastTestedAt: new Date(),
        lastTestOk: result.ok,
        lastTestMessage: result.message,
      },
    });

    return {
      success: result.ok,
      message: result.message,
      settings: this.serialize(updated),
    };
  }

  async uploadAsset(
    group: string,
    body: UploadAppSettingAssetDto,
    adminUserId?: string,
  ) {
    const normalized = this.parseGroup(group);
    if (normalized !== 'website') {
      throw new BadRequestException(
        'Image upload is only supported for website settings.',
      );
    }
    if (!(WEBSITE_ASSET_FIELDS as readonly string[]).includes(body.field)) {
      throw new BadRequestException(`Unsupported asset field: ${body.field}`);
    }

    const labels: Record<string, string> = {
      logo: 'logo',
      small_logo: 'small logo',
      site_favicon: 'favicon',
    };

    const asset = await this.mediaStorage.uploadDataUrl({
      folder: `settings/website/${body.field}`,
      dataUrl: body.data_url,
      fileName: body.file_name?.trim() || body.field,
      maxBytes: 5 * 1024 * 1024,
      allowJpgAlias: true,
      altText: labels[body.field] ?? body.field,
      uploadedByUserId: adminUserId ?? null,
      errorLabel: labels[body.field] ?? 'image',
    });

    const existing = await this.ensureRow(normalized);
    const next = asConfig(existing.configJson, normalized);
    next[body.field] = asset.url;

    const updated = await this.prisma.appSetting.update({
      where: { id: existing.id },
      data: {
        configJson: next,
        updatedByUserId: adminUserId ?? null,
      },
    });

    return {
      field: body.field,
      url: asset.url,
      settings: this.serialize(updated),
    };
  }

  private parseGroup(group: string): AppSettingGroup {
    if (!GROUPS.includes(group as AppSettingGroup)) {
      throw new NotFoundException(`Unknown settings group: ${group}`);
    }
    return group as AppSettingGroup;
  }

  private async ensureRow(group: AppSettingGroup) {
    const existing = await this.prisma.appSetting.findUnique({
      where: { group },
    });
    if (existing) return existing;

    try {
      return await this.prisma.appSetting.create({
        data: {
          group,
          enabled: false,
          configJson: emptyConfig(group),
        },
      });
    } catch (error) {
      // Concurrent GETs (e.g. React Strict Mode) can race on first create.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const row = await this.prisma.appSetting.findUnique({
          where: { group },
        });
        if (row) return row;
      }
      throw error;
    }
  }

  private serialize(row: {
    id: string;
    group: AppSettingGroup;
    enabled: boolean;
    configJson: unknown;
    lastTestedAt: Date | null;
    lastTestOk: boolean | null;
    lastTestMessage: string | null;
    updatedAt: Date;
  }) {
    const config = asConfig(row.configJson, row.group);
    const secretsSet: Record<string, boolean> = {};
    const masked = { ...config };

    for (const key of SECRET_KEYS) {
      if (!(key in masked)) continue;
      secretsSet[`${key}_set`] = Boolean(masked[key]?.trim());
      masked[key] = masked[key] ? maskSecret(masked[key]) : '';
    }

    return {
      id: row.id,
      group: row.group,
      enabled: row.enabled,
      config: masked,
      ...secretsSet,
      supports_test: TESTABLE.has(row.group),
      last_tested_at: row.lastTestedAt?.toISOString() ?? null,
      last_test_ok: row.lastTestOk,
      last_test_message: row.lastTestMessage,
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async runTest(
    group: AppSettingGroup,
    config: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }> {
    if (group === 'mail') {
      return this.testMail(config);
    }
    if (group === 'sms') {
      return this.testSms(config);
    }
    if (group === 'social') {
      return this.testSocial(config);
    }
    return { ok: false, message: 'No connection test for this group.' };
  }

  private async testMail(
    config: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }> {
    const host = config.mail_host?.trim();
    const port = Number(config.mail_port || 0);
    const encryption = (config.mail_encryption || '').trim().toLowerCase();
    const username = config.mail_username?.trim() || '';
    const password = config.mail_password?.trim() || '';

    if (!host) {
      return { ok: false, message: 'Mail host is required to test SMTP.' };
    }
    if (!port || Number.isNaN(port)) {
      return { ok: false, message: 'Mail port is required to test SMTP.' };
    }

    // Laravel/nodemailer convention:
    // - ssl  => SMTPS, TLS from the first byte (port 465)
    // - tls / starttls => plain SMTP then STARTTLS (port 587/25)
    let useImplicitTls = false;
    let useStartTls = false;

    if (encryption === 'ssl') {
      useImplicitTls = true;
    } else if (encryption === 'tls' || encryption === 'starttls') {
      useStartTls = true;
    } else if (port === 465) {
      useImplicitTls = true;
    } else if (port === 587 || port === 25) {
      useStartTls = true;
    }

    if (encryption === 'ssl' && (port === 587 || port === 25)) {
      return {
        ok: false,
        message:
          'SSL (implicit TLS) cannot be used on port 587/25. Choose TLS or STARTTLS, or use port 465 with SSL.',
      };
    }

    try {
      await this.smtpProbe({
        host,
        port,
        useImplicitTls,
        useStartTls,
        username,
        password,
      });
      return {
        ok: true,
        message: `Connected to ${host}:${port}${username ? ' and authenticated' : ''}.`,
      };
    } catch (error) {
      const raw =
        error instanceof Error ? error.message : 'SMTP connection failed.';
      if (/wrong version number/i.test(raw)) {
        return {
          ok: false,
          message: `TLS mismatch on ${host}:${port}. Use SSL with port 465, or TLS/STARTTLS with port 587.`,
        };
      }
      return { ok: false, message: raw };
    }
  }

  private async testSms(
    config: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }> {
    const provider = (config.sms_provider || 'smscountry').trim().toLowerCase();
    if (provider !== 'smscountry') {
      return {
        ok: false,
        message: `Unsupported SMS provider "${provider}". Use SMSCountry.`,
      };
    }

    const authKey = config.sms_auth_key?.trim() || '';
    const authToken = config.sms_auth_token?.trim() || '';
    const senderId = config.sms_sender_id?.trim() || '';
    const baseUrl = (
      config.sms_api_base_url?.trim() ||
      'https://restapi.smscountry.com/v0.1'
    ).replace(/\/$/, '');

    if (!authKey) {
      return { ok: false, message: 'SMS Auth Key is required to test the connection.' };
    }
    if (!authToken) {
      return {
        ok: false,
        message: 'SMS Auth Token is required to test the connection.',
      };
    }
    if (!senderId) {
      return { ok: false, message: 'Sender ID is required to test the connection.' };
    }

    const auth = Buffer.from(`${authKey}:${authToken}`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(`${baseUrl}/Accounts/${encodeURIComponent(authKey)}/`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const rawText = await response.text();
      type SmsCountryAccountResponse = {
        Success?: string | boolean;
        Message?: string;
        ApiId?: string;
        Balance?: string | number;
      };
      let payload: SmsCountryAccountResponse | null = null;
      try {
        payload = JSON.parse(rawText) as SmsCountryAccountResponse;
      } catch {
        payload = null;
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          message: 'SMSCountry rejected the Auth Key / Auth Token.',
        };
      }

      const successRaw = payload?.Success;
      const success =
        successRaw === true ||
        String(successRaw ?? '').toLowerCase() === 'true';

      if (response.ok && success) {
        const balance =
          payload?.Balance != null && String(payload.Balance).trim() !== ''
            ? ` Balance: ${payload.Balance}.`
            : '';
        return {
          ok: true,
          message: `Connected to SMSCountry as ${senderId}.${balance}`,
        };
      }

      if (response.ok && !payload) {
        // Some account endpoints return non-JSON or sparse bodies when auth is valid.
        return {
          ok: true,
          message: `Connected to SMSCountry as ${senderId}.`,
        };
      }

      return {
        ok: false,
        message:
          payload?.Message ||
          `SMSCountry returned HTTP ${response.status}${rawText ? `: ${rawText.slice(0, 180)}` : '.'}`,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, message: 'SMSCountry connection timed out.' };
      }
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'SMSCountry connection failed.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async testSocial(
    config: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }> {
    const key = config.google_map_key?.trim();
    if (!key) {
      return {
        ok: false,
        message: 'Google Maps API key is required to run a connection test.',
      };
    }

    try {
      const url = new URL(
        'https://maps.googleapis.com/maps/api/geocode/json',
      );
      url.searchParams.set('address', 'Doha');
      url.searchParams.set('key', key);

      const response = await fetch(url.toString());
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        error_message?: string;
      } | null;

      const status = payload?.status ?? 'UNKNOWN';
      if (status === 'OK' || status === 'ZERO_RESULTS') {
        return {
          ok: true,
          message: 'Google Maps API key accepted.',
        };
      }

      return {
        ok: false,
        message:
          payload?.error_message ||
          `Google Maps API returned status ${status}.`,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Google Maps API request failed.',
      };
    }
  }

  private smtpProbe(options: {
    host: string;
    port: number;
    useImplicitTls: boolean;
    useStartTls: boolean;
    username: string;
    password: string;
  }): Promise<void> {
    const {
      host,
      port,
      useImplicitTls,
      useStartTls,
      username,
      password,
    } = options;

    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      let active: net.Socket | null = null;
      let step:
        | 'banner'
        | 'ehlo1'
        | 'starttls'
        | 'ehlo2'
        | 'auth'
        | 'user'
        | 'pass'
        | 'quit' = 'banner';

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          active?.destroy();
        } catch {
          /* ignore */
        }
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        finish(new Error('SMTP connection timed out.'));
      }, 12_000);

      const write = (line: string) => {
        if (!active) {
          finish(new Error('SMTP socket is not connected.'));
          return;
        }
        active.write(`${line}\r\n`);
      };

      const afterEhloComplete = () => {
        if (username) {
          step = 'auth';
          write('AUTH LOGIN');
          return;
        }
        step = 'quit';
        write('QUIT');
        finish();
      };

      const onLine = (line: string) => {
        const code = Number(line.slice(0, 3));
        if (Number.isNaN(code)) return;

        if (step === 'banner') {
          if (code !== 220) {
            finish(new Error(`Unexpected SMTP banner: ${line}`));
            return;
          }
          step = 'ehlo1';
          write('EHLO bookingqube');
          return;
        }

        if (step === 'ehlo1') {
          if (code !== 250) {
            finish(new Error(`EHLO failed: ${line}`));
            return;
          }
          if (line.startsWith('250-')) return;
          if (useStartTls) {
            step = 'starttls';
            write('STARTTLS');
            return;
          }
          afterEhloComplete();
          return;
        }

        if (step === 'starttls') {
          if (code !== 220) {
            finish(new Error(`STARTTLS failed: ${line}`));
            return;
          }
          if (!active) {
            finish(new Error('SMTP socket is not connected.'));
            return;
          }
          const plain = active;
          plain.removeAllListeners('data');
          const secure = tls.connect({
            socket: plain,
            servername: host,
            rejectUnauthorized: false,
          });
          attach(secure);
          step = 'ehlo2';
          write('EHLO bookingqube');
          return;
        }

        if (step === 'ehlo2') {
          if (code !== 250) {
            finish(new Error(`Post-TLS EHLO failed: ${line}`));
            return;
          }
          if (line.startsWith('250-')) return;
          afterEhloComplete();
          return;
        }

        if (step === 'auth') {
          if (code !== 334) {
            finish(new Error(`AUTH LOGIN rejected: ${line}`));
            return;
          }
          step = 'user';
          write(Buffer.from(username).toString('base64'));
          return;
        }

        if (step === 'user') {
          if (code !== 334) {
            finish(new Error(`SMTP username rejected: ${line}`));
            return;
          }
          step = 'pass';
          write(Buffer.from(password).toString('base64'));
          return;
        }

        if (step === 'pass') {
          if (code !== 235) {
            finish(new Error(`SMTP authentication failed: ${line}`));
            return;
          }
          step = 'quit';
          write('QUIT');
          finish();
        }
      };

      const onData = (chunk: string | Buffer) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          if (line.trim()) onLine(line.trim());
        }
      };

      const attach = (target: net.Socket) => {
        active = target;
        target.setEncoding('utf8');
        target.on('data', onData);
        target.on('error', (error) => finish(error));
        target.on('end', () => {
          if (!settled) finish(new Error('SMTP connection closed unexpectedly.'));
        });
      };

      attach(
        useImplicitTls
          ? tls.connect({
              host,
              port,
              servername: host,
              rejectUnauthorized: false,
            })
          : net.connect({ host, port }),
      );
    });
  }
}

