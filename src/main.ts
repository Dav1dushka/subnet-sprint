/** Subnet Sprint: the game loop and screens. */
import { bits, formatIp, maskOf, parseIp } from "./net";
import { KIND_LABEL, type Kind, type Question, isCorrect, makeQuestion, nextKind } from "./questions";

type Mode = "sprint" | "practice";
interface Stats { asked: number; right: number; score: number; streak: number; bestStreak: number;
  perKind: Partial<Record<Kind, { asked: number; right: number }>>; misses: Partial<Record<Kind, number>> }

const SPRINT_SECONDS = 60;
const LEVELS = [{ id: 1, name: "Easy", hint: "/8, /16, /24" }, { id: 2, name: "Medium", hint: "/17 to /30" },
  { id: 3, name: "Hard", hint: "any prefix" }];

const app = document.getElementById("app")!;
const rng = Math.random;
let mode: Mode = "sprint";
let level = 1;
let stats: Stats;
let question: Question;
let answered = false;
let deadline = 0;
let tick = 0;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const storeKey = (lvl: number) => `subnet-sprint.best.${lvl}`;
function best(lvl: number): number {
  try { return Number(localStorage.getItem(storeKey(lvl)) ?? 0); } catch { return 0; }
}
function saveBest(lvl: number, score: number) {
  try { if (score > best(lvl)) localStorage.setItem(storeKey(lvl), String(score)); } catch { /* private mode */ }
}

/** 32 cells in four octets; network bits lit, host bits dim. */
function bitStrip(value: number, prefix: number | undefined, label: string, flash = false): string {
  const b = bits(value);
  const octets = [0, 1, 2, 3].map((o) => {
    const cells = [...b.slice(o * 8, o * 8 + 8)].map((bit, i) => {
      const idx = o * 8 + i;
      const cls = prefix === undefined ? "" : idx < prefix ? "net" : "host";
      return `<span class="bit ${cls}${bit === "1" ? " one" : ""}">${bit}</span>`;
    }).join("");
    return `<span class="octet"><span class="cells">${cells}</span><span class="dec">${(value >>> (24 - o * 8)) & 255}</span></span>`;
  }).join("");
  return `<div class="strip${flash ? " flash" : ""}" role="img" aria-label="${esc(label)} in binary"><span class="strip-label">${esc(label)}</span><div class="octets">${octets}</div></div>`;
}

// --- screens ---------------------------------------------------------------------

function startScreen() {
  clearInterval(tick);
  app.innerHTML = `
  <section class="start">
    <h1>Subnet <em>Sprint</em></h1>
    <p class="tag">Sixty seconds of subnetting. Network, broadcast, masks, host counts. Every mistake comes with the bits that explain it.</p>
    ${bitStrip(parseIp("192.168.1.130")!, 26, "192.168.1.130/26")}
    <div class="levels" role="radiogroup" aria-label="Difficulty">
      ${LEVELS.map((l) => `<button role="radio" aria-checked="${l.id === level}" class="level${l.id === level ? " on" : ""}" data-level="${l.id}">
        <b>${l.name}</b><span>${l.hint}</span><small>best ${best(l.id)}</small></button>`).join("")}
    </div>
    <div class="modes">
      <button class="go primary" data-mode="sprint">Sprint · 60 s <kbd>Enter</kbd></button>
      <button class="go" data-mode="practice">Practice, no timer</button>
    </div>
    <p class="how">Correct answers score 100 × your streak multiplier (up to ×3). A mistake shows the bits that explain it, and the clock keeps running while you read. Type IPs like <code>10.0.0.0</code>, prefixes as <code>24</code> or <code>/24</code>, and <kbd>Y</kbd>/<kbd>N</kbd> for yes-no questions.</p>
  </section>`;
  app.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((b) => b.addEventListener("click", () => {
    level = Number(b.dataset.level);
    startScreen();
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => begin(b.dataset.mode as Mode)));
  (app.querySelector(".go.primary") as HTMLButtonElement).focus();
}

function begin(m: Mode, focusKind?: Kind) {
  mode = m;
  stats = { asked: 0, right: 0, score: 0, streak: 0, bestStreak: 0, perKind: {}, misses: focusKind ? { [focusKind]: 6 } : {} };
  deadline = performance.now() + SPRINT_SECONDS * 1000;
  clearInterval(tick);
  if (mode === "sprint") tick = window.setInterval(updateTimer, 100);
  next();
}

function next() {
  question = makeQuestion(nextKind(rng, stats.misses), rng, level);
  answered = false;
  const q = question;
  const subject = q.subject.ip !== undefined
    ? bitStrip(q.subject.ip, q.kind === "prefix" ? undefined : q.subject.prefix, q.kind === "prefix" ? "mask" : `${formatIp(q.subject.ip)}${q.subject.prefix !== undefined ? "/" + q.subject.prefix : ""}`)
    : q.subject.prefix !== undefined ? bitStrip(maskOf(q.subject.prefix), q.subject.prefix, `/${q.subject.prefix} mask`) : "";
  const second = q.kind === "same" && q.subject.other !== undefined
    ? bitStrip(q.subject.other, q.subject.prefix, `${formatIp(q.subject.other)}/${q.subject.prefix}`) : "";
  const control = q.input === "yesno"
    ? `<div class="yn"><button class="answer-btn" data-a="yes">Yes <kbd>Y</kbd></button><button class="answer-btn" data-a="no">No <kbd>N</kbd></button></div>`
    : `<form class="answer" autocomplete="off"><input id="answer" inputmode="${q.input === "number" ? "numeric" : "decimal"}"
        placeholder="${q.input === "ip" ? "e.g. 192.168.1.0" : "number"}" aria-label="Your answer" spellcheck="false">
        <button class="go primary" type="submit">Check <kbd>Enter</kbd></button></form>`;
  app.innerHTML = `
  <section class="game">
    <header class="hud">
      <div class="timer" ${mode === "practice" ? "hidden" : ""}><span id="bar"></span></div>
      <span class="hud-item">Score <b id="score">${stats.score}</b></span>
      <span class="hud-item">Streak <b>${stats.streak}</b> <i>×${multiplier().toFixed(1)}</i></span>
      <span class="hud-item">${mode === "sprint" ? `<b id="secs">${secondsLeft()}</b> s` : `Question <b>${stats.asked + 1}</b>`}</span>
      <button class="quit" aria-label="Quit to menu">Esc</button>
    </header>
    <p class="kind">${KIND_LABEL[q.kind]}</p>
    <h2 class="prompt">${esc(q.prompt)}</h2>
    ${subject}${second}
    ${control}
    <div id="feedback" aria-live="polite"></div>
  </section>`;
  app.querySelector(".quit")!.addEventListener("click", finish);
  const form = app.querySelector<HTMLFormElement>("form.answer");
  if (form) {
    const input = form.querySelector("input")!;
    form.addEventListener("submit", (e) => { e.preventDefault(); if (input.value.trim()) submit(input.value); });
    input.focus();
  }
  app.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => b.addEventListener("click", () => submit(b.dataset.a!)));
  updateTimer();
}

const multiplier = () => Math.min(3, 1 + Math.floor(stats.streak / 3) * 0.5);
const secondsLeft = () => Math.max(0, Math.ceil((deadline - performance.now()) / 1000));

function submit(raw: string) {
  if (answered) return;
  answered = true;
  const q = question;
  const ok = isCorrect(q, raw);
  const k = (stats.perKind[q.kind] ??= { asked: 0, right: 0 });
  stats.asked++; k.asked++;
  const gained = ok ? Math.round(100 * multiplier()) + (level - 1) * 25 : 0;
  if (ok) {
    stats.right++; k.right++;
    stats.score += gained;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    stats.misses[q.kind] = Math.max(0, (stats.misses[q.kind] ?? 0) - 1);
  } else {
    stats.streak = 0;
    stats.misses[q.kind] = (stats.misses[q.kind] ?? 0) + 1;
  }
  app.querySelectorAll<HTMLInputElement | HTMLButtonElement>(".answer input, .answer button, .answer-btn").forEach((el) => (el.disabled = true));
  const answerIp = q.input === "ip" ? parseIp(q.answer) : null;
  const fb = app.querySelector("#feedback")!;
  fb.className = ok ? "right" : "wrong";
  fb.innerHTML = `
    <p class="verdict">${ok ? "Correct" : `Not quite: the answer is <code>${esc(q.answer)}</code>`}${ok ? ` <span>+${gained}</span>` : ""}</p>
    ${ok && mode === "sprint" ? "" : `<p class="explain">${esc(q.explain)}</p>${answerIp !== null ? bitStrip(answerIp, q.subject.prefix, q.answer, true) : ""}`}
    ${ok && mode === "sprint" ? "" : `<button class="go primary next">Next <kbd>Enter</kbd></button>`}`;
  (app.querySelector("#score") as HTMLElement).textContent = String(stats.score);
  if (ok && mode === "sprint") setTimeout(() => { if (secondsLeft() > 0) next(); }, 450);
  else (app.querySelector(".next") as HTMLButtonElement).addEventListener("click", next);
  (app.querySelector(".next") as HTMLButtonElement | null)?.focus();
}

function updateTimer() {
  if (mode !== "sprint") return;
  const left = deadline - performance.now();
  const bar = document.getElementById("bar");
  if (bar) bar.style.width = `${Math.max(0, (left / (SPRINT_SECONDS * 1000)) * 100)}%`;
  const secs = document.getElementById("secs");
  if (secs) secs.textContent = String(secondsLeft());
  if (left <= 0) finish();
}

function finish() {
  clearInterval(tick);
  if (!stats) return startScreen();
  if (mode === "sprint") saveBest(level, stats.score);
  const acc = stats.asked ? Math.round((stats.right / stats.asked) * 100) : 0;
  const kinds = (Object.entries(stats.perKind) as [Kind, { asked: number; right: number }][])
    .sort((a, b) => a[1].right / a[1].asked - b[1].right / b[1].asked);
  const weakest = kinds.find(([, v]) => v.right < v.asked)?.[0];
  const share = `Subnet Sprint (${LEVELS[level - 1].name}): ${stats.score} points, ${stats.right}/${stats.asked} correct, best streak ${stats.bestStreak}.`;
  app.innerHTML = `
  <section class="end">
    <p class="kind">${mode === "practice" ? "Practice summary" : secondsLeft() > 0 ? "Round ended early" : "Time!"}</p>
    <h1 class="big">${stats.score}</h1>
    <p class="tag">${stats.right} of ${stats.asked} correct (${acc}%) · best streak ${stats.bestStreak}${mode === "sprint" && stats.score >= best(level) && stats.score > 0 ? " · new best!" : ""}</p>
    <ul class="topics">${kinds.map(([kind, v]) => `<li><span>${KIND_LABEL[kind]}</span>
      <span class="track"><span style="width:${(v.right / v.asked) * 100}%"></span></span><b>${v.right}/${v.asked}</b></li>`).join("") || "<li>No answers yet.</li>"}</ul>
    <div class="modes">
      <button class="go primary" id="again">Play again <kbd>Enter</kbd></button>
      ${weakest ? `<button class="go" id="drill">Practise “${KIND_LABEL[weakest]}”</button>` : ""}
      <button class="go" id="share">Copy result</button>
      <button class="go" id="menu">Menu</button>
    </div>
  </section>`;
  app.querySelector("#again")!.addEventListener("click", () => begin(mode));
  app.querySelector("#menu")!.addEventListener("click", startScreen);
  app.querySelector("#drill")?.addEventListener("click", () => begin("practice", weakest));
  app.querySelector("#share")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(share + " " + location.href); b.textContent = "Copied"; }
    catch { b.textContent = share; }
  });
  (app.querySelector("#again") as HTMLButtonElement).focus();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && app.querySelector(".game")) { finish(); return; }
  const target = e.target as HTMLElement;
  if (question && !answered && question.input === "yesno" && app.querySelector(".game") && target.tagName !== "INPUT") {
    if (e.key.toLowerCase() === "y") submit("yes");
    if (e.key.toLowerCase() === "n") submit("no");
  }
});

startScreen();
