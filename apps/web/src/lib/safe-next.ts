/**
 * Sanitize a post-login `next` redirect target to a same-origin path.
 *
 * Browsers treat `\` as `/` and strip tab/CR/LF in URLs, so prefix checks like
 * `startsWith("/") && !startsWith("//")` are bypassable (`/\evil.com`, `/\t/evil.com`).
 * Resolve against a fixed origin and require the origin to be unchanged instead.
 */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  const base = "http://same-origin.invalid";
  let u: URL;
  try {
    u = new URL(next, base);
  } catch {
    return fallback;
  }
  if (u.origin !== base) return fallback;
  return `${u.pathname}${u.search}${u.hash}`;
}
