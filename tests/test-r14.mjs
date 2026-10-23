/* Steady BUG-FIX BATCH (post-v23) suite.
   Sections: bf1 (kashrus rebuild pairing) | bf2 (top-up Yom Tov walk) |
             bf3 (stale-save guard) | bf4 (rest-day leftovers) |
             bf5 (broth split) | bf6 (failed-save status) |
             bf7 (copy fixes) | bf8 (screen-reader labels) |
             bf10 (calendar data) | bf11 (fast / Nine Days rules)
   Usage: node test-r14.mjs [section|all]   (WIDTH env, default 390) */
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
const MULBERRY = `(a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }`;

const section = process.argv[2] || "all";
const run = (s) => section === "all" || section === s;
const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ============ Item 1: locked meat lunch constrains the dinner pass ============ */
  if (run("bf1")) {
    await test("r14.bf1.engine-locked-meat-lunch-never-dairy-dinner", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const base = { pro: ["chicken", "yogurt"], m0L: { id: "c2", k: 1 } }; // c2 = meat chicken lunch, locked
        let viol = 0, filled = 0, firstBad = null;
        for (let s = 1; s <= 3000; s++) {
          const out = PLAN_ENGINE.generate(ctx, JSON.parse(JSON.stringify(base)), mulberry(s));
          const r = PLAN_ENGINE.resolve(ctx, out, "m0D");
          if (r && r.meal) { filled++; if (r.meal.t === "D") { viol++; if (!firstBad) firstBad = { id: r.meal.id, seed: s }; } }
        }
        // mdGap toggle ON: the day rule is lifted, dairy dinners allowed again.
        const gapCells = Object.assign({}, base, { mdGap: true });
        let gapViol = 0;
        for (let s = 1; s <= 3000; s++) {
          const out = PLAN_ENGINE.generate(ctx, JSON.parse(JSON.stringify(gapCells)), mulberry(s));
          const r = PLAN_ENGINE.resolve(ctx, out, "m0D");
          if (r && r.meal && r.meal.t === "D") gapViol++;
        }
        return { viol, filled, firstBad, gapViol };
      }, MULBERRY);
      assert(res.filled > 2500, "dinner should be filled in nearly all rebuilds, got " + res.filled);
      assert(res.viol === 0, "dairy dinner over a locked meat lunch in " + res.viol + "/3000 rebuilds, first: " + JSON.stringify(res.firstBad));
      assert(res.gapViol > 100, "with mdGap on, dairy dinners should occur again (rule lifted), got " + res.gapViol + "/3000");
      await page.close();
    });

    await test("r14.bf1.ui-shuffle-all-respects-locked-meat-lunch", async () => {
      const page = await freshPage(browser);
      const tw = await page.evaluate(() => {
        const tw = addDays(weekSunday(todayStr), 7); // next week: no past days
        state.plans[tw] = { f: {
          pro: { v: ["chicken", "yogurt"], ts: 1000 },
          m0L: { v: { id: "c2", k: true }, ts: 1000 }
        } };
        saveLocal();
        ui.tab = "plan"; ui.planWs = tw; ui.planStep = "week"; saveUi(); render(true);
        return tw;
      });
      let bad = null;
      for (let i = 0; i < 15 && !bad; i++) {
        await page.evaluate(() => document.querySelector('[data-act="shuffle-all"]').click());
        await wait(200);
        const tag = await page.evaluate((tw) => {
          const c = planCells(tw).m0D;
          return c && c.id && PLAN_DATA.MEALS[c.id] ? PLAN_DATA.MEALS[c.id].t : null;
        }, tw);
        if (tag === "D") bad = { click: i + 1 };
      }
      assert(!bad, "shuffle-all produced a dairy dinner over the locked meat lunch on click " + (bad && bad.click));
      await page.close();
    });
  }

  /* ============ Item 2: midweek top-up never lands on Yom Tov ============ */
  if (run("bf2")) {
    await test("r14.bf2.topup-walks-off-yomtov-earlier-first", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const cells = { pro: ["chicken", "salmon"] };
        const mkCtx = (yt) => ({ week: "2027-04-25", today: "2027-04-25", rest: {}, pre: {}, yomtov: yt });
        const out = {};
        // Real Pesach 2027 week (Sun Apr 25 - Fri Apr 30): VII=Wed 28, VIII=Thu 29.
        let p = PLAN_ENGINE.prep(mkCtx({ "2027-04-28": true, "2027-04-29": true }), cells, 0);
        out.realWeek = p.midweek.date;
        // Tie-break: only Wed is Yom Tov; Tue and Thu are both 1 away -> earlier (Tue) wins.
        p = PLAN_ENGINE.prep(mkCtx({ "2027-04-28": true }), cells, 0);
        out.tie = p.midweek.date;
        // Tue+Wed blocked -> nearest free is Thu (dist 1), not Mon (dist 2).
        p = PLAN_ENGINE.prep(mkCtx({ "2027-04-27": true, "2027-04-28": true }), cells, 0);
        out.later = p.midweek.date;
        // Control: no Yom Tov -> unchanged Wednesday.
        p = PLAN_ENGINE.prep(mkCtx({}), cells, 0);
        out.control = p.midweek.date;
        // App side: planCtx must hand the engine the week's Yom Tov dates.
        out.appCtx = planCtx("2027-04-25");
        return out;
      });
      assert(res.realWeek === "2027-04-27", "Pesach week top-up should walk to Tue Apr 27 (nearest non-Yom-Tov), got " + res.realWeek);
      assert(res.tie === "2027-04-27", "tie between Tue/Thu should go earlier (Tue Apr 27), got " + res.tie);
      assert(res.later === "2027-04-29", "with Tue+Wed blocked the top-up should land Thu Apr 29, got " + res.later);
      assert(res.control === "2027-04-28", "no-Yom-Tov control should stay Wed Apr 28, got " + res.control);
      assert(res.appCtx.yomtov && res.appCtx.yomtov["2027-04-28"] && res.appCtx.yomtov["2027-04-29"],
        "planCtx should carry the week's Yom Tov dates (Apr 28/29), got " + JSON.stringify(res.appCtx.yomtov || null));
      await page.close();
    });
  }

  /* ============ Item 3: stale-save guard (stateRev) ============ */
  if (run("bf3")) {
    await test("r14.bf3.stale-copy-save-refused-newer-data-intact", async () => {
      const pageA = await freshPage(browser);
      await pageA.evaluate(() => { localStorage.clear(); });
      await pageA.reload({ waitUntil: "networkidle0" });
      await pageA.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(300);
      const pageB = await browser.newPage();
      await pageB.setViewport({ width: WIDTH, height: 844 });
      pageB.on("dialog", (d) => d.accept());
      await pageB.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0", timeout: 90000 });
      await pageB.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(300);
      // Copy B saves (bumps the rev) while copy A is still open on the old rev.
      await pageB.evaluate(() => { state.settings = state.settings || {}; state.settings.__copyB = 1; saveLocal(); });
      await wait(400); // storage event reaches A
      const aSide = await pageA.evaluate(() => ({
        banner: !!document.getElementById("staleBanner"),
        reloadBtn: !!document.querySelector('[data-act="stale-reload"]')
      }));
      assert(aSide.banner, "copy A should show the stale/reload banner after copy B saved");
      assert(aSide.reloadBtn, "the banner should offer a reload action");
      // Copy A tries to save: must be refused; B's data and rev stay intact.
      const refused = await pageA.evaluate(() => saveLocal());
      assert(refused === false, "copy A's stale save should be refused (saveLocal returns false), got " + refused);
      const stored = await pageA.evaluate(() => ({
        rev: localStorage.getItem("steady.stateRev"),
        hasB: (JSON.parse(localStorage.getItem("steady.state") || "{}").settings || {}).__copyB === 1
      }));
      assert(stored.rev === "1", "stored rev should still be B's 1, got " + stored.rev);
      assert(stored.hasB, "copy B's saved data should be intact after A's refused save");
      await pageB.close();
      await pageA.close();
    });

    await test("r14.bf3.fresh-copy-save-still-works", async () => {
      const page = await freshPage(browser);
      await page.evaluate(() => { localStorage.clear(); });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(300);
      const res = await page.evaluate(() => {
        const ok = saveLocal();
        return { ok, rev: localStorage.getItem("steady.stateRev"), banner: !!document.getElementById("staleBanner") };
      });
      assert(res.ok === true, "a fresh copy's save should succeed, got " + res.ok);
      assert(res.rev === "1", "rev should bump to 1 after the first save, got " + res.rev);
      assert(!res.banner, "no stale banner on a fresh copy");
      await page.close();
    });
  }

  /* ============ Item 4: rest day drops the orphaned leftover lunch ============ */
  if (run("bf4")) {
    await test("r14.bf4.rest-day-orphaned-leftover-lunch-dropped", async () => {
      const fmtD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const now = new Date();
      const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7);
      const mon = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 1);
      const sunS = fmtD(sun), monS = fmtD(mon);
      const page = await freshPage(browser);
      // Next week's plan: Sunday stew dinner (lo-capable), Monday leftover lunch.
      await page.evaluate((wk) => {
        state.plans[wk] = { f: {
          pro: { v: ["stew", "chicken"], ts: 1000 },
          m0D: { v: { id: "s1" }, ts: 1000 },
          m1L: { v: { lo: 1 }, ts: 1000 }
        } };
        saveLocal();
        ui.tab = "plan"; ui.planWs = wk; ui.planStep = "week"; saveUi(); render(true);
      }, sunS);
      await wait(300);
      const weekText = () => page.evaluate(() => document.getElementById("main").textContent);
      const before = await weekText();
      assert(before.includes("Leftovers:"), "control: Monday should show the leftover card before the rest mark");
      // Mark Monday a rest day (data level: the Settings control only targets
      // the viewed date, which cannot be a future plan day).
      await page.evaluate((mon) => {
        state.days[mon] = { f: { restOverride: { v: "rest", ts: 1000 } } };
        saveLocal(); render(true);
      }, monS);
      await wait(300);
      const marked = await weekText();
      assert(marked.includes("not planned here"), "Monday should render as a rest day");
      // A rebuild must drop the orphaned cell (the plan must not keep it)...
      await page.evaluate(() => document.querySelector('[data-act="shuffle-all"]').click());
      await wait(300);
      const kept = await page.evaluate((wk) => planCells(wk).m1L, sunS);
      assert(!kept, "after a rebuild the orphaned leftover cell should be dropped, still kept: " + JSON.stringify(kept));
      // ...so un-marking the day cannot resurrect a stale leftover card.
      await page.evaluate((mon) => {
        state.days[mon] = { f: { restOverride: { v: "normal", ts: 1000 } } };
        saveLocal(); render(true);
      }, monS);
      await wait(300);
      const monSection = await page.evaluate(() => {
        const secs = Array.from(document.querySelectorAll("section.card"));
        const s = secs.find((x) => { const h = x.querySelector(".day-head"); return h && h.textContent.indexOf("Monday") === 0; });
        return s ? s.textContent : null;
      });
      assert(monSection !== null, "Monday's day section should render again after un-marking");
      assert(!monSection.includes("Leftovers:"), "no 'Leftovers:' card should exist for Monday after the rest day is un-marked, got: " + monSection.slice(0, 300));
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("==== R14 suite (" + section + ", width " + WIDTH + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
