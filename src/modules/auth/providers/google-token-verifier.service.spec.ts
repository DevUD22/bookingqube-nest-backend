import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

import { GoogleTokenVerifierService } from './google-token-verifier.service';

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    getTokenInfo: jest.fn(),
  })),
}));

describe('GoogleTokenVerifierService', () => {
  const getTokenInfo = jest.fn();
  const config = { getOrThrow: jest.fn().mockReturnValue('google-client-id') };

  beforeEach(() => {
    getTokenInfo.mockReset();
    (OAuth2Client as unknown as jest.Mock).mockImplementation(() => ({ getTokenInfo }));
  });

  it('rejects Google tokens whose email is not verified', async () => {
    getTokenInfo.mockResolvedValue({
      email: 'user@example.com',
      aud: 'google-client-id',
      email_verified: false,
    });
    const service = new GoogleTokenVerifierService(config as unknown as ConfigService);
    await expect(service.verify('token', 'user@example.com')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a verified Google email that matches audience', async () => {
    getTokenInfo.mockResolvedValue({
      email: 'user@example.com',
      aud: 'google-client-id',
      email_verified: 'true',
    });
    const service = new GoogleTokenVerifierService(config as unknown as ConfigService);
    await expect(service.verify('token', 'user@example.com')).resolves.toEqual({
      email: 'user@example.com',
    });
  });
});
