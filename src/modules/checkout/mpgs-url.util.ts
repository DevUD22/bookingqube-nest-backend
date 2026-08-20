/**
 * Build MPGS session URL:
 * `{gatewayHost}/api/rest/version/{apiVersion}/merchant/{merchantId}/session`
 * Accepts a host-only value or a legacy full path and normalizes it.
 */
export function buildMastercardSessionUrl(
  endpointUrl: string,
  merchantId: string,
  apiVersion: string,
) {
  const trimmed = endpointUrl.trim().replace(/\/+$/, '');
  let host = trimmed;

  try {
    const parsed = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    host = `${parsed.protocol}//${parsed.host}`;
  } catch {
    host = trimmed.replace(/\/api\/rest\/.*$/i, '').replace(/\/+$/, '');
  }

  const version = apiVersion.trim().replace(/[^\d]/g, '') || '100';
  const encodedMerchant = encodeURIComponent(merchantId.trim());
  return `${host}/api/rest/version/${version}/merchant/${encodedMerchant}/session`;
}
