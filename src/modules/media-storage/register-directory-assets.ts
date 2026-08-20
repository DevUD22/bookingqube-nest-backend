import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

const CONTENT_TYPE: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function resolveDirectoryAssetPath(
  assetsRoot: string,
  requestPath: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  if (
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.includes('..') ||
    decoded.includes('%')
  ) {
    return null;
  }

  const key = decoded.replace(/^\/+/g, '').replace(/\/+$/g, '');
  if (!key || key.includes('/')) return null;
  if (!CONTENT_TYPE[extname(key).toLowerCase()]) return null;

  const root = resolve(assetsRoot);
  const absolute = resolve(root, key);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) {
    return null;
  }
  return absolute;
}

export function registerDirectoryAssets(
  app: NestFastifyApplication,
  options: { root: string; prefix: string },
) {
  const assetsRoot = resolve(options.root);
  const prefix = options.prefix.replace(/\/+$/g, '') || '/';

  app
    .getHttpAdapter()
    .getInstance()
    .get<{ Params: { '*': string } }>(
      `${prefix}/*`,
      async (
        request: FastifyRequest<{ Params: { '*': string } }>,
        reply: FastifyReply,
      ) => {
        const absolute = resolveDirectoryAssetPath(
          assetsRoot,
          request.params['*'] ?? '',
        );
        if (!absolute) {
          return reply.code(404).send({ message: 'Not found.' });
        }

        try {
          await access(absolute, fsConstants.R_OK);
        } catch {
          return reply.code(404).send({ message: 'Not found.' });
        }

        return reply
          .header(
            'Content-Type',
            CONTENT_TYPE[extname(absolute).toLowerCase()] ??
              'application/octet-stream',
          )
          .header('X-Content-Type-Options', 'nosniff')
          .header(
            'Content-Disposition',
            `inline; filename="${basename(absolute)}"`,
          )
          .send(createReadStream(absolute));
      },
    );
}
