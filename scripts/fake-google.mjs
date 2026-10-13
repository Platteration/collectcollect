// A stand-in for Google's side of "Sign in with Google", for the tests: the
// consent screen (`authorize`, which turns the address the app sent the browser
// to into the address Google sends it back to) and the two addresses the server
// calls (`fetch`: the token endpoint and the signing keys). Tests hand `fetch`
// to the app through createAuthRoutes({ fetch }); the browser suites' servers
// get it through scripts/e2e-google.mjs. Nothing points the app at another
// host: the kit's three Google addresses are constants, and these answer them.
//
// The code Google hands back is the grant itself, written out, so the consent
// screen (in the test, answering the browser at the protocol) and the token
// endpoint (in the server) need share nothing but this file. The token
// endpoint checks what Google does: the client, the redirect address and the
// PKCE verifier, and a code used once; and it signs the ID token with an RSA
// key of its own, published as Google publishes its keys.

export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** The client the browser suites' servers are configured with. */
export const E2E_CLIENT = Object.freeze({ id: 'e2e-client.apps.googleusercontent.com', secret: 'e2e-client-secret' });

/** Accounts the browser suites sign in as: one on the servers' lists, one not. */
export const E2E_ACCOUNTS = Object.freeze({
  owner: Object.freeze({ sub: '100000000000000000001', email: 'owner@example.com', email_verified: true }),
  stranger: Object.freeze({ sub: '100000000000000000002', email: 'stranger@example.com', email_verified: true }),
});

const encoder = new TextEncoder();

/** @param {Uint8Array} bytes */
function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/** @param {unknown} value */
function encodeJson(value) {
  return base64url(encoder.encode(JSON.stringify(value)));
}

/**
 * What the consent screen does once `account` agrees: the address Google sends
 * the browser back to. Throws on a request Google would refuse to show.
 * @param {string} location the address the app sent the browser to
 * @param {{ sub: string, email?: string, email_verified?: boolean, claims?: Record<string, unknown>, header?: Record<string, unknown> }} account
 * @param {{ clientId?: string }} [options]
 */
export function authorize(location, account, { clientId = E2E_CLIENT.id } = {}) {
  const url = new URL(location);
  const params = url.searchParams;
  if (`${url.origin}${url.pathname}` !== AUTHORIZE_URL) throw new Error(`not Google's authorize address: ${location}`);
  if (params.get('response_type') !== 'code') throw new Error('response_type is not code');
  if (params.get('client_id') !== clientId) throw new Error('an unknown client');
  if (!(params.get('scope') ?? '').split(' ').includes('openid')) throw new Error('the scope has no openid');
  if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) throw new Error('no S256 code challenge');
  const redirectUri = params.get('redirect_uri');
  const state = params.get('state');
  if (!redirectUri || !state || !params.get('nonce')) throw new Error('no redirect_uri, state or nonce');
  const code = encodeJson({ challenge: params.get('code_challenge'), redirectUri, nonce: params.get('nonce'), account });
  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  return back.href;
}

/**
 * Google's token endpoint and signing keys.
 * @param {{ clientId?: string, clientSecret?: string, now?: () => number }} [options]
 */
export async function createFakeGoogle({ clientId = E2E_CLIENT.id, clientSecret = E2E_CLIENT.secret, now = () => Date.now() } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'fake-google-1', alg: 'RS256', use: 'sig' };
  const calls = { token: 0, jwks: 0 };
  const used = new Set();

  /** @param {Record<string, unknown>} header @param {Record<string, unknown>} claims */
  async function sign(header, claims) {
    const input = `${encodeJson(header)}.${encodeJson(claims)}`;
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(input)));
    return `${input}.${base64url(signature)}`;
  }

  /** @param {string} error @param {number} status */
  const refuse = (error, status = 400) => Response.json({ error }, { status });

  /**
   * @param {string | URL | Request} input
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async function fetch(input, init = {}) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href === JWKS_URL) {
      calls.jwks += 1;
      return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'public, max-age=3600' } });
    }
    if (href !== TOKEN_URL || init.method !== 'POST') throw new TypeError(`the fake Google does not answer ${init.method ?? 'GET'} ${href}`);
    calls.token += 1;
    const form = new URLSearchParams(String(init.body ?? ''));
    if (form.get('grant_type') !== 'authorization_code') return refuse('unsupported_grant_type');
    if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return refuse('invalid_client', 401);
    const code = form.get('code') ?? '';
    let grant;
    try {
      grant = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
    } catch {
      return refuse('invalid_grant');
    }
    if (used.has(code) || grant?.redirectUri !== form.get('redirect_uri')) return refuse('invalid_grant');
    const verifier = form.get('code_verifier') ?? '';
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
    if (challenge !== grant.challenge) return refuse('invalid_grant');
    used.add(code);
    const { sub, email, email_verified: verified, claims = {}, header = {} } = grant.account;
    const seconds = Math.floor(now() / 1000);
    const idToken = await sign(
      { alg: 'RS256', kid: jwk.kid, typ: 'JWT', ...header },
      {
        iss: 'https://accounts.google.com',
        azp: clientId,
        aud: clientId,
        sub,
        ...(email === undefined ? {} : { email, email_verified: verified === true }),
        nonce: grant.nonce,
        iat: seconds,
        exp: seconds + 3600,
        ...claims,
      },
    );
    return Response.json({ access_token: 'unused', token_type: 'Bearer', expires_in: 3599, scope: 'openid email', id_token: idToken });
  }

  return { fetch, calls };
}
