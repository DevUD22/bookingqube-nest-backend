import {
  listAllowedFrontendOrigins,
  resolveAllowedFrontendOrigin,
  sanitizePostPayRedirect,
} from './frontend-origin';

describe('frontend-origin allowlist', () => {
  const allowed = listAllowedFrontendOrigins(
    ['http://localhost:3000', 'http://localhost:3001'],
    'http://localhost:3000',
  );

  it('accepts CORS and APP_PUBLIC_URL origins', () => {
    expect(allowed).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
    ]);
  });

  it('rejects an attacker origin from success_url', () => {
    expect(
      resolveAllowedFrontendOrigin({
        allowedOrigins: allowed,
        fallbackOrigin: 'http://localhost:3000',
        successUrl: 'https://evil.example/pay-success',
      }),
    ).toBe('http://localhost:3000');
  });

  it('keeps relative post-pay paths', () => {
    expect(
      sanitizePostPayRedirect(
        '/mpgs-success',
        allowed,
        'http://localhost:3000',
        '/mpgs-success',
      ),
    ).toBe('/mpgs-success');
  });

  it('replaces absolute URLs outside the allowlist', () => {
    expect(
      sanitizePostPayRedirect(
        'https://evil.example/catch',
        allowed,
        'http://localhost:3000',
        '/mpgs-fail',
      ),
    ).toBe('http://localhost:3000/mpgs-fail');
  });
});
