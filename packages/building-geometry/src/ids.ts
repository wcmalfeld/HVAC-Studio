const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** `${prefix}-${12 random base36 chars}` using crypto.getRandomValues (browser + Node ≥ 19). */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  // 252 = 7 * 36: reject above it to avoid modulo bias.
  let i = 0;
  while (s.length < 12) {
    if (i >= bytes.length) { globalThis.crypto.getRandomValues(bytes); i = 0; }
    const b = bytes[i++]!;
    if (b < 252) s += ALPHABET[b % 36];
  }
  return `${prefix}-${s}`;
}
