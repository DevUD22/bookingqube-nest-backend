import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const SAFE_MEDIA_KEY =
  /^(?:[a-zA-Z0-9_-]+\/)+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i;

const MEDIA_CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function mediaContentType(absolutePath: string): string {
  return MEDIA_CONTENT_TYPE[extname(absolutePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a `/media/...` request to a file inside uploadsRoot.
 * Rejects traversal, encoded separators, and anything that is not
 * `{folder...}/{uuid}.{jpg|jpeg|png|webp}`.
 */
export function resolveLocalMediaPath(
  uploadsRoot: string,
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
  if (!SAFE_MEDIA_KEY.test(key)) return null;

  const root = resolve(uploadsRoot);
  const absolute = resolve(root, key.split('/').join(sep));
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
}
