import { describe, it, expect } from 'vitest';
import { isTokenRejected } from './useDriveStore';

/**
 * checkOnStartup used to delete the keychain refresh token on ANY failure, so launching
 * offline cost the user their Drive connection permanently. The rule this encodes: only
 * destroy credentials when Google answered and said no.
 *
 * The message strings are the ones oauth.rs really produces — do_token_refresh formats
 * "Token refresh failed: {code} {body}" for an HTTP status and "Token refresh error: {e}"
 * for a transport failure; get_fresh_access_token returns a bare "no-token".
 */
describe('isTokenRejected', () => {
  it('treats a missing keychain entry as gone', () => {
    expect(isTokenRejected('no-token')).toBe(true);
  });

  it('treats an explicit invalid_grant as revoked', () => {
    expect(isTokenRejected('Token refresh failed: 400 {"error":"invalid_grant"}')).toBe(true);
  });

  it('treats any 4xx from the token endpoint as rejection', () => {
    expect(isTokenRejected('Token refresh failed: 401 Unauthorized')).toBe(true);
    expect(isTokenRejected('Token refresh failed: 403 Forbidden')).toBe(true);
  });

  // The whole point: these must NOT cost the user their credentials.
  it('keeps the token when the network is the problem', () => {
    expect(isTokenRejected('Token refresh error: Dns Failed: resolve')).toBe(false);
    expect(isTokenRejected('Token refresh error: Io: connection refused')).toBe(false);
  });

  it("keeps the token when Google's servers are having a bad day", () => {
    expect(isTokenRejected('Token refresh failed: 500 Internal Server Error')).toBe(false);
    expect(isTokenRejected('Token refresh failed: 503 Service Unavailable')).toBe(false);
  });

  it('keeps the token on a malformed response or an unrecognised error', () => {
    expect(isTokenRejected('JSON error: expected value at line 1')).toBe(false);
    expect(isTokenRejected('Task join error: panicked')).toBe(false);
    expect(isTokenRejected('')).toBe(false);
  });
});
