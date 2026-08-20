import { sanitizeCmsHtml, sanitizeCmsHtmlOrNull } from './sanitize-cms-html';

describe('sanitizeCmsHtml', () => {
  it('strips script tags and event handlers', () => {
    const dirty =
      '<p>Hello</p><script>alert(1)</script><img src=x onerror="alert(1)">';
    const cleaned = sanitizeCmsHtml(dirty);
    expect(cleaned).toContain('<p>Hello</p>');
    expect(cleaned.toLowerCase()).not.toContain('script');
    expect(cleaned.toLowerCase()).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    expect(sanitizeCmsHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(
      /javascript:/i,
    );
  });

  it('strips malformed tags that a regex allowlist would miss', () => {
    const cleaned = sanitizeCmsHtml('<svg/onload=alert(1)><p>ok</p>');
    expect(cleaned.toLowerCase()).not.toContain('svg');
    expect(cleaned.toLowerCase()).not.toContain('onload');
    expect(cleaned).toContain('<p>ok</p>');
  });

  it('returns null for empty or blank paragraphs', () => {
    expect(sanitizeCmsHtmlOrNull('   ')).toBeNull();
    expect(sanitizeCmsHtmlOrNull('<p></p>')).toBeNull();
  });
});
