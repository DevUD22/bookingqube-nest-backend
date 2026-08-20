import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient } from '@azure/storage-blob';
import { MediaAsset, Prisma, StorageProvider } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PrismaService } from '../../database/prisma.service';
import {
  ResolvedStorageConfig,
  StoredFileMeta,
  UploadBufferInput,
} from './media-storage.types';

const IMAGE_MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolveConfig(): Promise<ResolvedStorageConfig> {
    const row = await this.prisma.fileStorageSetting.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    if (row) {
      return {
        enabled: row.enabled,
        connectionString: row.connectionString,
        containerName: row.containerName,
        publicBaseUrl: row.publicBaseUrl,
        source: 'database',
      };
    }

    const connectionString =
      this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING')?.trim() || null;
    const containerName =
      this.config.get<string>('AZURE_STORAGE_CONTAINER')?.trim() || null;
    const publicBaseUrl =
      this.config.get<string>('PUBLIC_MEDIA_BASE_URL')?.trim() || null;

    if (connectionString || containerName || publicBaseUrl) {
      return {
        enabled: false,
        connectionString,
        containerName,
        publicBaseUrl,
        source: 'env',
      };
    }

    return {
      enabled: false,
      connectionString: null,
      containerName: null,
      publicBaseUrl: null,
      source: 'none',
    };
  }

  async isAzureEnabled(): Promise<boolean> {
    const cfg = await this.resolveConfig();
    return Boolean(
      cfg.enabled &&
        cfg.connectionString?.trim() &&
        cfg.containerName?.trim() &&
        cfg.publicBaseUrl?.trim(),
    );
  }

  async testConnection(input: {
    connectionString: string;
    containerName: string;
  }): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const connectionString = input.connectionString?.trim();
    const containerName = input.containerName?.trim();
    if (!connectionString) {
      return { ok: false, message: 'Connection string is required.' };
    }
    if (!containerName) {
      return { ok: false, message: 'Container name is required.' };
    }

    try {
      const client = BlobServiceClient.fromConnectionString(connectionString);
      const container = client.getContainerClient(containerName);
      await container.getProperties();
      return {
        ok: true,
        message: `Connected to container "${containerName}".`,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Azure Blob connection failed.';
      this.logger.warn(`Azure Blob test failed: ${message}`);
      return { ok: false, message };
    }
  }

  /**
   * Store bytes on the active provider and return location metadata (no MediaAsset row).
   */
  async storeFile(input: UploadBufferInput): Promise<StoredFileMeta> {
    const folder = input.folder.replace(/^\/+|\/+$/g, '');
    if (!folder) {
      throw new BadRequestException('Storage folder is required.');
    }
    if (!input.buffer?.length) {
      throw new BadRequestException('Empty file upload.');
    }

    const extension = input.extension.startsWith('.')
      ? input.extension
      : `.${input.extension}`;
    const storageKey = `${folder}/${randomUUID()}${extension}`;

    if (await this.isAzureEnabled()) {
      return this.storeOnAzure(storageKey, input.buffer, input.mimeType);
    }
    return this.storeLocally(storageKey, input.buffer);
  }

  /**
   * Store bytes and create a MediaAsset row.
   */
  async uploadBuffer(
    input: UploadBufferInput,
    tx?: Prisma.TransactionClient,
  ): Promise<MediaAsset> {
    const stored = await this.storeFile(input);
    const db = tx ?? this.prisma;
    return db.mediaAsset.create({
      data: {
        storageProvider: stored.storageProvider,
        bucket: stored.bucket,
        storageKey: stored.storageKey,
        url: stored.url,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        width: input.width ?? null,
        height: input.height ?? null,
        altText: input.altText?.trim() || null,
        uploadedByUserId: input.uploadedByUserId ?? null,
      },
    });
  }

  /**
   * Parse a data URL, store it, and create a MediaAsset.
   */
  async uploadDataUrl(options: {
    folder: string;
    dataUrl: string;
    fileName?: string;
    maxBytes?: number;
    allowJpgAlias?: boolean;
    altText?: string | null;
    uploadedByUserId?: string | null;
    errorLabel?: string;
  }): Promise<MediaAsset> {
    const parsed = this.parseImageDataUrl(options.dataUrl, {
      allowJpgAlias: options.allowJpgAlias,
      maxBytes: options.maxBytes,
      errorLabel: options.errorLabel,
    });
    return this.uploadBuffer({
      folder: options.folder,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
      extension: parsed.extension,
      altText: options.altText ?? options.fileName?.trim() ?? null,
      uploadedByUserId: options.uploadedByUserId,
    });
  }

  /**
   * Parse a data URL and store it without creating MediaAsset (returns public URL).
   */
  async uploadDataUrlFileOnly(options: {
    folder: string;
    dataUrl: string;
    fileName?: string;
    maxBytes?: number;
    allowJpgAlias?: boolean;
    errorLabel?: string;
  }): Promise<StoredFileMeta> {
    const parsed = this.parseImageDataUrl(options.dataUrl, {
      allowJpgAlias: options.allowJpgAlias,
      maxBytes: options.maxBytes,
      errorLabel: options.errorLabel,
    });
    return this.storeFile({
      folder: options.folder,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
      extension: parsed.extension,
    });
  }

  parseImageDataUrl(
    dataUrl: string,
    options?: {
      allowJpgAlias?: boolean;
      maxBytes?: number;
      errorLabel?: string;
    },
  ): { buffer: Buffer; mimeType: string; extension: string } {
    const label = options?.errorLabel ?? 'image';
    const pattern = options?.allowJpgAlias
      ? /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i
      : /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
    const match = dataUrl.trim().match(pattern);
    if (!match) {
      throw new BadRequestException(
        `Upload a JPG, PNG, or WebP ${label}.`,
      );
    }
    const rawMime = match[1].toLowerCase();
    const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    const buffer = Buffer.from(
      options?.allowJpgAlias ? match[2].replace(/\s+/g, '') : match[2],
      'base64',
    );
    const maxBytes = options?.maxBytes ?? 10 * 1024 * 1024;
    if (!buffer.length || buffer.length > maxBytes) {
      throw new BadRequestException(
        `${label.charAt(0).toUpperCase()}${label.slice(1)} must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`,
      );
    }
    const extension = IMAGE_MIME_EXTENSION[rawMime] ?? IMAGE_MIME_EXTENSION[mimeType] ?? '.jpg';
    return { buffer, mimeType, extension };
  }

  private async storeLocally(storageKey: string, buffer: Buffer): Promise<StoredFileMeta> {
    const absolutePath = join(process.cwd(), 'uploads', storageKey);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    const baseUrl = (
      this.config.get<string>('BACKEND_PUBLIC_URL') ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    return {
      storageProvider: StorageProvider.local,
      bucket: 'uploads',
      storageKey,
      url: `${baseUrl}/media/${storageKey}`,
    };
  }

  private async storeOnAzure(
    storageKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<StoredFileMeta> {
    const cfg = await this.resolveConfig();
    if (
      !cfg.connectionString?.trim() ||
      !cfg.containerName?.trim() ||
      !cfg.publicBaseUrl?.trim()
    ) {
      throw new ServiceUnavailableException(
        'Azure Blob storage is enabled but not fully configured.',
      );
    }

    try {
      const client = BlobServiceClient.fromConnectionString(cfg.connectionString);
      const container = client.getContainerClient(cfg.containerName);
      const blob = container.getBlockBlobClient(storageKey);
      await blob.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: mimeType },
      });
      const publicBase = cfg.publicBaseUrl.replace(/\/$/, '');
      return {
        storageProvider: StorageProvider.azure_blob,
        bucket: cfg.containerName,
        storageKey,
        url: `${publicBase}/${storageKey}`,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Azure Blob upload failed.';
      this.logger.error(`Azure Blob upload failed: ${message}`);
      throw new ServiceUnavailableException(
        'Failed to upload file to Azure Blob storage.',
      );
    }
  }
}
