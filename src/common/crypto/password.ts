import * as bcrypt from 'bcrypt';

/** OWASP minimum bcrypt cost (cost 10 is below current target). */
export const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_COST;
  } catch {
    return false;
  }
}

/** After a successful verify, return a cost-12 hash if the stored hash is stale. */
export async function upgradeHashIfNeeded(
  plain: string,
  currentHash: string,
): Promise<string | undefined> {
  if (!needsRehash(currentHash)) {
    return undefined;
  }
  return hashPassword(plain);
}
