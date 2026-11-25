import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bits, broadcastOf, firstHost, formatIp, lastHost, maskOf, networkOf, parseIp, prefixForHosts, prefixOfMask,
  sameSubnet, usableHosts,
} from "../src/net";
import { KINDS, isCorrect, makeQuestion, nextKind, normalize, seeded } from "../src/questions";

const ip = (s: string) => parseIp(s)!;

test("parse and format", () => {
  assert.equal(formatIp(ip("192.168.1.10")), "192.168.1.10");
  assert.equal(ip("255.255.255.255"), 4294967295);
  for (const bad of ["256.1.1.1", "1.2.3", "1.2.3.4.5", "a.b.c.d", "01234.1.1.1", ""]) assert.equal(parseIp(bad), null, bad);
});

test("masks and prefixes", () => {
  assert.equal(formatIp(maskOf(0)), "0.0.0.0");
  assert.equal(formatIp(maskOf(20)), "255.255.240.0");
  assert.equal(formatIp(maskOf(32)), "255.255.255.255");
  for (let p = 0; p <= 32; p++) assert.equal(prefixOfMask(maskOf(p)), p);
  assert.equal(prefixOfMask(ip("255.0.255.0")), null);
});

test("network, broadcast, hosts (classic textbook cases)", () => {
  assert.equal(formatIp(networkOf(ip("172.16.5.10"), 20)), "172.16.0.0");
  assert.equal(formatIp(broadcastOf(ip("172.16.5.10"), 20)), "172.16.15.255");
  assert.equal(formatIp(firstHost(ip("192.168.1.130"), 26)), "192.168.1.129");
  assert.equal(formatIp(lastHost(ip("192.168.1.130"), 26)), "192.168.1.190");
  assert.deepEqual([24, 30, 31, 32, 0].map(usableHosts), [254, 2, 2, 1, 4294967294]);
  assert.equal(formatIp(firstHost(ip("10.0.0.6"), 31)), "10.0.0.6");
});

test("right-sizing and same-subnet checks", () => {
  assert.deepEqual([1, 2, 3, 6, 7, 254, 255, 500].map(prefixForHosts), [32, 30, 29, 29, 28, 24, 23, 23]);
  assert.ok(sameSubnet(ip("10.1.2.3"), ip("10.1.200.9"), 16));
  assert.ok(!sameSubnet(ip("192.168.1.10"), ip("192.168.1.200"), 25));
  assert.equal(bits(ip("192.168.1.10")), "11000000101010000000000100001010");
});

test("every generated question accepts its own answer and rejects others", () => {
  const rng = seeded(42);
  for (let i = 0; i < 3000; i++) {
    const q = makeQuestion(KINDS[i % KINDS.length], rng, 1 + (i % 3));
    assert.ok(isCorrect(q, q.answer), `${q.prompt} -> ${q.answer}`);
    assert.ok(!isCorrect(q, q.input === "yesno" ? (q.answer === "yes" ? "no" : "yes") : "1.2.3.4x"), q.prompt);
    assert.ok(q.prompt.length > 10 && q.explain.length > 10);
  }
});

test("same-subnet questions are balanced and honest", () => {
  const rng = seeded(7);
  let yes = 0;
  for (let i = 0; i < 400; i++) {
    const q = makeQuestion("same", rng, 3);
    const { ip: a, other: b, prefix } = q.subject;
    assert.equal(q.answer, sameSubnet(a!, b!, prefix!) ? "yes" : "no");
    if (q.answer === "yes") yes++;
  }
  assert.ok(yes > 120 && yes < 280, `yes=${yes}`);
});

test("answer normalisation", () => {
  const q = makeQuestion("prefix", seeded(1), 2);
  assert.ok(isCorrect(q, `/${q.answer}`) && isCorrect(q, ` ${q.answer} `));
  const n = makeQuestion("network", seeded(2), 2);
  assert.equal(normalize(n, ` ${n.answer} `), n.answer);
  const y = makeQuestion("same", seeded(3), 2);
  assert.ok(isCorrect(y, y.answer === "yes" ? "Y" : "n"));
});

test("weak topics come up more often", () => {
  const rng = seeded(9);
  let hosts = 0;
  for (let i = 0; i < 2000; i++) if (nextKind(rng, { hosts: 10 }) === "hosts") hosts++;
  assert.ok(hosts > 1000, `hosts=${hosts}`); // weight 21 of 29
});
