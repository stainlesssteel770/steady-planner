// Batch 1 (meat/dairy) tests for Steady PWA. Usage: node test-r6.mjs [gen|empty|dice|all]
// WIDTH env overrides the default viewport width.
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

// Count, over N generated weeks, days whose lunch resolves to a Meat meal
// while that day's dinner is Dairy. Leftovers lunches resolve to their
// source dinner's meal.
const genViolations = (page, week, proteins, n) => page.evaluate((week, proteins, n) => {
  state.plans[week] = { f: { pro: { v: proteins, ts: 1 } } };
  saveLocal();
  const cells = planCells(week), ctx = planCtx(week);
  const M = PLAN_DATA.MEALS;
  let viol = 0, dairyDays = 0;
  for (let i = 0; i < n; i++) {
    const out = PLAN_ENGINE.generate(ctx, cells, Math.random);
    for (let d = 0; d <= 5; d++) {
      const dn = out["m" + d + "D"], ln = out["m" + d + "L"];
      const dMeal = dn && dn.id ? M[dn.id] : null;
      if (!dMeal || dMeal.t !== "D") continue;
      dairyDays++;
      let lMeal = null;
      if (ln && ln.id) lMeal = M[ln.id];
      else if (ln && ln.lo) { const pv = out["m" + (d - 1) + "D"]; lMeal = pv && pv.id ? M[pv.id] : null; }
      if (lMeal && lMeal.t === "M") viol++;
    }
  }
  return { viol, dairyDays };
}, week, proteins, n);

// Roll shuffleOne on `key` from the seeded plan, R times from the same start.
// countIf(out) -> "relevant" | "violation" | null per roll.
const diceRolls = (page, week, key, r, mode) => page.evaluate((week, key, r, mode) => {
  const cells = planCells(week), ctx = planCtx(week);
  const M = PLAN_DATA.MEALS;
  let relevant = 0, viol = 0, dairyLanded = 0, lockedKept = 0, lunchChanged = 0;
  for (let i = 0; i < r; i++) {
    const out = PLAN_ENGINE.shuffleOne(ctx, cells, key, Math.random);
    if (mode === "forward") {
      const nm = out.m1D && out.m1D.id ? M[out.m1D.id] : null;
      if (nm && nm.lo && nm.t === "M") { relevant++; if (out.m2L && out.m2L.lo) viol++; }
    } else if (mode === "reverse") {
      const nm = out.m2D && out.m2D.id ? M[out.m2D.id] : null;
      if (nm && nm.t === "D") relevant++;
      if (!(out.m2L && out.m2L.lo)) lunchChanged++;
    } else if (mode === "locked") {
      const nm = out.m2D && out.m2D.id ? M[out.m2D.id] : null;
      if (nm && nm.t === "D") { dairyLanded++; if (out.m2L && out.m2L.lo && out.m2L.k) lockedKept++; }
      if (!(out.m2L && out.m2L.lo && out.m2L.k)) lunchChanged++;
    }
  }
  return { relevant, viol, dairyLanded, lockedKept, lunchChanged };
}, week, key, r, mode);

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ---------- Item 1: generate never places a fresh meat lunch on a dairy-dinner day ---------- */
  if (run("gen")) {
    await test("r6.gen.chicken-salmon-yogurt-300-weeks", async () => {
      const page = await freshPage(browser);
      /* Beta batch 1 item 3 (user-approved): target NEXT week — generate
         now leaves this week's past days untouched, which shrank the
         this-week sample mid-week. Assertions/thresholds unchanged. */
      const { nw } = await weeks(page);
      const r = await genViolations(page, nw, ["chicken", "salmon", "yogurt"], 300);
      assert(r.dairyDays > 200, "sanity: expected many dairy-dinner days, got " + r.dairyDays);
      assert(r.viol === 0, "meat lunch on dairy-dinner day in " + r.viol + " generated days");
      await page.close();
    });
    await test("r6.gen.plus-eggs-300-weeks", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      const r = await genViolations(page, nw, ["chicken", "salmon", "yogurt", "eggs"], 300);
      assert(r.dairyDays > 200, "sanity: expected many dairy-dinner days, got " + r.dairyDays);
      assert(r.viol === 0, "meat lunch on dairy-dinner day in " + r.viol + " generated days");
      await page.close();
    });
  }

  /* ---------- Add 1: an empty lunch slot renders + picks cleanly; shop/prep skip it ---------- */
  if (run("empty")) {
    await test("r6.empty-lunch-slot-renders-and-picks", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await seed(page, nw, {
        pro: ["chicken", "eggs"],
        m1D: { id: "c1" }, m2D: { id: "e3" },
        m1L: { id: "c3" }
        // m2L deliberately absent: an empty lunch slot
      });
      await gotoPlan(page, nw, "week");
      await wait(200);
      const slot = await page.evaluate(() => {
        const el = document.querySelector('.meal-card[data-k="m2L"]');
        return el ? { txt: el.textContent, act: el.getAttribute("data-act") } : null;
      });
      assert(slot, "empty lunch slot card missing");
      assert(/Nothing planned yet/.test(slot.txt), "empty slot should show 'Nothing planned yet', got: " + slot.txt.slice(0, 80));
      // The card is the pick target: tapping it opens the meal picker.
      await page.evaluate(() => document.querySelector('.meal-card[data-k="m2L"]').click());
      await wait(250);
      const dlg = await page.evaluate(() => { const d = document.getElementById("mealPickerDlg"); return d ? d.open : false; });
      assert(dlg, "picker did not open for the empty lunch slot");
      await page.evaluate(() => { const d = document.getElementById("mealPickerDlg"); if (d && d.open) d.close(); });
      // Shopping and Prep steps must render past the empty slot without errors.
      await gotoPlan(page, nw, "shop");
      await wait(200);
      const shopOk = await page.evaluate(() => document.getElementById("main").textContent.includes("Shopping list"));
      assert(shopOk, "shop step did not render");
      await gotoPlan(page, nw, "prep");
      await wait(200);
      const prepOk = await page.evaluate(() => document.getElementById("main").textContent.length > 50);
      assert(prepOk, "prep step did not render");
      assert(page.__errs.length === 0, "page errors: " + page.__errs.join(" | "));
      await page.close();
    });
  }

  /* ---------- Item 2: shuffleOne dinner rolls and tomorrow's leftovers lunch ---------- */
  if (run("dice")) {
    await test("r6.dice.forward-lo-meat-dinner-before-dairy-repicks", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await seed(page, tw, {
        pro: ["chicken", "salmon", "yogurt", "gbeef"],
        m1D: { id: "c1" },          // Mon dinner: meat, makes leftovers
        m2L: { lo: 1 },             // Tue lunch: leftovers of Mon dinner
        m2D: { id: "y3" }           // Tue dinner: dairy
      });
      const r = await diceRolls(page, tw, "m1D", 30, "forward");
      assert(r.relevant >= 3, "sanity: expected several lo-meat dinner rolls, got " + r.relevant);
      assert(r.viol === 0, "meat leftovers kept against dairy dinner in " + r.viol + " rolls");
      await page.close();
    });
    await test("r6.dice.reverse-dairy-dinner-roll-repicks-meat-leftovers", async () => {
      // UPDATED with the user's approval for Batch 4 item 1: the dinner
      // dice now hard-filters candidates against the same-day lunch, so a
      // dairy dinner can no longer land under the meat leftovers lunch at
      // all — the guarantee moved from "re-pick after" to "never lands".
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await seed(page, tw, {
        pro: ["chicken", "salmon", "yogurt"],
        m1D: { id: "c1" },          // Mon dinner: meat, makes leftovers
        m2L: { lo: 1 },             // Tue lunch: meat leftovers
        m2D: { id: "c4" }           // Tue dinner: meat (rolled in the test)
      });
      const r = await diceRolls(page, tw, "m2D", 30, "reverse");
      assert(r.relevant === 0, "dairy dinner landed under meat leftovers lunch in " + r.relevant + " rolls");
      assert(r.lunchChanged === 0, "the meat leftovers lunch changed in " + r.lunchChanged + " rolls");
      await page.close();
    });
    await test("r6.dice.reverse-locked-leftovers-kept", async () => {
      // UPDATED with the user's approval for Batch 4 item 1: dairy can't
      // land under the meat lunch anymore; the locked lunch must simply
      // never change across rolls.
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await seed(page, tw, {
        pro: ["chicken", "salmon", "yogurt"],
        m1D: { id: "c1" },
        m2L: { lo: 1, k: 1 },        // Tue lunch: LOCKED meat leftovers
        m2D: { id: "c4" }
      });
      const r = await diceRolls(page, tw, "m2D", 40, "locked");
      assert(r.dairyLanded === 0, "dairy dinner landed under the locked meat leftovers lunch in " + r.dairyLanded + " rolls");
      assert(r.lunchChanged === 0, "locked leftovers lunch changed in " + r.lunchChanged + " rolls");
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("\n==== R6 suite (" + filter + ", width " + DW + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
