/** Question generator. Deterministic for a given random function, so it can be tested. */
import {
  broadcastOf, firstHost, formatIp, lastHost, maskOf, networkOf, parseIp, prefixForHosts, prefixOfMask,
  sameSubnet, usableHosts,
} from "./net";

export type Kind = "network" | "broadcast" | "hosts" | "mask" | "prefix" | "same" | "fit" | "first" | "last";
export const KINDS: Kind[] = ["network", "broadcast", "hosts", "mask", "prefix", "same", "fit", "first", "last"];

export const KIND_LABEL: Record<Kind, string> = {
  network: "Network address", broadcast: "Broadcast address", hosts: "Usable hosts", mask: "Prefix → mask",
  prefix: "Mask → prefix", same: "Same subnet?", fit: "Right-size a subnet", first: "First host", last: "Last host",
};

export interface Question {
  kind: Kind;
  prompt: string;
  /** Shown big: the address and prefix being asked about (if any). */
  subject: { ip?: number; prefix?: number; other?: number };
  answer: string;
  /** "ip", "number" or "yesno" decides the input control. */
  input: "ip" | "number" | "yesno";
  explain: string;
}

export type Rng = () => number;

/** Small seeded generator (mulberry32) for repeatable games and tests. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(rng: Rng, xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];

/** Level 1: octet boundaries. Level 2: /17-/30. Level 3: anything from /1 to /32. */
function randomPrefix(rng: Rng, level: number): number {
  if (level <= 1) return pick(rng, [8, 16, 24, 24, 24]);
  if (level === 2) return int(rng, 17, 30);
  return int(rng, rng() < 0.2 ? 1 : 8, 32);
}

function randomIp(rng: Rng): number {
  const first = pick(rng, [10, 172, 192, int(rng, 1, 223)]);
  const second = first === 172 ? int(rng, 16, 31) : first === 192 ? 168 : int(rng, 0, 255);
  return ((first << 24) | (second << 16) | (int(rng, 0, 255) << 8) | int(rng, 0, 255)) >>> 0;
}

const cidr = (ip: number, p: number) => `${formatIp(ip)}/${p}`;

export function makeQuestion(kind: Kind, rng: Rng, level: number): Question {
  let prefix = randomPrefix(rng, level);
  const ip = randomIp(rng);
  const net = networkOf(ip, prefix);
  const why = `The /${prefix} mask is ${formatIp(maskOf(prefix))}: ${prefix} network bits, ${32 - prefix} host bits.`;
  switch (kind) {
    case "network":
      return { kind, input: "ip", subject: { ip, prefix }, answer: formatIp(net),
        prompt: `What is the network address of ${cidr(ip, prefix)}?`,
        explain: `${why} Keep the network bits, set every host bit to 0.` };
    case "broadcast":
      return { kind, input: "ip", subject: { ip, prefix }, answer: formatIp(broadcastOf(ip, prefix)),
        prompt: `What is the broadcast address of ${cidr(ip, prefix)}?`,
        explain: `${why} Keep the network bits, set every host bit to 1.` };
    case "first":
      if (prefix > 30) prefix = 30;
      return { kind, input: "ip", subject: { ip, prefix }, answer: formatIp(firstHost(ip, prefix)),
        prompt: `First usable host in ${cidr(ip, prefix)}?`,
        explain: `The network address ${formatIp(networkOf(ip, prefix))} is reserved, so the first host is one above it.` };
    case "last":
      if (prefix > 30) prefix = 30;
      return { kind, input: "ip", subject: { ip, prefix }, answer: formatIp(lastHost(ip, prefix)),
        prompt: `Last usable host in ${cidr(ip, prefix)}?`,
        explain: `The broadcast address ${formatIp(broadcastOf(ip, prefix))} is reserved, so the last host is one below it.` };
    case "hosts": {
      const n = usableHosts(prefix);
      const rule = prefix >= 31 ? (prefix === 31 ? "A /31 is a point-to-point link: both addresses are usable (RFC 3021)."
        : "A /32 is a single host.") : `2^${32 - prefix} addresses, minus network and broadcast = ${n}.`;
      return { kind, input: "number", subject: { prefix }, answer: String(n),
        prompt: `How many usable host addresses does a /${prefix} have?`, explain: rule };
    }
    case "mask":
      return { kind, input: "ip", subject: { prefix }, answer: formatIp(maskOf(prefix)),
        prompt: `Write /${prefix} as a dotted subnet mask.`,
        explain: `${prefix} ones followed by ${32 - prefix} zeros, read as four octets.` };
    case "prefix": {
      const mask = maskOf(prefix);
      return { kind, input: "number", subject: { ip: mask }, answer: String(prefix),
        prompt: `Which prefix length is the mask ${formatIp(mask)}?`,
        explain: `Count the 1 bits in the mask: there are ${prefix}.` };
    }
    case "same": {
      if (prefix < 8) prefix = 8;
      const insideSpan = Math.min(2 ** (32 - prefix), 2 ** 20);
      const same = rng() < 0.5;
      let other = same ? (networkOf(ip, prefix) + int(rng, 0, insideSpan - 1)) >>> 0
        : (ip + (2 ** (32 - prefix)) * (rng() < 0.5 ? 1 : -1)) >>> 0;
      if (!same && sameSubnet(ip, other, prefix)) other = (other ^ (1 << (32 - prefix))) >>> 0;
      const answer = sameSubnet(ip, other, prefix) ? "yes" : "no";
      return { kind, input: "yesno", subject: { ip, prefix, other }, answer,
        prompt: `Are ${formatIp(ip)} and ${formatIp(other)} in the same /${prefix}?`,
        explain: `Same subnet only if the first ${prefix} bits match. Networks: ${formatIp(networkOf(ip, prefix))} and ${formatIp(networkOf(other, prefix))}.` };
    }
    case "fit": {
      const hosts = level <= 1 ? pick(rng, [2, 6, 14, 30, 50, 100, 250]) : int(rng, 2, level === 2 ? 1000 : 60000);
      const p = prefixForHosts(hosts);
      return { kind, input: "number", subject: {}, answer: String(p),
        prompt: `Smallest subnet (prefix length) that fits ${hosts} hosts?`,
        explain: p >= 30
          ? `/30 gives 2 usable hosts, the usual choice for a link between two routers (a /31 also works there, RFC 3021).`
          : `/${p} gives ${usableHosts(p)} usable hosts; /${p + 1} would give only ${usableHosts(p + 1)}.` };
    }
  }
}

/** Normalise a typed answer: "/24" -> "24", "Y" -> "yes", " 10.0.0.0 " -> "10.0.0.0". */
export function normalize(q: Question, raw: string): string {
  const v = raw.trim().toLowerCase();
  if (q.input === "yesno") return v.startsWith("y") ? "yes" : v.startsWith("n") ? "no" : v;
  if (q.input === "number") return v.replace(/^\//, "").replace(/[\s,]/g, "");
  const ip = parseIp(v);
  return ip === null ? v : formatIp(ip);
}

export const isCorrect = (q: Question, raw: string) => normalize(q, raw) === q.answer;

/** Picks the next question kind, favouring kinds the player gets wrong. */
export function nextKind(rng: Rng, misses: Partial<Record<Kind, number>>): Kind {
  const weights = KINDS.map((k) => 1 + 2 * (misses[k] ?? 0));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < KINDS.length; i++) {
    r -= weights[i];
    if (r < 0) return KINDS[i];
  }
  return KINDS[KINDS.length - 1];
}

export { prefixOfMask };
