import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import {
  TestFileStorageDto,
  UpsertFileStorageSettingDto,
} from './dto/admin-file-storage.dto';

function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 12) return '••••••••••••';
  return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}

function isMasked(value: string) {
  return value.includes('••••');
}

@Injectable()
export class AdminFileStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    private readonly config: ConfigService,
  ) {}

  async get() {
    const row = await this.ensureRow();
    return this.serialize(row);
  }

  async upsert(body: UpsertFileStorageSettingDto, adminUserId?: string) {
    const existing = await this.ensureRow();

    let connectionString = existing.connectionString ?? '';
    if (body.connection_string !== undefined) {
      const incoming = body.connection_string.trim();
      if (incoming && !isMasked(incoming)) {
        connectionString = incoming;
      } else if (!incoming && !isMasked(incoming)) {
        // blank intentionally clears only when not a mask placeholder — keep prior
      }
    }

    const containerName =
      body.container_name !== undefined
        ? body.container_name.trim() || null
        : existing.containerName;
    const publicBaseUrl =
      body.public_base_url !== undefined
        ? body.public_base_url.trim().replace(/\/$/, '') || null
        : existing.publicBaseUrl;

    let enabled = body.enabled ?? existing.enabled;
    let lastTestedAt = existing.lastTestedAt;
    let lastTestOk = existing.lastTestOk;
    let lastTestMessage = existing.lastTestMessage;

    if (enabled) {
      if (!connectionString?.trim()) {
        throw new BadRequestException(
          'Add an Azure connection string before enabling Blob storage.',
        );
      }
      if (!containerName?.trim()) {
        throw new BadRequestException(
          'Add a container name before enabling Blob storage.',
        );
      }
      if (!publicBaseUrl?.trim()) {
        throw new BadRequestException(
          'Add a public base URL before enabling Blob storage.',
        );
      }

      const test = await this.mediaStorage.testConnection({
        connectionString,
        containerName,
      });
      lastTestedAt = new Date();
      lastTestOk = test.ok;
      lastTestMessage = test.message;
      if (!test.ok) {
        throw new BadRequestException(
          `Cannot enable Azure Blob storage: ${test.message}`,
        );
      }
    }

    const updated = await this.prisma.fileStorageSetting.update({
      where: { id: existing.id },
      data: {
        provider: StorageProvider.azure_blob,
        enabled,
        connectionString: connectionString || null,
        containerName,
        publicBaseUrl,
        lastTestedAt,
        lastTestOk,
        lastTestMessage,
        updatedByUserId: adminUserId ?? null,
      },
    });

    return this.serialize(updated);
  }

  async testConnection(body: TestFileStorageDto) {
    const existing = await this.ensureRow();
    const connectionString =
      body.connection_string?.trim() && !isMasked(body.connection_string)
        ? body.connection_string.trim()
        : existing.connectionString?.trim() ||
          this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING')?.trim() ||
          '';
    const containerName =
      body.container_name?.trim() ||
      existing.containerName?.trim() ||
      this.config.get<string>('AZURE_STORAGE_CONTAINER')?.trim() ||
      '';

    if (!connectionString) {
      throw new BadRequestException('Connection string is required to test.');
    }
    if (!containerName) {
      throw new BadRequestException('Container name is required to test.');
    }

    const result = await this.mediaStorage.testConnection({
      connectionString,
      containerName,
    });

    const updated = await this.prisma.fileStorageSetting.update({
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

  private async ensureRow() {
    const existing = await this.prisma.fileStorageSetting.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;

    return this.prisma.fileStorageSetting.create({
      data: {
        provider: StorageProvider.azure_blob,
        enabled: false,
        connectionString:
          this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING')?.trim() ||
          null,
        containerName:
          this.config.get<string>('AZURE_STORAGE_CONTAINER')?.trim() || null,
        publicBaseUrl:
          this.config.get<string>('PUBLIC_MEDIA_BASE_URL')?.trim() || null,
      },
    });
  }

  private serialize(row: {
    id: string;
    provider: StorageProvider;
    enabled: boolean;
    connectionString: string | null;
    containerName: string | null;
    publicBaseUrl: string | null;
    lastTestedAt: Date | null;
    lastTestOk: boolean | null;
    lastTestMessage: string | null;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      provider: row.provider,
      enabled: row.enabled,
      connection_string: row.connectionString
        ? maskSecret(row.connectionString)
        : '',
      connection_string_set: Boolean(row.connectionString?.trim()),
      container_name: row.containerName ?? '',
      public_base_url: row.publicBaseUrl ?? '',
      last_tested_at: row.lastTestedAt?.toISOString() ?? null,
      last_test_ok: row.lastTestOk,
      last_test_message: row.lastTestMessage,
      updated_at: row.updatedAt.toISOString(),
      active_provider: row.enabled ? 'azure_blob' : 'local',
    };
  }
}
