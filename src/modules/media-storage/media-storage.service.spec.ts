import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../database/prisma.service';
import {
  MediaStorageService,
  resolveUploadKind,
  sniffImageMagicBytes,
} from './media-storage.service';

describe('sniffImageMagicBytes', () => {
  it('detects JPEG, PNG, and WebP signatures', () => {
    expect(sniffImageMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toEqual({
      mimeType: 'image/jpeg',
      extension: '.jpg',
    });
    expect(
      sniffImageMagicBytes(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toEqual({ mimeType: 'image/png', extension: '.png' });
    expect(sniffImageMagicBytes(Buffer.from('RIFF\0\0\0\0WEBP'))).toEqual({
      mimeType: 'image/webp',
      extension: '.webp',
    });
  });

  it('rejects HTML labelled as an image', () => {
    expect(sniffImageMagicBytes(Buffer.from('<!doctype html>'))).toBeNull();
  });
});

describe('resolveUploadKind', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = Buffer.from('%PDF-1.4\n%');

  it('uses JPEG magic bytes when the caller labelled the file as PNG', () => {
    expect(resolveUploadKind(jpeg, 'image/png', '.png')).toEqual({
      mimeType: 'image/jpeg',
      extension: '.jpg',
    });
  });

  it('accepts a real PDF and rejects HTML labelled as PDF', () => {
    expect(resolveUploadKind(pdf, 'application/pdf', '.pdf')).toEqual({
      mimeType: 'application/pdf',
      extension: '.pdf',
    });
    expect(() =>
      resolveUploadKind(Buffer.from('<!doctype html>'), 'application/pdf', '.pdf'),
    ).toThrow(BadRequestException);
  });

  it('rejects SVG labelled as an image', () => {
    expect(() =>
      resolveUploadKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', '.svg'),
    ).toThrow(BadRequestException);
  });
});

describe('MediaStorageService.parseImageDataUrl', () => {
  const service = new MediaStorageService(
    {} as PrismaService,
    { get: () => undefined } as unknown as ConfigService,
  );

  it('stores the sniffed type when the data-URL MIME is wrong', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const parsed = service.parseImageDataUrl(
      `data:image/png;base64,${jpeg.toString('base64')}`,
    );
    expect(parsed.mimeType).toBe('image/jpeg');
    expect(parsed.extension).toBe('.jpg');
  });

  it('rejects a PNG data URL whose bytes are not an image', () => {
    const html = Buffer.from('<script>alert(1)</script>');
    expect(() =>
      service.parseImageDataUrl(`data:image/png;base64,${html.toString('base64')}`),
    ).toThrow(BadRequestException);
  });
});
