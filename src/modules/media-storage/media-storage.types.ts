import { StorageProvider } from '@prisma/client';

export type StoredFileMeta = {
  storageProvider: StorageProvider;
  bucket: string;
  storageKey: string;
  url: string;
};

export type UploadBufferInput = {
  folder: string;
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
  uploadedByUserId?: string | null;
};

export type ResolvedStorageConfig = {
  enabled: boolean;
  connectionString: string | null;
  containerName: string | null;
  publicBaseUrl: string | null;
  source: 'database' | 'env' | 'none';
};
