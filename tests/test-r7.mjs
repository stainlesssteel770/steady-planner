// Batch 2 tests for Steady PWA. Usage: node test-r7.mjs [seterr|toast|locked|undone|all]
// WIDTH env overrides the default viewport width.
import puppeteer from "puppeteer-core";

const CHROME = "/home/hatch/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome";
const URL = "http://localhost:8899/steady-planner/";
const DW = parseInt(process.env.WIDTH || "390", 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "  — " + e.message); }
}

async function freshPage(browser, width) {
  const page = await browser.newPage();
  page.__errs = [];
  page.on("pageerror", (e) => page.__errs.push(e.message));
  await page.setViewport({ width: width || DW, height: 844 });
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

async function settingsErrorRects(page, sg, wt) {
  await page.evaluate(() => openSettings());
  await wait(250);
  await page.evaluate((sg, wt) => {
    if (sg !== null) document.getElementById("setStepGoal").value = sg;
    if (wt !== null) document.getElementById("setWorkoutTarget").value = wt;
  }, sg, wt);
  await page.click("#setSave");
  await wait(300);
  return page.evaluate(() => {
    const err = document.getElementById("setError");
    const act = document.querySelector(".dlg-actions");
    const er = err.getBoundingClientRect(), ar = act.getBoundingClientRect();
    return { hidden: err.hidden, text: err.textContent, errBottom: er.bottom, errTop: er.top, actTop: ar.top, dlgOpen: document.getElementById("settingsDlg").open };
  });
}

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ---------- Item 1: #setError must sit fully above the sticky footer ---------- */
  if (run("seterr")) {
    await test("r7.seterr.workouts-2.5-visible", async () => {
      const page = await freshPage(browser);
      const r = await settingsErrorRects(page, null, "2.5");
      assert(r.dlgOpen, "dialog should stay open on invalid save");
      assert(!r.hidden && /whole number/.test(r.text), "expected the whole-number error, got: " + JSON.stringify(r));
      assert(r.errBottom <= r.actTop + 1, "error bottom " + Math.round(r.errBottom) + " is under the footer top " + Math.round(r.actTop));
      await page.close();
    });
    await test("r7.seterr.stepgoal-500-visible", async () => {
      const page = await freshPage(browser);
      const r = await settingsErrorRects(page, "500", null);
      assert(r.dlgOpen, "dialog should stay open on invalid save");
      assert(!r.hidden && /Step goal/.test(r.text), "expected the step-goal error, got: " + JSON.stringify(r));
      assert(r.errBottom <= r.actTop + 1, "error bottom " + Math.round(r.errBottom) + " is under the footer top " + Math.round(r.actTop));
      await page.close();
    });
  }

  /* ---------- Item 2: toast mounted at page end must not cover the Next button ---------- */
  if (run("toast")) {
    await test("r7.toast.at-end-next-button-clear", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      const cells = { pro: ["chicken", "salmon", "yogurt", "eggs"], g_chicken: true };
      ["c1", "e3", "c4", "y3", "c5", "sa1", "c7", "e6", "c8", "y5", "c2", "sa3"].forEach((id, i) => {
        cells["m" + Math.floor(i / 2) + (i % 2 ? "D" : "L")] = { id };
      });
      await seed(page, nw, cells);
      await gotoPlan(page, nw, "shop");
      await wait(250);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await wait(200);
      // The shop step's own Undo toast: Uncheck all sits in the same final
      // card as the "Next: prep day" button.
      await page.click('[data-act="uncheck-all"]');
      await wait(250);
      const m = await page.evaluate(() => {
        const t = document.querySelector(".undo-toast");
        const all = document.querySelectorAll('[data-act="plan-step"][data-s="prep"]');
        const b = all[all.length - 1]; // the bottom "Next: prep day", not the step-tab
        if (!t || !b) return { missing: !t ? "toast" : "button" };
        const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect();
        return { overlap: br.bottom > tr.top + 1 && br.top < tr.bottom - 1, btnBottom: br.bottom, toastTop: tr.top };
      });
      assert(!m.missing, "missing element: " + m.missing);
      assert(!m.overlap, "Next button (bottom " + Math.round(m.btnBottom) + ") is covered by the toast (top " + Math.round(m.toastTop) + ")");
      await page.close();
    });
  }

  /* ---------- Item 3: locked leftovers note rides inside the Undo toast ---------- */
  if (run("locked")) {
    await test("r7.locked.note-in-undo-toast", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await seed(page, nw, {
        pro: ["chicken", "salmon", "yogurt"],
        m1D: { id: "c4" },
        m2L: { lo: 1, k: 1 }
      });
      await gotoPlan(page, nw, "week");
      await page.evaluate(() => openMealPicker("m1D"));
      await page.waitForSelector(".mp-opt[data-id]", { timeout: 5000 });
      const pickId = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll(".mp-opt[data-id]"));
        const other = els.find((e) => e.getAttribute("data-id") !== "c4");
        return (other || els[0]).getAttribute("data-id");
      });
      await page.click('.mp-opt[data-id="' + pickId + '"]');
      await wait(350);
      const t = await page.evaluate(() => {
        const el = document.querySelector(".undo-toast");
        return el ? { text: el.querySelector("span") ? el.querySelector("span").textContent : el.textContent, btn: !!el.querySelector("button") } : null;
      });
      assert(t, "no toast after the pick");
      assert(t.btn, "toast should carry the Undo button");
      assert(t.text === "Changed Monday dinner. Tuesday's lunch is locked as leftovers — check it.", "toast text mismatch: " + JSON.stringify(t.text));
      await page.close();
    });
  }

  /* ---------- Item 4: a stale Undo must not claim "Undone ✓" ---------- */
  if (run("undone")) {
    await test("r7.undone.restore-cleared-kills-stale-toast", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await seed(page, nw, {
        pro: ["chicken", "eggs"],
        m1D: { id: "c1" }, m2D: { id: "e3" }, m1L: { id: "c3" }, m2L: { id: "e1" }
      });
      await gotoPlan(page, nw, "week");
      await wait(200);
      await page.click('[data-act="week-clear"]');
      await wait(300);
      const afterClear = await page.evaluate(() => {
        const t = document.querySelector(".undo-toast");
        return { toast: t ? t.textContent : null, restoreBtn: !!document.querySelector('[data-act="restore-cleared"]') };
      });
      assert(afterClear.toast && /Week cleared/.test(afterClear.toast), "setup: week-clear toast expected, got " + JSON.stringify(afterClear));
      assert(afterClear.restoreBtn, "setup: restore button expected on the proteins step");
      await page.click('[data-act="restore-cleared"]');
      await wait(300);
      const afterRestore = await page.evaluate(() => {
        const t = document.querySelector(".undo-toast");
        return { toast: t ? t.textContent : null, hasUndoBtn: t ? !!t.querySelector("button") : false };
      });
      assert(!afterRestore.hasUndoBtn, "stale Undo toast survived the restore: " + JSON.stringify(afterRestore));
      assert(!afterRestore.toast || !/Undone/.test(afterRestore.toast), "an 'Undone' claim appeared after restore: " + JSON.stringify(afterRestore));
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("\n==== R7 suite (" + filter + ", width " + DW + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
