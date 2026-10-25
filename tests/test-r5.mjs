// Round 3 batch 3 (ADDs 1-3) tests for Steady PWA. Usage: node test-r5.mjs [add1|add2|add3|all]
// WIDTH env overrides the default viewport width for tests that don't pin one.
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/home/hatch/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome";
const URL = "http://localhost:8899/steady-planner/";
const DW = parseInt(process.env.WIDTH || "390", 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "  — " + e.message); }
}

async function freshPage(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width: width || DW, height: height || 844 });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await wait(350);
  return page;
}
const weeks = (page) => page.evaluate(() => { const tw = weekSunday(todayStr); return { tw, nw: addDays(tw, 7) }; });
const seed = (page, week, cells) => page.evaluate((week, cells) => {
  state.plans[week] = { f: {} };
  Object.keys(cells).forEach((k) => { state.plans[week].f[k] = { v: cells[k], ts: 1000 }; });
  saveLocal();
}, week, cells);
const gotoPlan = (page, week, step) => page.evaluate((week, step) => {
  ui.tab = "plan"; ui.planWs = week; ui.planStep = step; saveUi(); render(true);
}, week, step);
async function buildViaUI(page, week) {
  await gotoPlan(page, week, "pro");
  const clickSel = async (sel) => {
    await page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error("missing " + s); el.click(); }, sel);
    await wait(150);
  };
  await clickSel('.protein-chip[data-id="chicken"]');
  await clickSel('.protein-chip[data-id="eggs"]');
  await clickSel('[data-act="build"]');
  await wait(250);
}
const clickEl = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error("missing " + s); el.click(); }, sel);
const mealCount = (page, week) => page.evaluate((w) => Object.keys(planCells(w)).filter((k) => /^m\d[LD]$/.test(k)).length, week);
const cellVal = (page, week, key) => page.evaluate((w, k) => planCells(w)[k] || null, week, key);

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ---------------- ADD 1: undo toast after a picker pick / clear ---------------- */
  if (run("add1")) {
    await test("r5.add1.pick-undo-restores-slot", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt", "eggs"] });
      await gotoPlan(page, nw, "week");
      await page.evaluate(() => openMealPicker("m2D"));
      await page.waitForSelector(".mp-opt[data-id]", { timeout: 5000 });
      const pickId = await page.evaluate(() => document.querySelector(".mp-opt[data-id]").getAttribute("data-id"));
      await page.click('.mp-opt[data-id="' + pickId + '"]');
      await wait(300);
      const mid = await page.evaluate((w) => {
        const t = document.querySelector(".undo-toast");
        return { cell: planCells(w).m2D || null, toast: t ? t.textContent : null, day: PLAN_ENGINE.DAYN[2] };
      }, nw);
      assert(mid.cell && mid.cell.id === pickId, "setup: pick should land: " + JSON.stringify(mid));
      assert(mid.toast && mid.toast.indexOf("Changed " + mid.day + " dinner.") === 0, "undo toast text expected, got: " + JSON.stringify(mid.toast));
      await clickEl(page, ".undo-toast button");
      await wait(300);
      const after = await cellVal(page, nw, "m2D");
      assert(!after || !after.id, "undo should empty the slot again, got: " + JSON.stringify(after));
      await page.close();
    });

    await test("r5.add1.clear-undo-restores-meal", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      const info = await page.evaluate(() => {
        const m = Object.values(PLAN_DATA.MEALS).find((mm) => mm.s.indexOf("L") >= 0);
        return { id: m.id, p: m.p };
      });
      await seed(page, nw, { pro: [info.p, "eggs"], m3L: { id: info.id } });
      await gotoPlan(page, nw, "week");
      await page.evaluate(() => openMealPicker("m3L"));
      await page.waitForSelector('[data-act="mp-clear"]', { timeout: 5000 });
      await page.click('[data-act="mp-clear"]');
      await wait(300);
      const mid = await page.evaluate((w) => {
        const t = document.querySelector(".undo-toast");
        return { cell: planCells(w).m3L || null, toast: t ? t.textContent : null, day: PLAN_ENGINE.DAYN[3] };
      }, nw);
      assert(!mid.cell || !mid.cell.id, "setup: clear should empty the slot: " + JSON.stringify(mid));
      assert(mid.toast && mid.toast.indexOf("Changed " + mid.day + " lunch.") === 0, "undo toast text expected, got: " + JSON.stringify(mid.toast));
      await clickEl(page, ".undo-toast button");
      await wait(300);
      const after = await cellVal(page, nw, "m3L");
      assert(after && after.id === info.id, "undo should restore the cleared meal, got: " + JSON.stringify(after));
      await page.close();
    });

    await test("r5.add1.pick-undo-reverts-knockon-lunch", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      const ids = await page.evaluate(() => {
        const meals = Object.values(PLAN_DATA.MEALS);
        const loD = meals.find((mm) => mm.s.indexOf("D") >= 0 && mm.lo);
        const nonLoD = meals.find((mm) => mm.s.indexOf("D") >= 0 && !mm.lo && mm.id !== loD.id);
        return { loD: loD.id, loP: loD.p, nonLoD: nonLoD.id, nonLoP: nonLoD.p };
      });
      await seed(page, nw, { pro: [...new Set([ids.loP, ids.nonLoP, "eggs"])], m1D: { id: ids.loD }, m2L: { lo: 1 } });
      await gotoPlan(page, nw, "week");
      await page.evaluate(() => openMealPicker("m1D"));
      await page.waitForSelector('.mp-opt[data-id="' + ids.nonLoD + '"]', { timeout: 5000 });
      await page.click('.mp-opt[data-id="' + ids.nonLoD + '"]');
      await wait(350);
      const mid = await page.evaluate((w) => {
        const c = planCells(w);
        const t = document.querySelector(".undo-toast");
        return { d: c.m1D || null, l: c.m2L || null, toast: t ? t.textContent : null, day: PLAN_ENGINE.DAYN[1] };
      }, nw);
      assert(mid.d && mid.d.id === ids.nonLoD, "setup: dinner pick should land: " + JSON.stringify(mid));
      assert(!(mid.l && mid.l.lo === 1 && !mid.l.id), "setup: lo lunch should have been replaced/cleared by the knock-on: " + JSON.stringify(mid.l));
      assert(mid.toast && mid.toast.indexOf("Changed " + mid.day + " dinner.") === 0, "undo toast expected, got: " + JSON.stringify(mid.toast));
      await clickEl(page, ".undo-toast button");
      await wait(300);
      const after = await page.evaluate((w) => { const c = planCells(w); return { d: c.m1D || null, l: c.m2L || null }; }, nw);
      assert(after.d && after.d.id === ids.loD, "undo should restore the original dinner: " + JSON.stringify(after));
      assert(after.l && after.l.lo === 1 && !after.l.id, "undo should restore tomorrow's leftovers lunch: " + JSON.stringify(after));
      await page.close();
    });

    await test("r5.add1.toast-notes-knockon", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      const ids = await page.evaluate(() => {
        const meals = Object.values(PLAN_DATA.MEALS);
        const loD = meals.find((mm) => mm.s.indexOf("D") >= 0 && mm.lo);
        const nonLoD = meals.find((mm) => mm.s.indexOf("D") >= 0 && !mm.lo && mm.id !== loD.id);
        return { loD: loD.id, loP: loD.p, nonLoD: nonLoD.id, nonLoP: nonLoD.p };
      });
      await seed(page, nw, { pro: [...new Set([ids.loP, ids.nonLoP, "eggs"])], m1D: { id: ids.loD }, m2L: { lo: 1 } });
      await gotoPlan(page, nw, "week");
      await page.evaluate(() => openMealPicker("m1D"));
      await page.waitForSelector('.mp-opt[data-id="' + ids.nonLoD + '"]', { timeout: 5000 });
      await page.click('.mp-opt[data-id="' + ids.nonLoD + '"]');
      await wait(350);
      const res = await page.evaluate((w) => {
        const t = document.querySelector(".undo-toast");
        const c = planCells(w);
        return {
          span: t ? t.querySelector("span").textContent : null,
          btn: t ? !!t.querySelector("button") : false,
          l: c.m2L || null,
          want: "Changed " + PLAN_ENGINE.DAYN[1] + " dinner. " + PLAN_ENGINE.DAYN[2] + "'s lunch updated too."
        };
      }, nw);
      assert(!(res.l && res.l.lo === 1 && !res.l.id), "setup: lo lunch should have been replaced/cleared by the knock-on: " + JSON.stringify(res.l));
      assert(res.span === res.want, "toast should note the knock-on lunch change: got " + JSON.stringify(res.span) + " want " + JSON.stringify(res.want));
      assert(res.btn, "toast should have an Undo button");
      await page.close();
    });

    await test("r5.add1.toast-plain-when-no-knockon", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt", "eggs"] });
      await gotoPlan(page, nw, "week");
      await page.evaluate(() => openMealPicker("m2D"));
      await page.waitForSelector(".mp-opt[data-id]", { timeout: 5000 });
      const pickId = await page.evaluate(() => document.querySelector(".mp-opt[data-id]").getAttribute("data-id"));
      await page.click('.mp-opt[data-id="' + pickId + '"]');
      await wait(300);
      const res = await page.evaluate(() => {
        const t = document.querySelector(".undo-toast");
        return { span: t ? t.querySelector("span").textContent : null, want: "Changed " + PLAN_ENGINE.DAYN[2] + " dinner." };
      });
      assert(res.span === res.want, "plain dinner pick toast should be the single sentence: got " + JSON.stringify(res.span) + " want " + JSON.stringify(res.want));
      await page.close();
    });

    await test("r5.add1.no-change-no-toast", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      const info = await page.evaluate(() => {
        const m = Object.values(PLAN_DATA.MEALS).find((mm) => mm.s.indexOf("L") >= 0);
        return { id: m.id, p: m.p };
      });
      await seed(page, nw, { pro: [info.p, "eggs"], m3L: { id: info.id } });
      await gotoPlan(page, nw, "week");
      await page.evaluate(() => openMealPicker("m3L"));
      await page.waitForSelector('.mp-opt[data-id="' + info.id + '"]', { timeout: 5000 });
      await page.click('.mp-opt[data-id="' + info.id + '"]');
      await wait(400);
      const res = await page.evaluate((w) => ({ toast: !!document.querySelector(".undo-toast"), cell: planCells(w).m3L || null }), nw);
      assert(!res.toast, "re-picking the same meal must not show an undo toast");
      assert(res.cell && res.cell.id === info.id, "cell should be unchanged: " + JSON.stringify(res));
      await page.close();
    });
  }

  /* ---------------- ADD 2: one parked plan per week + migration + Week-step restore ---------------- */
  if (run("add2")) {
    await test("r5.add2.migration-keeps-legacy-park", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      const doc = await page.evaluate((w) => {
        const d = Object.values(PLAN_DATA.MEALS).find((mm) => mm.s.indexOf("D") >= 0);
        state.plans[w] = { f: { pro: { v: [d.p, "eggs"], ts: 1 }, m0D: { v: { id: d.id }, ts: 1 }, m1D: { v: { id: d.id }, ts: 1 } } };
        const snap = JSON.parse(JSON.stringify(state.plans[w]));
        delete state.plans[w]; saveLocal();
        return snap;
      }, nw);
      await page.evaluate((w, dc) => { localStorage.setItem("steady.lastCleared", JSON.stringify({ week: w, doc: dc, at: Date.now() })); }, nw, doc);
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
      await wait(350);
      await gotoPlan(page, nw, "pro");
      await page.waitForSelector('[data-act="restore-cleared"]', { timeout: 5000 });
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("steady.lastCleared")));
      assert(stored && !stored.week && stored[nw] && stored[nw].doc && stored[nw].doc.f,
        "stored value should be migrated to a per-week map: " + JSON.stringify(stored).slice(0, 140));
      await clickEl(page, '[data-act="restore-cleared"]');
      await wait(300);
      const n = await mealCount(page, nw);
      assert(n === 2, "legacy parked plan should restore after migration, meals=" + n);
      await page.close();
    });

    await test("r5.add2.two-weeks-parked-independently", async () => {
      const page = await freshPage(browser);
      // Saturday pin: a fresh Saturday build yields no meals, so week-clear
      // never renders. Wed 2026-10-21 keeps the same current week, days ahead.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      const { tw, nw } = await weeks(page);
      await buildViaUI(page, tw);
      await clickEl(page, '[data-act="week-clear"]');
      await wait(300);
      await buildViaUI(page, nw);
      await clickEl(page, '[data-act="week-clear"]');
      await wait(300);
      let map = await page.evaluate(() => JSON.parse(localStorage.getItem("steady.lastCleared") || "{}"));
      assert(map[tw] && map[tw].doc && map[nw] && map[nw].doc, "both weeks should be parked: keys=" + Object.keys(map).join(","));
      await buildViaUI(page, tw); // building this week drops only its own park
      map = await page.evaluate(() => JSON.parse(localStorage.getItem("steady.lastCleared") || "{}"));
      assert(!map[tw] && map[nw] && map[nw].doc, "building this week must drop only its park: keys=" + Object.keys(map).join(","));
      await gotoPlan(page, nw, "pro");
      await page.waitForSelector('[data-act="restore-cleared"]', { timeout: 5000 });
      await clickEl(page, '[data-act="restore-cleared"]');
      await wait(300);
      const n = await mealCount(page, nw);
      assert(n > 0, "next week's parked plan should still restore, meals=" + n);
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });

    await test("r5.add2.restore-offered-on-week-step", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await buildViaUI(page, nw);
      const before = await mealCount(page, nw);
      assert(before > 0, "setup: built week should have meals");
      await clickEl(page, '[data-act="week-clear"]');
      await wait(300);
      assert((await mealCount(page, nw)) === 0, "setup: week cleared");
      await gotoPlan(page, nw, "week");
      await page.waitForSelector('[data-act="restore-cleared"]', { timeout: 5000 });
      await clickEl(page, '[data-act="restore-cleared"]');
      await wait(300);
      const after = await mealCount(page, nw);
      assert(after === before, "restore from the Week step should bring the meals back: before=" + before + " after=" + after);
      await page.close();
    });
  }

  /* ---------------- ADD 3: a built week opens on its Week step when switching ---------------- */
  if (run("add3")) {
    await test("r5.add3.built-week-opens-on-week-step", async () => {
      const page = await freshPage(browser);
      // Saturday pin, same reason as add2: a meal-less Saturday build never
      // opens its Week step.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      const { tw, nw } = await weeks(page);
      await buildViaUI(page, tw);
      await clickEl(page, '[data-act="plan-week"][data-w="' + nw + '"]');
      await wait(250);
      let step = await page.evaluate(() => ui.planStep);
      assert(step === "pro", "empty next week should open on Proteins (existing behaviour), got: " + step);
      await clickEl(page, '[data-act="plan-week"][data-w="' + tw + '"]');
      await wait(250);
      const res = await page.evaluate(() => ({ step: ui.planStep, cards: document.querySelectorAll(".meal-card").length }));
      assert(res.step === "week", "switching to a built week should open its Week step, got: " + res.step);
      assert(res.cards > 0, "week step should show meal cards, got: " + res.cards);
      await clickEl(page, '.step-btn[data-s="shop"]');
      await wait(250);
      await clickEl(page, '[data-act="plan-week"][data-w="' + tw + '"]'); // re-tap the current week
      await wait(250);
      step = await page.evaluate(() => ui.planStep);
      assert(step === "shop", "re-tapping the current week must not change the step, got: " + step);
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("\n==== R5 suite (" + filter + ", width " + DW + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
