/* Steady BETA BATCH 3 (steady-v21) suite.
   Sections: lunch (item 1) | dots (item 2)
   Usage: node test-r12.mjs [section|all]   (WIDTH env, default 390) */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/home/hatch/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome";
const WIDTH = +(process.env.WIDTH || 390);
let passed = 0, failed = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error(msg || "assert failed"); }
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "  — " + (e && e.message)); }
}
async function freshPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 844 });
  page.on("dialog", (d) => d.accept());
  await page.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await wait(350);
  return page;
}

const section = process.argv[2] || "all";
const run = (s) => section === "all" || section === s;
const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ================= Item 1: lunch variety — widen before repeating ================= */
  if (run("lunch")) {
    const PROS = ["stew", "chicken", "salmon", "yogurt"];
    // An "avoidable repeat": lunch on day d repeats a meal already used
    // earlier in the plan while some lunch meal of the chosen proteins,
    // unused in the whole plan, passes day d's hard rules (meat lunch
    // blocked when that day's dinner is dairy — pickerBlocked semantics;
    // long-meal cap when 2+ longs already in the plan).
    const AVOIDABLE_FN = `(function (out, pros) {
      var MEALS = PLAN_DATA.MEALS;
      var COMP = PLAN_DATA.COMP;
      var hands = function (mm) { var t = 0; (mm.prep || []).forEach(function (k) { var c = COMP[k]; if (c && c.a) t += c.a; }); return t; };
      /* v29a P1: the checker must count longs the way the engine does —
         total time for recipes, hands-on for built-ins. */
      var isLong = function (mm) { return mm.recipe ? mm.min >= 30 : hands(mm) >= 30; };
      var lunchIds = Object.keys(MEALS).filter(function (id) {
        /* v29a: retired meals are not candidates, so they are not "unused lunches" either. */
        return !MEALS[id].retired && pros.indexOf(MEALS[id].p) >= 0 && MEALS[id].s.indexOf("L") >= 0;
      });
      var usedAll = {};
      var longTotal = 0;
      for (var d = 0; d <= 5; d++) {
        ["L", "D"].forEach(function (sl) {
          var c = out["m" + d + sl];
          if (c && c.id) { usedAll[c.id] = true; if (isLong(MEALS[c.id])) longTotal++; }
        });
      }
      var bad = [];
      var seen = {};
      for (var d2 = 0; d2 <= 5; d2++) {
        var cell = out["m" + d2 + "L"];
        if (!cell) continue;
        var meal = null;
        if (cell.id) meal = MEALS[cell.id];
        else if (cell.lo) { var pd = out["m" + (d2 - 1) + "D"]; meal = pd && pd.id ? MEALS[pd.id] : null; }
        if (!meal) continue;
        if (seen[meal.id]) {
          var dinner = out["m" + d2 + "D"];
          var dinnerMeal = dinner && dinner.id ? MEALS[dinner.id] : null;
          var alt = lunchIds.some(function (id) {
            if (usedAll[id]) return false;
            var mm = MEALS[id];
            if (dinnerMeal && dinnerMeal.t === "D" && mm.t === "M") return false; // meat before dairy
            if (longTotal >= 2 && isLong(mm)) return false; // long-meal cap spent (v29a P1: total time for recipes)
            return true;
          });
          if (alt) bad.push({ day: d2, id: meal.id });
        }
        seen[meal.id] = true;
      }
      return bad;
    })`;

    await test("r12.lunch.midweek-1000-builds-zero-avoidable-repeats", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((pros, avoidableSrc) => {
        const avoidable = eval(avoidableSrc);
        const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const sunCtx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const wedCtx = { week: "2026-10-18", today: "2026-10-21", rest: {}, pre: {} };
        let buildsWithBad = 0, rawRepeats = 0, firstBad = null;
        for (let seed = 1; seed <= 1000; seed++) {
          const sunday = ENGINE.generate(sunCtx, { pro: pros.slice() }, mulberry(seed));
          const wed = ENGINE.generate(wedCtx, JSON.parse(JSON.stringify(sunday)), mulberry(seed + 100000));
          const bad = avoidable(wed, pros);
          // raw past-lunch repeats (informational): Wed-Fri lunch meal seen Sun-Tue
          const pastLunches = {};
          [0, 1, 2].forEach((d) => { const c = sunday["m" + d + "L"]; if (c && c.id) pastLunches[c.id] = true; if (c && c.lo) { const pd = sunday["m" + (d - 1) + "D"]; if (pd && pd.id) pastLunches[pd.id] = true; } });
          [3, 4, 5].forEach((d) => { const c = wed["m" + d + "L"]; if (c && c.id && pastLunches[c.id]) rawRepeats++; });
          if (bad.length) { buildsWithBad++; if (!firstBad) firstBad = { seed, bad }; }
        }
        return { buildsWithBad, rawRepeats, firstBad };
      }, PROS, AVOIDABLE_FN);
      assert(res.buildsWithBad === 0, "avoidable lunch repeats in " + res.buildsWithBad + "/1000 mid-week builds, first: " + JSON.stringify(res.firstBad));
      await page.close();
    });

    await test("r12.lunch.sunday-40-builds-zero-avoidable-duplicates", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((pros, avoidableSrc) => {
        const avoidable = eval(avoidableSrc);
        const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const sunCtx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        let badBuilds = 0, firstBad = null;
        for (let seed = 1; seed <= 40; seed++) {
          const out = ENGINE.generate(sunCtx, { pro: pros.slice() }, mulberry(seed + 500000));
          const bad = avoidable(out, pros);
          if (bad.length) { badBuilds++; if (!firstBad) firstBad = { seed, bad }; }
        }
        return { badBuilds, firstBad };
      }, PROS, AVOIDABLE_FN);
      assert(res.badBuilds === 0, "avoidable duplicate lunches in " + res.badBuilds + "/40 Sunday builds, first: " + JSON.stringify(res.firstBad));
      await page.close();
    });

    await test("r12.lunch.widen-prefers-last-nights-protein-then-tonights", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const MEALS = PLAN_DATA.MEALS;
        const lunchIdsOf = (p) => Object.keys(MEALS).filter((id) => !MEALS[id].retired && MEALS[id].p === p && MEALS[id].s.indexOf("L") >= 0);
        const salmonL = lunchIdsOf("salmon"), whitefishL = lunchIdsOf("whitefish"), chickenL = lunchIdsOf("chicken");
        const ctx = { week: "2026-10-18", today: "2026-10-21", rest: {}, pre: {} };
        // Wednesday: tonight's dinner locked = chicken (c1, dinner-only),
        // last night's = salmon (sa1, dinner-only). Kept protein: whitefish.
        // v29a: the locked dinners stay old dinner-only ids on purpose — a
        // recipe dinner id would also be a lunch candidate and mark that
        // recipe used, which would defeat the widen steps. `fillers` marks
        // every lunch of the given proteins used — past lunches Sun-Tue,
        // locked Thu/Fri lunches, then past dinners. lo:false keeps
        // leftover placement out of the scenario.
        const build = (fillers) => {
          // longMin 60 isolates the widen mechanism under test: in the
          // recipe era all three lunches are total-time-long (35/50/55),
          // so at the default 30 the past lunches spend the cap and the
          // fallback — shuffled rotation, random by design — decides the
          // lunch instead of the widen steps. At 60 nothing here is long,
          // so strict/b1/b2 decide deterministically.
          const cells = { pro: ["chicken", "salmon", "whitefish"], lo: false, longMin: 60, m2D: { id: "sa1", k: 1 }, m3D: { id: "c1", k: 1 } };
          const keys = ["m0L", "m1L", "m2L", "m4L", "m5L", "m0D", "m1D"];
          fillers.forEach((id, i) => {
            const key = keys[i];
            cells[key] = key.slice(-1) === "L" && i >= 3 ? { id, k: 1 } : { id };
          });
          // v29a: dinners generate before lunches, and every recipe is
          // LD — an empty Thu dinner would steal the salmon lunch the
          // widen step needs (the old slot-separated sa1/sa2 equivalent).
          // Lock it to the non-long parfait: it spends no cap budget and
          // its protein is outside the widen set.
          cells.m4D = { id: "r-berry-yogurt-granola-parfait", k: 1 };
          return cells;
        };
        const out1 = ENGINE.generate(ctx, build(whitefishL), Math.random);
        const out2 = ENGINE.generate(ctx, build(whitefishL.concat(salmonL)), Math.random);
        return { m3L_1: out1.m3L, m3L_2: out2.m3L, salmonL, whitefishL, chickenL };
      });
      assert(res.salmonL.length === 1 && res.whitefishL.length === 1 && res.chickenL.length === 1, "setup inventory changed: " + JSON.stringify({ s: res.salmonL, w: res.whitefishL, c: res.chickenL }));
      assert(res.m3L_1 && res.salmonL.indexOf(res.m3L_1.id) >= 0,
        "whitefish used up -> lunch should widen to last night's protein (salmon), got " + JSON.stringify(res.m3L_1));
      assert(res.m3L_2 && res.chickenL.indexOf(res.m3L_2.id) >= 0,
        "whitefish+salmon used up -> lunch should widen to tonight's protein (chicken), got " + JSON.stringify(res.m3L_2));
      await page.close();
    });

    await test("r12.lunch.ui-shuffle-all-avoids-past-lunch-repeats", async () => {
      const page = await freshPage(browser);
      const setup = await page.evaluate((pros) => {
        const tw = weekSunday(todayStr);
        const dow = dowOf(todayStr);
        const cells = { pro: pros.slice() };
        // Seed a plausible Sun->yesterday history: dinners + lunches.
        const dinners = ["s1", "c1", "y3", "s2"];
        const lunches = ["sa4", "y1", "c3", "y2"];
        for (let d = 0; d < dow && d <= 5; d++) {
          cells["m" + d + "D"] = { id: dinners[d % dinners.length] };
          cells["m" + d + "L"] = { id: lunches[d % lunches.length] };
        }
        state.plans[tw] = { f: {} };
        Object.keys(cells).forEach((k) => { state.plans[tw].f[k] = { v: cells[k], ts: 1000 }; });
        saveLocal();
        ui.tab = "plan"; ui.planWs = tw; ui.planStep = "week"; saveUi(); render(true);
        return { tw, dow };
      }, PROS);
      if (setup.dow >= 2) {
        const avoidable = AVOIDABLE_FN;
        let badTotal = 0;
        for (let i = 0; i < 10; i++) {
          // DOM click on the real button (the suites' pattern): a
          // coordinate click races the app's deferred re-render and can
          // land on the bottom nav instead.
          const clicked = await page.evaluate(() => {
            const b = document.querySelector('button[data-act="shuffle-all"]');
            if (!b) return false;
            b.click();
            return true;
          });
          assert(clicked, "Shuffle all button missing on iteration " + i);
          await wait(350);
          const bad = await page.evaluate((tw, pros, src) => {
            const fn = eval(src);
            return fn(planCells(tw), pros);
          }, setup.tw, PROS, avoidable);
          // Only count repeats on non-past days (past lunches are history).
          badTotal += bad.filter((b) => b.day >= setup.dow).length;
        }
        assert(badTotal === 0, "Shuffle all x10 produced " + badTotal + " avoidable lunch repeats vs past days");
      }
      await page.close();
    });
  }

  /* ================= Item 2: week dots — 44px at 360/390, fit at 320 ================= */
  if (run("dots")) {
    const measure = async (w) => {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: 844 });
      page.on("dialog", (d) => d.accept());
      await page.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0", timeout: 90000 });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(350);
      const m = await page.evaluate(() => {
        ui.tab = "today"; saveUi(); render(true);
        const dot = document.querySelector(".dot");
        const r = dot ? dot.getBoundingClientRect() : null;
        return { docSW: document.documentElement.scrollWidth, iw: window.innerWidth, dotW: r ? r.width : null };
      });
      await page.close();
      return m;
    };
    await test("r12.dots.44px-at-360-and-390-fit-at-320", async () => {
      const m390 = await measure(390);
      assert(m390.dotW >= 43.5, "dots should be 44px at 390, got " + m390.dotW);
      const m360 = await measure(360);
      assert(m360.dotW >= 43.5, "dots should stay 44px at 360 (batch 2 shrank them there too), got " + m360.dotW);
      const m320 = await measure(320);
      assert(m320.docSW <= m320.iw + 1, "page overflows at 320: " + m320.docSW + " > " + m320.iw);
      assert(m320.dotW < 44, "dots should shrink at 320 to fit, got " + m320.dotW);
    });
  }
} finally {
  await browser.close();
  console.log("\n==== R12 suite (" + section + ", width " + WIDTH + "): " + passed + " passed, " + failed + " failed ====");
  process.exit(failed ? 1 : 0);
}
