export const AUTHORIZE_URL: "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL: "https://oauth2.googleapis.com/token";
export const JWKS_URL: "https://www.googleapis.com/oauth2/v3/certs";
export const E2E_CLIENT: Readonly<{ id: string; secret: string }>;
export interface FakeAccount {
  sub: string;
  email?: string;
  email_verified?: boolean;
  /** Claims put over the ones Google would write. */
  claims?: Record<string, unknown>;
  /** Header fields put over the ones Google would write. */
  header?: Record<string, unknown>;
}
export const E2E_ACCOUNTS: Readonly<{ owner: Readonly<FakeAccount & { email: string }>; stranger: Readonly<FakeAccount & { email: string }> }>;
export function authorize(location: string, account: FakeAccount, options?: { clientId?: string }): string;
export function createFakeGoogle(options?: { clientId?: string; clientSecret?: string; now?: () => number }): Promise<{
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  calls: { token: number; jwks: number };
}>;
