import { createReadStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  mediaContentType,
  resolveLocalMediaPath,
} from './resolve-local-media-path';

type MediaWildcardRequest = FastifyRequest<{ Params: { '*': string } }>;

export async function registerLocalMedia(app: NestFastifyApplication) {
  const uploadsRoot = join(process.cwd(), 'uploads');
  await mkdir(uploadsRoot, { recursive: true });

  app
    .getHttpAdapter()
    .getInstance()
    .get<{ Params: { '*': string } }>(
      '/media/*',
      async (request: MediaWildcardRequest, reply: FastifyReply) => {
        const absolute = resolveLocalMediaPath(
          uploadsRoot,
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
          .header('Content-Type', mediaContentType(absolute))
          .header('X-Content-Type-Options', 'nosniff')
          .header(
            'Content-Disposition',
            `inline; filename="${basename(absolute)}"`,
          )
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          .send(createReadStream(absolute));
      },
    );
}
