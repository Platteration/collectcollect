// Loaded after e2e-offline.mjs into the browser suites' servers that offer
// sign-in with Google (each app's playwright.config.ts, through NODE_OPTIONS
// --import): Google's token endpoint and signing keys are answered by the fake
// in fake-google.mjs, and every other host stays as unreachable as
// e2e-offline.mjs makes it. The kit's Google addresses are constants; nothing
// is configured to point anywhere else. The consent screen is the test's own
// googleSignsIn in auth.spec.ts and google.spec.ts, through fake-google.mjs's
// authorize(), answering the browser at the protocol.
import { createFakeGoogle, JWKS_URL, TOKEN_URL } from './fake-google.mjs';

const google = await createFakeGoogle();
const previous = globalThis.fetch;

globalThis.fetch = function fetchWithFakeGoogle(input, init) {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (href === TOKEN_URL || href === JWKS_URL) return google.fetch(input, init);
  return previous(input, init);
};
