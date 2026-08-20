function normalizeOrigin(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function listAllowedFrontendOrigins(
  corsOrigins: string[] | undefined,
  appPublicUrl?: string | null,
): string[] {
  const origins = new Set<string>();
  for (const origin of corsOrigins ?? []) {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  const appOrigin = normalizeOrigin(appPublicUrl ?? undefined);
  if (appOrigin) origins.add(appOrigin);
  return [...origins];
}

export function isSafeRelativePath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
}

export function resolveAllowedFrontendOrigin(input: {
  allowedOrigins: string[];
  fallbackOrigin?: string | null;
  baseDomain?: string | null;
  successUrl?: string | null;
}): string | null {
  const allowed = new Set(input.allowedOrigins);
  const fallback =
    normalizeOrigin(input.fallbackOrigin) &&
    allowed.has(normalizeOrigin(input.fallbackOrigin) as string)
      ? normalizeOrigin(input.fallbackOrigin)
      : input.allowedOrigins[0] ?? null;

  const baseOrigin = normalizeOrigin(input.baseDomain);
  if (baseOrigin && allowed.has(baseOrigin)) return baseOrigin;

  const success = (input.successUrl || '').trim();
  if (success && isSafeRelativePath(success)) return fallback;
  const successOrigin = normalizeOrigin(success);
  if (successOrigin && allowed.has(successOrigin)) return successOrigin;

  return fallback;
}

export function sanitizePostPayRedirect(
  raw: string | null | undefined,
  allowedOrigins: string[],
  fallbackOrigin: string | null,
  fallbackPath: string,
): string {
  const value = (raw || '').trim();
  const allowed = new Set(allowedOrigins);
  if (value && isSafeRelativePath(value)) return value;
  const origin = normalizeOrigin(value);
  if (value && origin && allowed.has(origin)) return value;
  if (fallbackOrigin && isSafeRelativePath(fallbackPath)) {
    return `${fallbackOrigin.replace(/\/+$/, '')}${fallbackPath}`;
  }
  return fallbackPath;
}
