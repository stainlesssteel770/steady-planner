// Batch 4 tests for Steady PWA: dice hard meat/dairy filters + no-fit
// toasts + locked-lunch note on the dice toast. REAL dice button clicks.
// Usage: node test-r9.mjs [fit|note|all]; WIDTH env overrides width.
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
  page.on("dialog", async (d) => { try { await d.accept(); } catch (e) {} });
  await page.setViewport({ width: width || DW, height: 844 });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await wait(350);
  return page;
}
const nextWeek = (page) => page.evaluate(() => addDays(weekSunday(todayStr), 7));
const seed = (page, week, cells) => page.evaluate((week, cells) => {
  state.plans[week] = { f: {} };
  Object.keys(cells).forEach((k) => { state.plans[week].f[k] = { v: cells[k], ts: 1000 }; });
  saveLocal();
}, week, cells);
const gotoPlan = (page, week, step) => page.evaluate((week, step) => {
  ui.tab = "plan"; ui.planWs = week; ui.planStep = step; saveUi(); render(true);
}, week, step);
const cellMeal = (page, week, k) => page.evaluate((week, k) => {
  const c = planCells(week)[k];
  if (!c) return null;
  const M = PLAN_DATA.MEALS;
  return { raw: c, meal: c.id ? { id: c.id, t: M[c.id].t, lo: !!M[c.id].lo } : null };
}, week, k);
const toastText = (page) => page.evaluate(() => {
  const t = document.querySelector(".undo-toast span");
  return t ? t.textContent : null;
});
async function clickDice(page, k) {
  await page.click('[data-act="shuffle-one"][data-k="' + k + '"]');
  await wait(220);
}

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  if (run("fit")) {
    /* Item 1a: dinner dice must never land dairy under a FRESH meat lunch */
    await test("r9.fit.fresh-meat-lunch-40-rolls-no-dairy", async () => {
      const page = await freshPage(browser);
      const nw = await nextWeek(page);
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt"], m2L: { id: "c3" }, m2D: { id: "c1" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      let dairy = 0, changes = 0, prev = "c1";
      for (let i = 0; i < 40; i++) {
        await clickDice(page, "m2D");
        const r = await cellMeal(page, nw, "m2D");
        assert(r && r.meal, "dinner vanished after a roll");
        if (r.meal.t === "D") dairy++;
        if (r.meal.id !== prev) { changes++; prev = r.meal.id; }
      }
      assert(changes >= 5, "sanity: dinner barely changed across 40 rolls (" + changes + ")");
      assert(dairy === 0, "dairy dinner landed under a fresh meat lunch in " + dairy + "/40 rolls");
      assert(page.__errs.length === 0, "page errors: " + page.__errs.join(" | "));
      await page.close();
    });

    /* Item 1b (guard): lunch dice must never land meat against a dairy dinner */
    await test("r9.fit.lunch-dice-vs-dairy-dinner-guard", async () => {
      const page = await freshPage(browser);
      const nw = await nextWeek(page);
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt"], m2L: { id: "c3" }, m2D: { id: "y3" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      let meat = 0, changes = 0, prev = "c3";
      for (let i = 0; i < 40; i++) {
        await clickDice(page, "m2L");
        const r = await cellMeal(page, nw, "m2L");
        assert(r && r.meal, "lunch vanished after a roll");
        if (r.meal.t === "M") meat++;
        if (r.meal.id !== prev) { changes++; prev = r.meal.id; }
      }
      assert(changes >= 5, "sanity: lunch barely changed across 40 rolls (" + changes + ")");
      assert(meat === 0, "meat lunch landed against a dairy dinner in " + meat + "/40 rolls");
      await page.close();
    });

    /* Item 1c: dinner no-fit — pool is only fish/dairy, lunch is meat */
    await test("r9.fit.dinner-no-fit-stays-and-toasts", async () => {
      const page = await freshPage(browser);
      const nw = await nextWeek(page);
      await seed(page, nw, { pro: ["salmon", "yogurt"], m2L: { id: "c3" }, m2D: { id: "sa1" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      await clickDice(page, "m2D");
      const r = await cellMeal(page, nw, "m2D");
      assert(r && r.meal && r.meal.id === "sa1", "no-fit dinner roll changed the dinner to " + JSON.stringify(r && r.meal));
      const txt = await toastText(page);
      assert(txt === "No other dinner fits today's lunch.", "expected the dinner no-fit toast, got: " + txt);
      await page.close();
    });

    /* Item 1d (user add): lunch no-fit — pool is only meat lunches, dinner is dairy */
    await test("r9.fit.lunch-no-fit-stays-and-toasts", async () => {
      const page = await freshPage(browser);
      const nw = await nextWeek(page);
      await seed(page, nw, { pro: ["chicken"], m2L: { id: "y1" }, m2D: { id: "y3" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      await clickDice(page, "m2L");
      const r = await cellMeal(page, nw, "m2L");
      assert(r && r.meal && r.meal.id === "y1", "no-fit lunch roll changed the lunch to " + JSON.stringify(r && r.meal));
      const txt = await toastText(page);
      assert(txt === "No other lunch fits today's dinner.", "expected the lunch no-fit toast, got: " + txt);
      await page.close();
    });
  }

  if (run("note")) {
    /* Item 2: locked leftovers lunch note on the dice toast */
    await test("r9.note.locked-tomorrow-lunch-on-dice-toast", async () => {
      const page = await freshPage(browser);
      const nw = await nextWeek(page);
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt"], m1D: { id: "c1" }, m2L: { lo: 1, k: 1 }, m2D: { id: "y3" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      const NOTE = "Tuesday's lunch is locked as leftovers — check it.";
      let meatLo = 0;
      for (let i = 0; i < 40 && !meatLo; i++) {
        await clickDice(page, "m1D");
        const r = await cellMeal(page, nw, "m1D");
        assert(r && r.meal, "dinner vanished after a roll");
        const txt = await toastText(page);
        if (r.meal.lo && r.meal.t === "M") {
          meatLo++;
          assert(txt === "Changed Monday dinner. " + NOTE, "meat-lo roll toast missing the locked note, got: " + txt);
        } else if (!r.meal.lo) {
          // picker parity: a dinner that makes no leftovers also invalidates
          // the locked leftovers lunch — the note must ride those rolls too
          assert(txt && txt.indexOf(NOTE) >= 0, "non-lo roll toast missing the locked note, got: " + txt);
        }
      }
      assert(meatLo >= 1, "sanity: meat-lo dinner never landed in 40 rolls");
      const lunch = await cellMeal(page, nw, "m2L");
      assert(lunch && lunch.raw.lo && lunch.raw.k, "the locked leftovers lunch was modified: " + JSON.stringify(lunch && lunch.raw));
      assert(page.__errs.length === 0, "page errors: " + page.__errs.join(" | "));
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("\n==== R9 suite (" + filter + ", width " + DW + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
