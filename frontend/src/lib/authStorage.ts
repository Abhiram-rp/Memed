/**
 * Token storage (D16: JWT in localStorage, sent as `Authorization: Bearer`).
 *
 * Every function is SSR-safe: during server rendering `window` is undefined, so
 * reads return `null` and writes are no-ops. Storage access is wrapped in
 * try/catch because localStorage throws in private-mode / blocked-cookie
 * environments.
 */

const TOKEN_KEY = "memed_token";

export function getToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode, quota, blocked cookies) — the session
    // simply will not persist across reloads.
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do: the token is already unreachable.
  }
}
