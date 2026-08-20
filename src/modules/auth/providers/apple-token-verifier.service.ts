import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

@Injectable()
export class AppleTokenVerifierService {
  private readonly jwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));

  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<{ email: string; sub: string }> {
    const audience = this.config.getOrThrow<string>('APPLE_OAUTH_CLIENT_ID');

    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: APPLE_ISSUER,
        audience,
      }));
    } catch {
      throw new UnauthorizedException('Invalid Apple id token.');
    }

    return {
      email: typeof payload.email === 'string' ? payload.email : '',
      sub: String(payload.sub),
    };
  }
}
