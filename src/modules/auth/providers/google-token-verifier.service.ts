import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleTokenVerifierService {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  async verify(accessToken: string, expectedEmail: string): Promise<{ email: string }> {
    let info;
    try {
      info = await this.client.getTokenInfo(accessToken);
    } catch {
      throw new UnauthorizedException('Invalid Google access token.');
    }

    if (!info.email || info.email.toLowerCase() !== expectedEmail.trim().toLowerCase()) {
      throw new UnauthorizedException('Google token does not match the provided account.');
    }

    const expectedAudience = this.config.getOrThrow<string>('GOOGLE_OAUTH_CLIENT_ID');
    if (info.aud !== expectedAudience) {
      throw new UnauthorizedException('Google token audience mismatch.');
    }

    return { email: info.email };
  }
}
