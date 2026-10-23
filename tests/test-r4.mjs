// Round 3 batch 2 (bugs 8-14) tests for Steady PWA. Usage: node test-r4.mjs [b8|b9|...|all]
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

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ---------------- Bug 8: week-clear undo is all-or-nothing ---------------- */
  if (run("b8")) {
    await test("r4.b8.weekclear-undo-blocked-by-protein-edit", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await buildViaUI(page, tw);
      const before = await mealCount(page, tw);
      assert(before > 0, "setup: built week should have meals");
      await clickEl(page, '[data-act="week-clear"]');
      await wait(250);
      assert((await mealCount(page, tw)) === 0, "setup: week cleared");
      await clickEl(page, '.protein-chip[data-id="salmon"]'); // edit proteins inside the undo window
      await wait(200);
      const pros = await page.evaluate((w) => (planCells(w).pro || []).slice(), tw);
      assert(pros.indexOf("salmon") >= 0, "setup: protein edit landed: " + JSON.stringify(pros));
      await clickEl(page, ".undo-toast button");
      await wait(300);
      const res = await page.evaluate((w) => {
        const t = document.querySelector(".info-toast");
        return { meals: planHasMeals(w), toast: t ? t.textContent : null };
      }, tw);
      assert(!res.meals, "undo after an edit must restore NOTHING (all-or-nothing), meals came back");
      assert(res.toast && /Nothing left to undo/.test(res.toast), "expected 'Nothing left to undo' info toast: " + JSON.stringify(res));
      await page.close();
    });
    await test("r4.b8.weekclear-undo-clean-restores-all", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await buildViaUI(page, tw);
      const before = await mealCount(page, tw);
      await clickEl(page, '[data-act="week-clear"]');
      await wait(250);
      await clickEl(page, ".undo-toast button");
      await wait(300);
      const after = await mealCount(page, tw);
      assert(after === before, "clean undo should restore all meals: before=" + before + " after=" + after);
      await page.close();
    });
  }

  /* ---------------- Bug 9: stale dialog history entry after refresh ---------------- */
  if (run("b9")) await test("r4.b9.stale-dlg-entry-consumed-on-load", async () => {
    const page = await freshPage(browser);
    await clickEl(page, '#bottomNav button[data-tab="plan"]');
    await wait(200);
    await clickEl(page, '#bottomNav button[data-tab="today"]');
    await wait(200);
    await page.click("#gearBtn");
    await page.waitForFunction(() => document.getElementById("settingsDlg").open, { timeout: 5000 });
    const dlgState = await page.evaluate(() => (history.state && history.state.dlg) || null);
    assert(dlgState === "settings", "setup: dialog history entry pushed, got " + dlgState);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    await wait(700); // boot fix (if present) fires history.back(); let popstate settle
    const st = await page.evaluate(() => ({ dlg: (history.state && history.state.dlg) || null, tab: ui.tab }));
    assert(!st.dlg, "after reload the current entry must not be a dialog entry: " + JSON.stringify(st));
    assert(st.tab === "today", "setup: should be on Today after reload, got " + st.tab);
    await page.evaluate(() => history.back());
    await wait(450);
    const tabAfter = await page.evaluate(() => ui.tab);
    assert(tabAfter === "plan", "first Back after reload must navigate (to Plan), stayed on: " + tabAfter);
    await page.close();
  });

  /* ---------------- Bug 10: Undone feedback across plan steps ---------------- */
  if (run("b10")) await test("r4.b10.undone-feedback-across-plan-steps", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    await page.evaluate(() => {
      const boxes = document.querySelectorAll('.shop-line input[type="checkbox"][data-id]');
      if (boxes.length < 2) throw new Error("need >=2 shop items");
      boxes[0].click(); boxes[1].click();
    });
    await wait(200);
    await clickEl(page, '[data-act="uncheck-all"]');
    await wait(250);
    const toastThere = await page.evaluate(() => !!document.querySelector(".undo-toast"));
    assert(toastThere, "setup: undo toast should be showing");
    await clickEl(page, '.step-btn[data-s="prep"]');
    await wait(250);
    const step = await page.evaluate(() => ui.planStep);
    assert(step === "prep", "setup: should be on Prep step, got " + step);
    await clickEl(page, ".undo-toast button");
    await wait(300);
    const toast = await page.evaluate(() => { const t = document.querySelector(".info-toast"); return t ? t.textContent : null; });
    assert(toast && /Undone ✓/.test(toast), "expected 'Undone ✓' feedback on the Prep step, got: " + toast);
    await page.close();
  });

  /* ---------------- Bug 11: workouts per week must be a whole number ---------------- */
  if (run("b11")) await test("r4.b11.workouts-must-be-whole", async () => {
    const page = await freshPage(browser);
    await page.click("#gearBtn");
    await page.waitForFunction(() => document.getElementById("settingsDlg").open, { timeout: 5000 });
    await page.evaluate(() => { document.getElementById("setWorkoutTarget").value = "4"; });
    await clickEl(page, "#setSave");
    await wait(250);
    let res = await page.evaluate(() => ({ open: document.getElementById("settingsDlg").open, wt: getSetting("workoutTarget") }));
    assert(res.wt === 4 && !res.open, "setup: valid save of 4 should land and close: " + JSON.stringify(res));
    await page.click("#gearBtn");
    await page.waitForFunction(() => document.getElementById("settingsDlg").open, { timeout: 5000 });
    await page.evaluate(() => { document.getElementById("setWorkoutTarget").value = "2.5"; });
    await clickEl(page, "#setSave");
    await wait(250);
    res = await page.evaluate(() => {
      const err = document.getElementById("setError");
      return { open: document.getElementById("settingsDlg").open, wt: getSetting("workoutTarget"), err: err.hidden ? "" : err.textContent };
    });
    assert(res.err === "Workouts per week must be a whole number.", "expected whole-number error, got: " + JSON.stringify(res));
    assert(res.open, "dialog must stay open on a non-whole workouts value");
    assert(res.wt === 4, "2.5 must NOT be saved (was silently rounded before), stored: " + res.wt);
    await page.evaluate(() => { document.getElementById("setWorkoutTarget").value = "3"; });
    await clickEl(page, "#setSave");
    await wait(250);
    res = await page.evaluate(() => ({ open: document.getElementById("settingsDlg").open, wt: getSetting("workoutTarget") }));
    assert(res.wt === 3 && !res.open, "whole number 3 should save and close: " + JSON.stringify(res));
    await page.close();
  });

  /* ---------------- Bug 12: toast reserves space at the bottom (360px) ---------------- */
  if (run("b12")) await test("r4.b12.toast-reserves-space", async () => {
    const page = await freshPage(browser, 360, 740);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    const padBase = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("main")).paddingBottom) || 0);
    await clickEl(page, '[data-act="uncheck-all"]');
    await wait(250);
    const m = await page.evaluate(() => {
      const toast = document.querySelector(".undo-toast");
      const main = document.getElementById("main");
      return { hasToast: !!toast, toastH: toast ? toast.offsetHeight : 0, pad: parseFloat(getComputedStyle(main).paddingBottom) || 0 };
    });
    assert(m.hasToast, "setup: toast should be mounted");
    assert(m.pad >= padBase + m.toastH + 16 - 1, "mounting a toast should ADD toast height + 16 (" + (m.toastH + 16) + ") to main's padding-bottom " + padBase + ", got " + m.pad);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await wait(200);
    const pos = await page.evaluate(() => {
      const toast = document.querySelector(".undo-toast");
      const btns = [...document.querySelectorAll('[data-act="plan-step"][data-s="prep"]')];
      const next = btns[btns.length - 1];
      return { btnBottom: next.getBoundingClientRect().bottom, toastTop: toast.getBoundingClientRect().top };
    });
    assert(pos.btnBottom <= pos.toastTop + 1, "Next button must sit above the toast when scrolled to bottom: " + JSON.stringify(pos));
    await page.evaluate(() => hideUndoToast());
    await wait(150);
    const padAfter = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("main")).paddingBottom) || 0);
    assert(padAfter === padBase, "padding must return to its base value when the toast hides, got " + padAfter + " (base " + padBase + ")");
    await page.close();
  });

  /* ---------------- Bug 13: combined lo+fresh flag ---------------- */
  if (run("b13")) await test("r4.b13.combined-flag", async () => {
    const page = await freshPage(browser);
    const info = await page.evaluate(() => {
      const meals = Object.values(PLAN_DATA.MEALS);
      const both = meals.find((mm) => mm.s.indexOf("L") >= 0 && mm.lo && mm.fresh);
      const loOnly = meals.find((mm) => mm.s.indexOf("L") >= 0 && mm.lo && !mm.fresh && mm.id !== both.id);
      return { both: { id: both.id, p: both.p }, loOnly: { id: loOnly.id, p: loOnly.p } };
    });
    const { tw } = await weeks(page);
    await seed(page, tw, { pro: [...new Set([info.both.p, info.loOnly.p])] });
    await gotoPlan(page, tw, "week");
    await page.evaluate(() => openMealPicker("m3L"));
    await page.waitForSelector('.mp-opt[data-id="' + info.both.id + '"]', { timeout: 5000 });
    const res = await page.evaluate((ids) => {
      const out = {};
      for (const key of ["both", "loOnly"]) {
        const row = document.querySelector('.mp-opt[data-id="' + ids[key] + '"]');
        out[key] = row ? [...row.querySelectorAll(".mp-flag")].map((f) => f.textContent) : null;
      }
      return out;
    }, { both: info.both.id, loOnly: info.loOnly.id });
    assert(res.both && res.both.length === 1 && res.both[0] === "cook fresh, leftovers OK",
      "lo+fresh meal must show ONE combined flag, got: " + JSON.stringify(res.both));
    assert(res.loOnly && res.loOnly.length === 1 && res.loOnly[0] === "leftovers OK",
      "lo-only meal must keep its single flag, got: " + JSON.stringify(res.loOnly));
    await page.close();
  });

  /* ---------------- Bug 14: Copy unticked only must not invoke share ---------------- */
  if (run("b14")) await test("r4.b14.copy-unticked-never-shares", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    const probe = await page.evaluate(() => {
      window.__shareCalls = [];
      window.__clip = null;
      Object.defineProperty(navigator, "share", { configurable: true, value: function (d) { window.__shareCalls.push(d); return Promise.resolve(); } });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: function (t) { window.__clip = t; return Promise.resolve(); } } });
      return navigator.clipboard.writeText("probe").then(() => window.__clip === "probe");
    });
    assert(probe, "setup: clipboard stub must work");
    const names = await page.evaluate(() => {
      const lines = [...document.querySelectorAll(".shop-line")].filter((l) => l.querySelector('input[type="checkbox"][data-id]'));
      if (lines.length < 2) throw new Error("need >=2 shop lines");
      const name = (l) => l.querySelector(".nm").textContent.trim();
      lines[0].querySelector('input[type="checkbox"]').click();
      return { ticked: name(lines[0]), unticked: name(lines[1]) };
    });
    await wait(200);
    await clickEl(page, '[data-act="share-shop-unticked"]');
    await wait(350);
    const res = await page.evaluate(() => ({ shares: window.__shareCalls.length, clip: window.__clip }));
    assert(res.shares === 0, "navigator.share must NOT be called by Copy unticked only, calls: " + res.shares);
    assert(typeof res.clip === "string" && res.clip.length > 0, "clipboard should receive the list");
    assert(res.clip.indexOf(names.unticked) >= 0, "clipboard should include unticked item '" + names.unticked + "'");
    assert(res.clip.indexOf("• " + names.ticked) < 0 && res.clip.indexOf("✓ " + names.ticked) < 0,
      "clipboard must exclude ticked item '" + names.ticked + "'");
    await page.close();
  });
} finally {
  await browser.close();
}
console.log("\n==== R4 suite (" + filter + ", width " + DW + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
