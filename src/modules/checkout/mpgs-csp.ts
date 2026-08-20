/** Mastercard Checkout.js hosts. Keep in sync with admin MPGS environment URLs. */
export const MPGS_GATEWAY_ORIGINS = [
  'https://test-cbq.mtf.gateway.mastercard.com',
  'https://cbq.gateway.mastercard.com',
  'https://test-gateway.mastercard.com',
  'https://ap-gateway.mastercard.com',
  'https://eu-gateway.mastercard.com',
  'https://na-gateway.mastercard.com',
] as const;

/** CSP for the hosted MPGS HTML page only (Checkout.js + inline bootstrap). */
export const MPGS_CHECKOUT_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${MPGS_GATEWAY_ORIGINS.join(' ')}`,
  `frame-src 'self' ${MPGS_GATEWAY_ORIGINS.join(' ')}`,
  `connect-src 'self' ${MPGS_GATEWAY_ORIGINS.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "form-action 'self' https:",
].join('; ');
