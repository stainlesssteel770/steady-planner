import fs from "node:fs";
import { launch, seed, planWeekCells, weekKeys, C, sleep, makeReporter } from "./r2help.mjs";
const { check, done } = makeReporter();
const { nextSun } = weekKeys();
const PRO = C(["chicken", "salmon", "yogurt", "eggs"]);
const uiShop = { tab: "plan", planStep: "shop", planWs: nextSun };
const uiWeek = { tab: "plan", planStep: "week", planWs: nextSun };
const uiPro = { tab: "plan", planStep: "pro", planWs: nextSun };

const { browser, page } = await launch(390);
const dialogs = [];
page.on("dialog", async d => { dialogs.push(d.message()); await d.accept(); });
await page.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0" });
await sleep(500);

const shopState = () => page.evaluate(() => [...document.querySelectorAll(".shop-line")].slice(0, 4).map(l => {
  const cb = l.querySelector('input[type="checkbox"]');
  const nm = l.querySelector(".nm");
  return { id: cb ? (cb.getAttribute("data-id") || cb.getAttribute("data-cid")) : null, checked: cb ? cb.checked : null, name: nm ? nm.textContent : "" };
}));
const tickRow = i => page.evaluate(idx => {
  const line = document.querySelectorAll(".shop-line")[idx];
  (line.querySelector(".nm") || line).click();
}, i);

// ---------- Bug 7: surgical undo (uncheck all) ----------
await seed(page, { [nextSun]: { f: { pro: PRO, m0D: C({ id: "c1" }), m1D: C({ id: "sa1" }), m2D: C({ id: "c4" }) } } }, uiShop);
await tickRow(0); await sleep(300);
await tickRow(1); await sleep(300);
let st = await shopState();
check("setup: two items ticked", st[0].checked && st[1].checked, JSON.stringify(st.map(x => x.checked)));
await page.click('button[data-act="uncheck-all"]'); await sleep(300);
st = await shopState();
check("uncheck-all unticks both", !st[0].checked && !st[1].checked, JSON.stringify(st.map(x => x.checked)));
const toastUp = await page.evaluate(() => !!document.querySelector(".undo-toast"));
check("undo toast shows", toastUp);
await tickRow(2); await sleep(300);
st = await shopState();
check("during window: a different item ticked", st[2].checked, JSON.stringify(st.map(x => x.checked)));
await page.evaluate(() => document.querySelector(".undo-toast button").click()); await sleep(400);
st = await shopState();
check("Bug7 undo restores the unchecked items", st[0].checked && st[1].checked, JSON.stringify(st.map(x => x.checked)));
check("Bug7 undo keeps the item ticked during the window", st[2].checked, JSON.stringify(st.map(x => x.checked)));

// also: edit an AFFECTED key during the window -> undo must not revert it
await page.click('button[data-act="uncheck-all"]'); await sleep(300);
await tickRow(0); await sleep(300); // re-tick item 0 (an affected key) during the window
await page.evaluate(() => document.querySelector(".undo-toast button").click()); await sleep(400);
st = await shopState();
check("Bug7 edited affected key keeps its new value", st[0].checked === true, JSON.stringify(st.map(x => x.checked)));
check("Bug7 untouched affected key restored", st[1].checked === true, JSON.stringify(st.map(x => x.checked)));

// ---------- Add 1: restore cleared week ----------
await seed(page, { [nextSun]: { f: { pro: PRO, m0D: C({ id: "c1" }), m1D: C({ id: "sa1" }) } } }, uiWeek);
const cardsBefore = await page.evaluate(() => document.querySelectorAll(".meal-card").length);
check("setup: week has meal cards", cardsBefore >= 2, "cards=" + cardsBefore);
await page.click('button[data-act="week-clear"]'); await sleep(400);
let cells = await planWeekCells(page, nextSun);
check("week cleared (no meal cells)", !Object.keys(cells).some(k => /^m\d[LD]$/.test(k)), Object.keys(cells).join(","));
const lc = await page.evaluate(() => JSON.parse(localStorage.getItem("steady.lastCleared") || "null"));
check("Add1 steady.lastCleared (per-week map) persisted", !!lc && !!lc[nextSun] && !!lc[nextSun].doc && !!lc[nextSun].doc.f, lc ? Object.keys(lc).join(",") : "null");
// dismiss toast via tab change, then go to Proteins
await page.click('#bottomNav button[data-tab="today"]'); await sleep(300);
await page.click('#bottomNav button[data-tab="plan"]'); await sleep(400);
const onPro = await page.evaluate(() => {
  const stepBtn = document.querySelector(".step-btn.on");
  if (!stepBtn || !/Proteins/.test(stepBtn.textContent)) { const b = [...document.querySelectorAll(".step-btn")].find(x => /Proteins/.test(x.textContent)); if (b) b.click(); }
  return true;
});
await sleep(400);
const hasRestore = await page.evaluate(() => !!document.querySelector('button[data-act="restore-cleared"]'));
check("Add1 'Restore last week's plan' shows on Proteins", hasRestore);
check("Add1 'Restore last week's plan' shows on Proteins", hasRestore);
// DOM click (not a puppeteer coordinate click): the Restore button only
// renders after a re-render. Per Tab's adjudication (issue #1): scroll it
// into view first — below the fold on a scrolling page is normal — wait one
// frame, then run the guard: it must be visible and hit-testable —
// what document.elementFromPoint at its center returns (or a child of it).
// "covered" still fails even after scrolling (that would be a real bug).
// Measurement: button top vs innerHeight BEFORE scrolling, so the report
// can say where the control renders right after Clear.
const restoreRes = await page.evaluate(async () => {
  const b = document.querySelector('button[data-act="restore-cleared"]');
  if (!b) return { res: "missing", measure: "none" };
  const r0 = b.getBoundingClientRect();
  const measure = "width=" + innerWidth + " preScrollTop=" + Math.round(r0.top) + " innerHeight=" + innerHeight;
  b.scrollIntoView({ block: "center" });
  await new Promise(r => requestAnimationFrame(r));
  const r = b.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { res: "invisible", measure };
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  if (el !== b && !b.contains(el)) return { res: "covered:" + (el ? el.tagName : "none"), measure };
  b.click();
  return { res: "ok", measure };
});
check("Add1 Restore button visible + hit-testable", restoreRes.res === "ok", restoreRes.res + " [" + restoreRes.measure + "]");
// Tab (issue #1): also write the measurement to the CI step summary so it is
// readable on the run page without admin log access.
{ const ghs = process.env.GITHUB_STEP_SUMMARY; if (ghs) { try { fs.appendFileSync(ghs, "[restore-measure] r2b.add1 " + restoreRes.measure + "\n"); } catch (e) {} } }
await sleep(400);
cells = await planWeekCells(page, nextSun);
const cardsAfter = await page.evaluate(() => document.querySelectorAll(".meal-card").length);
check("Add1 restore brings meals back", Object.keys(cells).some(k => /^m\d[LD]$/.test(k)) && cardsAfter >= 2, "cells=" + Object.keys(cells).filter(k => /^m/.test(k)).join(",") + " cards=" + cardsAfter);
const lcGone = await page.evaluate(() => localStorage.getItem("steady.lastCleared"));
check("Add1 lastCleared removed after restore", lcGone === null);

// ---------- Add 3: copy unticked only ----------
await seed(page, { [nextSun]: { f: { pro: PRO, m0D: C({ id: "c1" }), m1D: C({ id: "sa1" }), m2D: C({ id: "c4" }) } } }, uiShop);
await page.evaluate(() => {
  window.__clip = null;
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } });
});
await tickRow(0); await sleep(300);
st = await shopState();
const tickedName = st[0].name, untickedName = st[1].name;
await page.click('button[data-act="share-shop-unticked"]'); await sleep(400);
const clip = await page.evaluate(() => window.__clip);
check("Add3 unticked copy excludes the ticked item", typeof clip === "string" && !clip.includes(tickedName), "ticked=" + tickedName);
check("Add3 unticked copy includes an unticked item", typeof clip === "string" && clip.includes(untickedName), "unticked=" + untickedName);

// ---------- Bug 11a: pluralization (exactly 1 bad value) ----------
fs.writeFileSync("/tmp/testbed/one-bad.json", JSON.stringify({ settings: { f: { stepGoal: { v: 5, ts: 1 } } }, days: {}, plans: {} }));
dialogs.length = 0;
await page.click("#gearBtn"); await sleep(300);
const input = await page.$("#restoreInput");
await input.uploadFile("/tmp/testbed/one-bad.json");
await sleep(600);
check("Bug11a alert says '1 bad value was ignored.'", dialogs.some(m => /1 bad value was ignored\./.test(m)), JSON.stringify(dialogs));

// ---------- Bug 11b: settings inline error ----------
await page.evaluate(() => { localStorage.setItem("steady.ui", JSON.stringify({ tab: "today" })); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(400);
await page.click("#gearBtn"); await sleep(400);
await page.evaluate(() => { const i = document.getElementById("setStepGoal"); i.value = "500"; });
await page.click("#setSave"); await sleep(300);
const setRes = await page.evaluate(() => {
  const e = document.getElementById("setError");
  const st = JSON.parse(localStorage.getItem("steady.state"));
  const sg = st.settings && st.settings.f && st.settings.f.stepGoal ? st.settings.f.stepGoal.v : null;
  return { open: document.getElementById("settingsDlg").open, errVisible: !!e && !e.hidden, errText: e ? e.textContent : "", sg };
});
check("Bug11b settings error shows", setRes.errVisible && /Step goal must be between/.test(setRes.errText), setRes.errText);
check("Bug11b dialog stays open on error", setRes.open === true);
check("Bug11b invalid step goal not saved", setRes.sg !== 500, "sg=" + setRes.sg);
await page.evaluate(() => { const i = document.getElementById("setStepGoal"); i.value = "8000"; });
await page.click("#setSave"); await sleep(300);
const setRes2 = await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem("steady.state"));
  return { open: document.getElementById("settingsDlg").open, sg: st.settings.f.stepGoal ? st.settings.f.stepGoal.v : null };
});
check("Bug11b valid save works + dialog closes", setRes2.sg === 8000 && setRes2.open === false, JSON.stringify(setRes2));

await browser.close();
process.exit(done("R2 suite B (390px)") ? 1 : 0);
