import {
  FilterXSS,
  friendlyAttrValue,
  safeAttrValue as defaultSafeAttrValue,
  type ICSSFilter,
} from 'xss';

function isSafeUri(value: string, attr: string): boolean {
  const trimmed = value.trim();
  if (/^https?:/i.test(trimmed)) return true;
  if (attr === 'href' && /^(?:mailto:|\/(?!\/)|#)/i.test(trimmed)) return true;
  return false;
}

const cmsXss = new FilterXSS({
  whiteList: {
    p: ['class'],
    h1: ['class'],
    h2: ['class'],
    h3: ['class'],
    a: ['href', 'title', 'target', 'rel', 'class'],
    ul: ['class'],
    ol: ['class'],
    li: ['class'],
    strong: ['class'],
    em: ['class'],
    br: [],
    img: ['src', 'alt', 'title', 'class'],
    span: ['class'],
    blockquote: ['class'],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  css: false,
  safeAttrValue(tag: string, name: string, value: string, cssFilter: ICSSFilter) {
    if (name === 'href' || name === 'src') {
      return isSafeUri(value, name) ? friendlyAttrValue(value) : '';
    }
    return defaultSafeAttrValue(tag, name, value, cssFilter);
  },
});

export function sanitizeCmsHtml(value: string | null | undefined): string {
  if (value == null) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '<p></p>') return '';

  const cleaned = cmsXss.process(trimmed).trim();
  if (!cleaned || cleaned === '<p></p>') return '';
  return cleaned;
}

export function sanitizeCmsHtmlOrNull(
  value: string | null | undefined,
): string | null {
  const cleaned = sanitizeCmsHtml(value);
  return cleaned ? cleaned : null;
}
