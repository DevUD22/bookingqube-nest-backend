import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function keyFromMaterial(keyMaterial: string): Buffer {
  return createHash('sha256').update(`bq-mfa:${keyMaterial}`).digest();
}

export function encryptSecret(plaintext: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromMaterial(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(payload: string, keyMaterial: string): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Invalid encrypted secret.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFromMaterial(keyMaterial),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
