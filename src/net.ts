/** IPv4 arithmetic on unsigned 32-bit numbers. */

export function parseIp(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function formatIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixOfMask(mask: number): number | null {
  const inv = ~mask >>> 0;
  if ((inv & (inv + 1)) !== 0) return null; // host bits must be a run of ones: 0..01..1
  return 32 - Math.log2(inv + 1);
}

export const networkOf = (ip: number, prefix: number) => (ip & maskOf(prefix)) >>> 0;
export const broadcastOf = (ip: number, prefix: number) => (networkOf(ip, prefix) | (~maskOf(prefix) >>> 0)) >>> 0;

/** Usable host addresses. /31 links have 2 (RFC 3021), /32 is a single host. */
export function usableHosts(prefix: number): number {
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return 2 ** (32 - prefix) - 2;
}

export function firstHost(ip: number, prefix: number): number {
  return prefix >= 31 ? networkOf(ip, prefix) : networkOf(ip, prefix) + 1;
}

export function lastHost(ip: number, prefix: number): number {
  return prefix >= 31 ? broadcastOf(ip, prefix) : broadcastOf(ip, prefix) - 1;
}

/**
 * Smallest ordinary LAN subnet that fits `hosts` hosts: 2^(32-p) - 2 >= hosts.
 * /31 point-to-point links are left out on purpose, as in most textbooks and exams.
 */
export function prefixForHosts(hosts: number): number {
  if (hosts <= 1) return 32;
  for (let p = 30; p >= 0; p--) if (2 ** (32 - p) - 2 >= hosts) return p;
  return 0;
}

export const sameSubnet = (a: number, b: number, prefix: number) => networkOf(a, prefix) === networkOf(b, prefix);

/** "11000000101010000000000100001010" for 192.168.1.10. */
export const bits = (n: number) => (n >>> 0).toString(2).padStart(32, "0");
