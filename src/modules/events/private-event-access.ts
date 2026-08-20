import { createHmac, timingSafeEqual } from 'crypto';

export const PRIVATE_EVENT_ACCESS_HEADER = 'x-event-access-token';
export const PRIVATE_EVENT_PASSWORD_HEADER = 'x-event-password';
export const PRIVATE_EVENT_ACCESS_QUERY = 'access_token';
export const PRIVATE_EVENT_TOKEN_TTL_SECONDS = 86_400;

export function issuePrivateEventAccessToken(
  eventId: string,
  slug: string,
  secret: string,
): { access_token: string; expires_at: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + PRIVATE_EVENT_TOKEN_TTL_SECONDS;
  return {
    access_token: makePrivateEventAccessToken(eventId, slug, expiresAt, secret),
    expires_at: expiresAt,
  };
}

export function makePrivateEventAccessToken(
  eventId: string,
  slug: string,
  exp: number,
  secret: string,
): string {
  const sig = createHmac('sha256', secret)
    .update(`${eventId}|${slug}|${exp}`)
    .digest('hex');
  return `${eventId}.${exp}.${sig}`;
}

export function isPrivateEventAccessTokenValid(
  token: string | null | undefined,
  eventId: string,
  slug: string,
  secret: string,
): boolean {
  const value = (token ?? '').trim();
  if (!value || !eventId || !slug) return false;

  const parts = value.split('.');
  if (parts.length !== 3) return false;

  const [tokenEventId, expRaw, sig] = parts;
  if (tokenEventId !== eventId) return false;

  const exp = Number(expRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(exp) || exp <= 0 || exp < now) return false;
  if (exp > now + PRIVATE_EVENT_TOKEN_TTL_SECONDS + 120) return false;

  const expected = makePrivateEventAccessToken(eventId, slug, exp, secret);
  const expectedSig = expected.split('.')[2] ?? '';
  try {
    const a = Buffer.from(expectedSig);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function decodePrivateEventPasswordHeader(
  headerValue: string | null | undefined,
): string | null {
  const raw = (headerValue ?? '').trim();
  if (!raw) return null;

  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  try {
    const decoded = Buffer.from(b64 + pad, 'base64').toString('utf8').trim();
    if (decoded) return decoded;
  } catch {
    /* fall through */
  }
  return raw;
}

export function passwordsMatch(expected: string | null | undefined, provided: string): boolean {
  const left = (expected ?? '').trim();
  const right = provided.trim();
  if (!left || !right) return false;
  try {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
