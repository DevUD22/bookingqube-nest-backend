import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const hex = randomBytes(4).toString('hex').toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function consumeRecoveryCode(hashes: string[], code: string): string[] | null {
  const digest = hashRecoveryCode(code);
  const digestBuf = Buffer.from(digest, 'hex');
  const index = hashes.findIndex((hash) => {
    const current = Buffer.from(hash, 'hex');
    return current.length === digestBuf.length && timingSafeEqual(current, digestBuf);
  });
  if (index < 0) return null;
  return hashes.filter((_, offset) => offset !== index);
}
