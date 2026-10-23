/* Steady BUG-FIX BATCH (post-v23) suite.
   Sections: bf1 (kashrus rebuild pairing) | bf2 (top-up Yom Tov walk) |
             bf3 (stale-save guard) | bf4 (rest-day leftovers) |
             bf5 (broth split) | bf6 (failed-save status) |
             bf7 (copy fixes) | bf8 (screen-reader labels) |
             bf10 (calendar data) | bf11 (fast / Nine Days rules) |
             v25i1 (compact Today hero) | v25i2 (On-the-plan above habits) |
             v25i3 (habit group sections) | v25i4 (sticky score strip)
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
        reloadBtn: !!document.querySelector('[data-act="stale-reload"]'),
        bannerText: document.getElementById("staleBanner") ? document.getElementById("staleBanner").textContent : "",
        btnLabel: document.querySelector('[data-act="stale-reload"]') ? document.querySelector('[data-act="stale-reload"]').textContent.trim() : ""
      }));
      assert(aSide.banner, "copy A should show the stale/reload banner after copy B saved");
      assert(aSide.reloadBtn, "the banner should offer a reload action");
      // Mark's approved wording (issue #1, 2026-10-23).
      assert(aSide.bannerText.indexOf("A newer version of Steady is open in another tab. Tap Reload so you don't lose changes.") >= 0, "banner should carry Mark's approved text, got: " + aSide.bannerText);
      assert(aSide.btnLabel === "Reload", "banner button should read 'Reload', got: " + aSide.btnLabel);
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

  /* ============ Item 5: broth split (pareve vegetable vs chicken) ============ */
  if (run("bf5")) {
    await test("r14.bf5.broth-split-by-meal-tag", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const fmtD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        const now = new Date();
        const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7);
        const wk = fmtD(sun);
        const ctx = { week: wk, today: wk, rest: {}, pre: {} };
        const brothLines = (cells) => {
          const shop = PLAN_ENGINE.shopping(ctx, cells);
          const out = [];
          shop.sections.forEach((sec) => sec.lines.forEach((l) => { if (/broth/i.test(l.name)) out.push(l.name); }));
          return out;
        };
        return {
          pareve: brothLines({ pro: ["legumes", "chicken"], m0D: { id: "l1", k: 1 } }),
          meat: brothLines({ pro: ["stew", "chicken"], m0D: { id: "s2", k: 1 } })
        };
      });
      assert(res.pareve.length === 1 && /vegetable/i.test(res.pareve[0]) && !/chicken/i.test(res.pareve[0]),
        "pareve soup week should list only vegetable broth, got: " + JSON.stringify(res.pareve));
      assert(res.meat.length === 1 && /chicken/i.test(res.meat[0]) && !/vegetable/i.test(res.meat[0]),
        "meat soup week should list only chicken broth, got: " + JSON.stringify(res.meat));
      await page.close();
    });
  }

  /* ============ Item 6: a failed save must not claim "Saved on this phone" ============ */
  if (run("bf6")) {
    await test("r14.bf6.failed-save-status-is-honest", async () => {
      const page = await freshPage(browser);
      // Pages in this suite share one browser profile, so drive the app to
      // a known state first: no inherited TESTMODE fake, Today tab shown.
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate(() => {
        const orig = Storage.prototype.setItem;
        window.__origSetItem = orig;
        Storage.prototype.setItem = function (k, v) {
          if (k === "steady.state") { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
          return orig.call(this, k, v);
        };
        ui.tab = "today"; saveUi(); render(true);
      });
      // A real edit through a real control: tick a habit on Today. (The
      // "drinks" tick is used because no day rule ever disables it.)
      await page.waitForSelector('[data-act="tick"][data-f="drinks"]', { timeout: 15000 });
      await page.evaluate(() => document.querySelector('[data-act="tick"][data-f="drinks"]').click());
      await wait(500);
      const badStatus = await page.evaluate(() => document.getElementById("syncStatus").textContent);
      assert(badStatus !== "Saved on this phone", "status must not claim a save that failed, got: '" + badStatus + "'");
      assert(badStatus.length > 0, "a failure status should be shown instead, got empty");
      // Mark's approved wording + a Try again button (issue #1, 2026-10-23).
      assert(badStatus.indexOf("Couldn't save your last change. Check your phone's storage, then tap Try again.") >= 0, "failure status should carry Mark's approved text, got: '" + badStatus + "'");
      const retryBtn = await page.evaluate(() => { const b = document.querySelector('[data-act="retry-save"]'); return b ? b.textContent.trim() : null; });
      assert(retryBtn === "Try again", "a 'Try again' button should accompany the failure status, got: " + retryBtn);
      // Control: writes work again -> tapping Try again saves and the saved
      // status returns.
      await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
      await page.evaluate(() => document.querySelector('[data-act="retry-save"]').click());
      await wait(500);
      const okStatus = await page.evaluate(() => document.getElementById("syncStatus").textContent);
      assert(okStatus === "Saved on this phone", "control: a successful retry should show the saved status, got: '" + okStatus + "'");
      await page.close();
    });
  }

  /* ============ Item 7: copy fixes ============ */
  if (run("bf7")) {
    const prepAmounts = async (page, cells) => page.evaluate((cellsIn) => {
      const fmtD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const now = new Date();
      const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7);
      const wk = fmtD(sun);
      const ctx = { week: wk, today: wk, rest: {}, pre: {} };
      const prep = PLAN_ENGINE.prep(ctx, cellsIn, 0);
      const out = {};
      prep.steps.forEach((s) => { out[s.id] = s.amount; });
      return out;
    }, cells);

    await test("r14.bf7a.count-one-unit-is-singular", async () => {
      const page = await freshPage(browser);
      const amounts = await prepAmounts(page, { pro: ["chicken", "stew"], m1D: { id: "c5", k: 1 } });
      assert(amounts.chopveg && amounts.chopveg.indexOf("1 cucumber") === 0 && !/cucumbers/.test(amounts.chopveg),
        "amount for 1 cucumber should be singular, got: '" + amounts.chopveg + "'");
      await page.close();
    });

    await test("r14.bf7b.fractional-unit-is-singular", async () => {
      const page = await freshPage(browser);
      const amounts = await prepAmounts(page, { pro: ["gbeef", "chicken"], m1D: { id: "b4", k: 1 } });
      assert(amounts.rice === "¼ cup dry", "amount for a quarter cup of rice should read '¼ cup dry', got: '" + amounts.rice + "'");
      await page.close();
    });

    await test("r14.bf7c.salmon-note-names-no-last-night", async () => {
      const page = await freshPage(browser);
      const how = await page.evaluate(() => PLAN_DATA.MEALS.sa4.how);
      assert(!/last night/i.test(how), "sa4's note must not presume last night's salmon, got: '" + how + "'");
      assert(/salmon/i.test(how), "sa4's note should still be about salmon, got: '" + how + "'");
      await page.close();
    });

    await test("r14.bf7d.proteins-header-matches-selected-week", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const fmtD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        const now = new Date();
        const cur = fmtD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()));
        const nxt = fmtD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7));
        const head = () => { const hs = Array.from(document.querySelectorAll("#main h3")); const h = hs.find((x) => /proteins/i.test(x.textContent)); return h ? h.textContent : ""; };
        ui.tab = "plan"; ui.planStep = "pro"; ui.planWs = nxt; saveUi(); render(true);
        const nextHead = head();
        ui.planWs = cur; saveUi(); render(true);
        return { nextHead, curHead: head() };
      });
      assert(/next week's proteins/i.test(res.nextHead), "with Next week selected the header should say next week's proteins, got: '" + res.nextHead + "'");
      assert(/this week's proteins/i.test(res.curHead), "with This week selected the header should say this week's proteins, got: '" + res.curHead + "'");
      await page.close();
    });
  }

  /* ============ Item 8: screen-reader names and toggle states ============ */
  if (run("bf8")) {
    await test("r14.bf8.accessible-names-and-toggle-states", async () => {
      const page = await freshPage(browser);
      const fmtD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const now = new Date();
      const cur = fmtD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()));
      const nxt = fmtD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7));
      // Every visible button on the main screens exposes an accessible name.
      const unnamedOn = async (tab, step) => page.evaluate((t, s) => {
        ui.tab = t; if (s) ui.planStep = s; saveUi(); render(true);
        return Array.from(document.querySelectorAll("button")).filter((el) => {
          const r = el.getBoundingClientRect();
          if (!(r.width > 0 && r.height > 0)) return false;
          return !((el.getAttribute("aria-label") || el.textContent || "").trim());
        }).length;
      }, tab, step);
      for (const [t, s] of [["today", null], ["workout", null], ["plan", "pro"], ["plan", "week"], ["plan", "shop"], ["plan", "prep"], ["meals", null]]) {
        await wait(150);
        const n = await unnamedOn(t, s);
        assert(n === 0, "screen " + t + "/" + (s || "-") + " has " + n + " buttons with no accessible name");
      }
      // Toggle states: protein chips (drive the real chip: pick, then read).
      const pro0 = await page.evaluate((wk) => {
        ui.tab = "plan"; ui.planStep = "pro"; ui.planWs = wk; saveUi(); render(true);
        const c = document.querySelector('[data-act="pro"][data-id="chicken"]');
        return c && c.getAttribute("aria-pressed");
      }, cur);
      assert(pro0 === "false", "an unpicked protein chip should read aria-pressed=false, got: " + pro0);
      await page.evaluate(() => document.querySelector('[data-act="pro"][data-id="chicken"]').click());
      await wait(250);
      const pro1 = await page.evaluate(() => {
        const on = document.querySelector('[data-act="pro"][data-id="chicken"]');
        const off = document.querySelector('[data-act="pro"][data-id="stew"]');
        return { on: on && on.getAttribute("aria-pressed"), off: off && off.getAttribute("aria-pressed") };
      });
      assert(pro1.on === "true" && pro1.off === "false", "protein chips should expose aria-pressed after picking, got: " + JSON.stringify(pro1));
      // Toggle states: prep-day chips (default Sunday selected; on the Prep step).
      const pd = await page.evaluate(() => {
        ui.planStep = "prep"; saveUi(); render(true);
        const chips = Array.from(document.querySelectorAll('[data-act="prepday"]'));
        return chips.map((c) => c.getAttribute("aria-pressed"));
      });
      assert(pd.length > 0 && pd.every((v) => v === "true" || v === "false") && pd.filter((v) => v === "true").length === 1,
        "prep-day chips should expose aria-pressed with exactly one selected, got: " + JSON.stringify(pd));
      // Toggle states: week toggle + bottom nav.
      const wkT = await page.evaluate((wk) => {
        ui.planWs = wk; saveUi(); render(true);
        const btns = Array.from(document.querySelectorAll('[data-act="plan-week"]'));
        const nav = document.querySelector('#bottomNav [data-tab="plan"]');
        return { pressed: btns.map((b) => b.getAttribute("aria-pressed")), navCurrent: nav && nav.getAttribute("aria-current") };
      }, nxt);
      assert(JSON.stringify(wkT.pressed) === JSON.stringify(["false", "true"]), "week toggle should expose aria-pressed for This/Next, got: " + JSON.stringify(wkT.pressed));
      assert(wkT.navCurrent === "page", "the active bottom-nav tab should carry aria-current=page, got: " + wkT.navCurrent);
      // Toggle states: meal-card lock button.
      const lock = await page.evaluate((wk) => {
        state.plans[wk] = { f: { pro: { v: ["chicken", "stew"], ts: 1000 }, m0D: { v: { id: "c1", k: 1 }, ts: 1000 }, m1D: { v: { id: "s1" }, ts: 1000 } } };
        saveLocal();
        ui.tab = "plan"; ui.planWs = wk; ui.planStep = "week"; saveUi(); render(true);
        const lockedBtn = document.querySelector('.meal-card[data-k="m0D"] [data-act="lock"]');
        const freeBtn = document.querySelector('.meal-card[data-k="m1D"] [data-act="lock"]');
        return { locked: lockedBtn && lockedBtn.getAttribute("aria-pressed"), free: freeBtn && freeBtn.getAttribute("aria-pressed") };
      }, nxt);
      assert(lock.locked === "true" && lock.free === "false", "lock buttons should expose aria-pressed, got: " + JSON.stringify(lock));
      // Check-in inputs carry explicit labels.
      const ci = await page.evaluate(() => {
        ui.tab = "today"; saveUi(); render(true);
        const w = document.getElementById("ciWeight"), wa = document.getElementById("ciWaist");
        return { w: w && w.getAttribute("aria-label"), wa: wa && wa.getAttribute("aria-label") };
      });
      assert(ci.w && ci.wa, "weight/waist inputs should have aria-labels, got: " + JSON.stringify(ci));
      await page.close();
    });
  }

  /* ============ Item 10: calendar fasts + Nine Days data ============ */
  if (run("bf10")) {
    await test("r14.bf10.calendar-fasts-and-nine-days", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(async () => {
        const j = await (await fetch("calendar.json")).json();
        const byKind = {};
        j.events.forEach((e) => { (byKind[e.k] = byKind[e.k] || {})[e.d] = e.t; });
        return { fast: byKind.fast || {}, tisha: byKind.tishabav || {}, nine: j.nineDays || [], yomtovCount: (j.events || []).filter((e) => e.k === "yomtov").length };
      });
      const F = res.fast, T = res.tisha;
      // Hebcal observed dates (diaspora), as returned by the API.
      const expectFast = {
        "2026-03-02": /Esther/, "2026-07-02": /Tammuz/, "2026-09-14": /Gedaliah/, "2026-12-20": /Tevet/,
        "2027-03-22": /Esther/, "2027-07-22": /Tammuz/, "2027-10-04": /Gedaliah/,
        "2028-01-09": /Tevet/, "2028-03-09": /Esther/, "2028-07-11": /Tammuz/, "2028-09-24": /Gedaliah/, "2028-12-28": /Tevet/
      };
      Object.keys(expectFast).forEach((d) => assert(F[d] && expectFast[d].test(F[d]), "minor fast missing/misnamed at " + d + ": " + F[d]));
      assert(Object.keys(F).length === 12, "expected exactly 12 minor-fast events (2026-2028), got " + Object.keys(F).length);
      ["2026-07-23", "2027-08-12", "2028-08-01"].forEach((d) => assert(T[d] && /B.Av|B’Av/.test(T[d]), "Tisha B'Av missing at " + d + ": " + T[d]));
      assert(res.yomtovCount === 30, "the 30 yomtov events must be preserved, got " + res.yomtovCount);
      // Nine Days: 1-9 Av each year, ending on Tisha B'Av.
      const spans = [["2026-07-15", "2026-07-23"], ["2027-08-04", "2027-08-12"], ["2028-07-24", "2028-08-01"]];
      assert(res.nine.length === 27, "nineDays should hold 27 dates (9 x 3 years), got " + res.nine.length);
      spans.forEach(([a, b]) => {
        assert(res.nine.includes(a) && res.nine.includes(b), "nineDays span " + a + ".." + b + " incomplete");
      });
      await page.close();
    });
  }

  /* ============ Item 11: fast-day + Nine Days engine/Today rules ============ */
  if (run("bf11")) {
    const engCtx = (week, extra) => Object.assign({ week: week, today: week, rest: {}, pre: {} }, extra || {});
    const seededGen = async (page, ctx, cells, seeds) => page.evaluate((c, cl, sd) => {
      // MULBERRY is not in page scope; use a local seeded source with the same shape.
      const outs = [];
      sd.forEach((seed) => {
        let a = seed >>> 0;
        const rand = () => {
          a |= 0; a = (a + 0x6D2B79F5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        outs.push(PLAN_ENGINE.generate(c, cl, rand));
      });
      return outs;
    }, ctx, cells, seeds);
    const seeds200 = Array.from({ length: 200 }, (_, i) => 1000 + i * 37);

    await test("r14.bf11a.minor-fast-no-lunch-light-dinner", async () => {
      const page = await freshPage(browser);
      const wk = "2027-07-18"; // Tzom Tammuz = Thu Jul 22 (dow 4)
      const ctx = engCtx(wk, { fast: { 4: "Tzom Tammuz" } });
      const slotInfo = await page.evaluate((c) => {
        const sl = PLAN_ENGINE.slots(c, { pro: ["eggs", "yogurt"] });
        const bk = PLAN_ENGINE.breakfastDays(c, { pro: ["eggs", "yogurt"] }).map((b) => b.dow);
        return { l4: sl.some((s) => s.dow === 4 && s.slot === "L"), d4: sl.some((s) => s.dow === 4 && s.slot === "D"), bk };
      }, ctx);
      assert(!slotInfo.l4, "a minor fast day must have no lunch slot");
      assert(slotInfo.d4, "a minor fast day keeps its (break-fast) dinner slot");
      assert(!slotInfo.bk.includes(4), "no breakfast is planned on a minor fast day");
      const outs = await seededGen(page, ctx, { pro: ["eggs", "yogurt", "chicken", "stew"] }, seeds200);
      const res = await page.evaluate((outsIn) => outsIn.map((o) => {
        const r4 = PLAN_ENGINE.resolve({ week: "2027-07-18", today: "2027-07-18", rest: {}, pre: {}, fast: { 4: "Tzom Tammuz" } }, o, "m4D");
        return { l4: !!o.m4L, d4tag: r4 && r4.meal ? r4.meal.t : null, d4light: r4 && r4.meal ? !!r4.meal.light : false, d4filled: !!(r4 && r4.meal) };
      }), outs);
      assert(res.every((r) => !r.l4), "generate must never fill a lunch on a minor fast day");
      assert(res.every((r) => r.d4filled), "the break-fast dinner should be filled");
      assert(res.every((r) => r.d4tag !== "M"), "a break-fast dinner is never meat, got tags: " + JSON.stringify(res.map((r) => r.d4tag).filter((t, i, a) => a.indexOf(t) === i)));
      const lightPct = res.filter((r) => r.d4light).length / res.length;
      assert(lightPct >= 0.9, "break-fast dinners should be light-tagged in >=90% of builds, got " + Math.round(lightPct * 100) + "%");
      await page.close();
    });

    await test("r14.bf11b.tishabav-no-slots", async () => {
      const page = await freshPage(browser);
      const wk = "2027-08-08"; // Tisha B'Av = Thu Aug 12 (dow 4)
      const ctx = engCtx(wk, { tisha: { 4: true } });
      const slotInfo = await page.evaluate((c) => {
        const sl = PLAN_ENGINE.slots(c, { pro: ["eggs", "yogurt"] });
        const bk = PLAN_ENGINE.breakfastDays(c, { pro: ["eggs", "yogurt"] }).map((b) => b.dow);
        return { any4: sl.some((s) => s.dow === 4), bk };
      }, ctx);
      assert(!slotInfo.any4, "Tisha B'Av must have no meal slots at all");
      assert(!slotInfo.bk.includes(4), "no breakfast is planned on Tisha B'Av");
      const outs = await seededGen(page, ctx, { pro: ["eggs", "yogurt", "chicken"] }, seeds200.slice(0, 20));
      assert(outs.every((o) => !o.m4L && !o.m4D), "generate must fill nothing on Tisha B'Av");
      await page.close();
    });

    await test("r14.bf11c.nine-days-no-meat", async () => {
      const page = await freshPage(browser);
      const wk = "2027-08-08"; // Nine Days 2027: Aug 4-12 -> dows 0-4 of this week; Fri Aug 13 (dow 5) is out
      const ctx = engCtx(wk, { nine: { 0: true, 1: true, 2: true, 3: true, 4: true } });
      const outs = await seededGen(page, ctx, { pro: ["chicken", "stew", "yogurt", "salmon"] }, seeds200);
      const res = await page.evaluate((outsIn, c) => {
        const tags = { nineMeat: 0, friMeat: 0, checked: 0 };
        outsIn.forEach((o) => {
          for (let d = 0; d <= 5; d++) ["L", "D"].forEach((s) => {
            const r = PLAN_ENGINE.resolve(c, o, "m" + d + s);
            if (r && r.meal) { tags.checked++; if (r.meal.t === "M") { if (d <= 4) tags.nineMeat++; else tags.friMeat++; } }
          });
        });
        return tags;
      }, outs, ctx);
      assert(res.nineMeat === 0, "no meat may be planned inside the Nine Days, got " + res.nineMeat + " meat meals");
      assert(res.friMeat > 0, "control: meat should still appear on the Friday after the Nine Days, got " + res.friMeat);
      await page.close();
    });

    await test("r14.bf11d.erev-yom-kippur-hearty-dinner", async () => {
      const page = await freshPage(browser);
      const wk = "2027-10-10"; // Erev YK = Sun Oct 10; YK = Mon Oct 11 (rest, dow 1; pre-rest dow 0)
      const ctx = engCtx(wk, { rest: { 1: "Yom Kippur" }, pre: { 0: true }, erevYK: { 0: true } });
      const hasDinnerSlot = await page.evaluate((c) => PLAN_ENGINE.slots(c, { pro: ["yogurt", "chicken"] }).some((s) => s.dow === 0 && s.slot === "D"), ctx);
      assert(hasDinnerSlot, "Erev Yom Kippur must yield a dinner slot (the pre-fast meal) despite being pre-rest");
      const outs = await seededGen(page, ctx, { pro: ["yogurt", "chicken"] }, seeds200);
      const res = await page.evaluate((outsIn, c) => outsIn.map((o) => {
        const r = PLAN_ENGINE.resolve(c, o, "m0D");
        return { filled: !!(r && r.meal), light: r && r.meal ? !!r.meal.light : null };
      }), outs, ctx);
      assert(res.every((r) => r.filled), "the Erev YK dinner should be filled");
      const heartyPct = res.filter((r) => r.light === false).length / res.length;
      assert(heartyPct >= 0.9, "Erev YK dinners should be hearty (non-light) in >=90% of builds, got " + Math.round(heartyPct * 100) + "%");
      await page.close();
    });

    await test("r14.bf11e.app-wiring-planctx-and-score", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const out = {};
        const c1 = planCtx("2027-07-18");
        out.fast4 = c1.fast && c1.fast[4];
        const c2 = planCtx("2027-08-08");
        out.tisha4 = !!(c2.tisha && c2.tisha[4]);
        out.nine0to4 = [0, 1, 2, 3, 4].every((d) => c2.nine && c2.nine[d]);
        out.nine5 = !!(c2.nine && c2.nine[5]);
        const c3 = planCtx("2027-10-10");
        out.erevYK0 = !!(c3.erevYK && c3.erevYK[0]);
        out.ykRest = c3.rest && c3.rest[1];
        out.isFast = typeof isFastDay === "function" && isFastDay("2027-07-22");
        out.isTisha = typeof isTishaBav === "function" && isTishaBav("2027-08-12");
        // Score on the fast day: only the dinner protein question applies.
        state.days["2027-07-22"] = { f: { proteinD: { v: true, ts: 1 } } };
        const sc = scoreDay("2027-07-22");
        out.proteinDinnerOnly = sc && sc.items.protein === true;
        out.workoutNull = sc && sc.items.workout === null;
        state.days["2027-07-22"] = { f: {} };
        const sc2 = scoreDay("2027-07-22");
        out.proteinMissingDinner = sc2 && sc2.items.protein === false;
        return out;
      });
      assert(res.fast4, "planCtx should carry the fast map (Tzom Tammuz at dow 4), got: " + res.fast4);
      assert(res.tisha4 && res.nine0to4 && !res.nine5, "planCtx should carry tisha + nine maps for the Nine Days week");
      assert(res.erevYK0, "planCtx should mark Erev Yom Kippur (dow 0 of the Oct 10 week)");
      assert(res.ykRest === "Yom Kippur", "confirm: Yom Kippur itself is a rest day with no meals, got: " + res.ykRest);
      assert(res.isFast && res.isTisha, "isFastDay/isTishaBav helpers should read the loaded calendar");
      assert(res.proteinDinnerOnly, "on a minor fast, protein should be satisfied by the dinner tick alone");
      assert(res.workoutNull, "on a minor fast, the workout should not count (rest)");
      assert(res.proteinMissingDinner, "on a minor fast, protein should still require the dinner tick");
      await page.close();
    });

    await test("r14.bf11f.today-flow-skips-fast-meal-questions", async () => {
      const page = await freshPage(browser);
      await page.evaluate(() => {
        try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2027-07-22", lastSeen: Date.now() })); } catch (e) {}
      });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(350);
      const res = await page.evaluate(() => {
        const dis = (f) => { const b = document.querySelector('[data-act="tick"][data-f="' + f + '"]'); return b ? b.disabled : null; };
        return { pB: dis("proteinB"), pL: dis("proteinL"), pD: dis("proteinD"), vL: dis("vegL"), vD: dis("vegD") };
      });
      assert(res.pB === true && res.pL === true && res.vL === true, "breakfast/lunch meal questions should be skipped on a minor fast, got: " + JSON.stringify(res));
      assert(res.pD === false && res.vD === false, "the dinner (break-fast) questions should stay live, got: " + JSON.stringify(res));
      await page.close();
    });
  }

  /* ============ v25 item 1: compact Today hero ============ */
  if (run("v25i1")) {
    await test("r14.v25i1.compact-hero-summary-row", async () => {
      const page = await freshPage(browser);
      await page.evaluate(() => { ui.tab = "today"; saveUi(); render(true); });
      await wait(300);
      const res = await page.evaluate(() => {
        const hero = document.querySelector("section.card.hero");
        const line = document.querySelector(".score-line");
        const sc = scoreDay(todayStr);
        return {
          noBig: !document.querySelector(".score-big"),
          lineText: line ? line.textContent : null,
          lineFontPx: line ? parseFloat(getComputedStyle(line).fontSize) : null,
          heroH: hero ? hero.getBoundingClientRect().height : null,
          dots: document.querySelectorAll(".weekdots .dotwrap").length,
          dotsMarginTop: document.querySelector(".weekdots") ? getComputedStyle(document.querySelector(".weekdots")).marginTop : null,
          noStatsLine: !document.querySelector(".stats-line"),
          exp: sc.score + "/" + sc.of + " habits",
          expStreak: String(streakCount()) + " day streak",
          expWo: workoutsInWeek(todayStr) + "/" + getSetting("workoutTarget") + " workouts"
        };
      });
      assert(res.noBig, "the 3rem .score-big hero should be gone");
      assert(res.lineFontPx !== null && res.lineFontPx <= 18, "summary line should be body-size, not the 3rem score, got " + res.lineFontPx + "px");
      assert(res.lineText && res.lineText.indexOf(res.exp) !== -1, "summary line should show '" + res.exp + "', got: " + JSON.stringify(res.lineText));
      assert(res.lineText.indexOf(res.expStreak) !== -1, "summary line should show '" + res.expStreak + "', got: " + JSON.stringify(res.lineText));
      assert(res.lineText.indexOf(res.expWo) !== -1, "summary line should show '" + res.expWo + "', got: " + JSON.stringify(res.lineText));
      assert(res.noStatsLine, "the old .stats-line should be folded into the summary line");
      assert(res.heroH !== null && res.heroH < 245, "hero should be compact (was ~280px before), got " + res.heroH);
      assert(res.dots === 7, "week dots should still render, got " + res.dots);
      assert(res.dotsMarginTop !== "14px", "week dots margins should be tightened, marginTop=" + res.dotsMarginTop);
      await page.close();
    });
  }

  /* ============ v25 item 2: On-the-plan above the habits ============ */
  if (run("v25i2")) {
    await test("r14.v25i2.plan-card-above-habits", async () => {
      const page = await freshPage(browser);
      await page.evaluate(() => {
        ui.tab = "today"; saveUi(); render(true);
        // Seed today's dinner from the data itself (first dinner-capable meal).
        const wk = weekSunday(todayStr), dow = dowOf(todayStr);
        const meal = Object.values(PLAN_DATA.MEALS).find((m) => (m.s || "").indexOf("D") >= 0);
        state.plans[wk] = { f: { pro: { v: [meal.p], ts: 1 } } };
        state.plans[wk].f["m" + dow + "D"] = { v: { id: meal.id }, ts: 1 };
        saveLocal(); render(true);
      });
      await wait(300);
      const res = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll("section.card"));
        const planIdx = sections.findIndex((s) => { const h = s.querySelector("h3"); return h && h.textContent === "On the plan"; });
        const habIdx = sections.findIndex((s) => s.querySelector(".habit"));
        const link = document.querySelector('[data-act="goto-plan-week"]');
        return { planIdx, habIdx, hasLink: !!link };
      });
      assert(res.planIdx !== -1, "the On-the-plan card should render on a planned day");
      assert(res.habIdx !== -1, "the habits section should render");
      assert(res.planIdx < res.habIdx, "On the plan should sit above the habits (plan " + res.planIdx + " vs habits " + res.habIdx + ")");
      assert(res.hasLink, "the card's Week link should still be there");
      await page.evaluate(() => document.querySelector('[data-act="goto-plan-week"]').click());
      await wait(300);
      const tab = await page.evaluate(() => ui.tab);
      assert(tab === "plan", "the Week link should still open the plan tab, got: " + tab);
      await page.close();
    });
  }

  /* ============ v25 item 3: habits grouped Food / Drinks / Body ============ */
  if (run("v25i3")) {
    await test("r14.v25i3.habit-groups", async () => {
      const page = await freshPage(browser);
      // Shared profile: an earlier section may leave a TESTMODE fake (e.g. a
      // fast day, which disables proteinB). Clear it and reload for the real
      // date before asserting tick behavior.
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate(() => { ui.tab = "today"; saveUi(); render(true); });
      await wait(300);
      const res = await page.evaluate(() => {
        const groups = Array.from(document.querySelectorAll(".habit-group")).map((el) => el.textContent.trim());
        const sections = Array.from(document.querySelectorAll("section.card")).filter((s) => s.querySelector(".habit-group"));
        const contents = sections.map((s) => Array.from(s.querySelectorAll(".habit-title")).map((t) => t.textContent.trim()));
        const nums = Array.from(document.querySelectorAll(".habit-num")).map((n) => n.textContent.trim());
        return { groups, contents, nums, habitRows: document.querySelectorAll(".habit").length };
      });
      assert(JSON.stringify(res.groups) === JSON.stringify(["Food", "Drinks", "Body"]), "three group headers in order, got: " + JSON.stringify(res.groups));
      assert(res.contents[0] && res.contents[0][0] === "Protein at every meal" && res.contents[0].length === 5, "Food holds the five food habits, got: " + JSON.stringify(res.contents[0]));
      assert(res.contents[1] && res.contents[1].length === 2, "Drinks holds two habits, got: " + JSON.stringify(res.contents[1]));
      assert(res.contents[2] && res.contents[2].length === 3, "Body holds three habits, got: " + JSON.stringify(res.contents[2]));
      assert(res.habitRows === 10, "all 10 habit rows render, got " + res.habitRows);
      assert(JSON.stringify(res.nums) === JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]), "numbering runs 1-10 across the groups, got: " + JSON.stringify(res.nums));
      // One tick per group still works end-to-end. (Assert each flag FLIPS:
      // the shared profile may legitimately start with a tick already on.)
      const before = await page.evaluate(() => ({ p: !!getDayF(todayStr, "proteinB"), d: !!getDayF(todayStr, "drinks"), w: !!getDayF(todayStr, "workoutOff") }));
      await page.evaluate(() => document.querySelector('[data-act="tick"][data-f="proteinB"]').click());
      await page.evaluate(() => document.querySelector('[data-act="tick"][data-f="drinks"]').click());
      await page.evaluate(() => document.querySelector('[data-act="tick"][data-f="workoutOff"]').click());
      await wait(300);
      const flags = await page.evaluate(() => ({ p: !!getDayF(todayStr, "proteinB"), d: !!getDayF(todayStr, "drinks"), w: !!getDayF(todayStr, "workoutOff") }));
      assert(flags.p === !before.p && flags.d === !before.d && flags.w === !before.w, "ticks in all three groups should toggle, before: " + JSON.stringify(before) + " after: " + JSON.stringify(flags));
      await page.close();
    });
  }

  /* ============ v25 item 4: sticky score strip (pure CSS) ============ */
  if (run("v25i4")) {
    await test("r14.v25i4.sticky-score-strip", async () => {
      const page = await freshPage(browser);
      // State-isolate like bf6/v25i3 (shared profile, TESTMODE leaks).
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate(() => { ui.tab = "today"; saveUi(); render(true); });
      await wait(300);
      const res = await page.evaluate(() => {
        const strip = document.querySelector(".score-strip");
        const sc = scoreDay(todayStr);
        return {
          exists: !!strip,
          pos: strip ? getComputedStyle(strip).position : null,
          text: strip ? strip.textContent.trim() : null,
          exp: sc ? sc.score + "/" + sc.of : null
        };
      });
      assert(res.exists, "a score strip should render on Today");
      assert(res.pos === "sticky", "the strip must be pure-CSS sticky (no scroll listeners), got position: " + res.pos);
      assert(res.text && res.exp && res.text.indexOf(res.exp) === 0, "strip should lead with the live score '" + res.exp + "', got: " + JSON.stringify(res.text));
      // Scroll: the strip pins to the top of the viewport.
      await page.evaluate(() => window.scrollTo(0, 900));
      await wait(350);
      const pin = await page.evaluate(() => {
        const strip = document.querySelector(".score-strip");
        const r = strip ? strip.getBoundingClientRect() : null;
        return { top: r ? r.top : null, bottom: r ? r.bottom : null };
      });
      assert(pin.top !== null && pin.top >= -1 && pin.top <= 2 && pin.bottom > 10, "after scrolling, the strip should be pinned at the viewport top, got: " + JSON.stringify(pin));
      // Ticking updates the strip's number (it re-renders with the score).
      await page.evaluate(() => window.scrollTo(0, 0));
      await wait(200);
      const before = await page.evaluate(() => document.querySelector(".score-strip").textContent.trim());
      await page.evaluate(() => { const b = document.querySelector('[data-act="tick"]:not([disabled])'); if (b) b.click(); });
      await wait(350);
      const after = await page.evaluate(() => {
        const strip = document.querySelector(".score-strip");
        const sc = scoreDay(todayStr);
        return { text: strip ? strip.textContent.trim() : null, exp: sc ? sc.score + "/" + sc.of : null };
      });
      assert(after.text && after.text.indexOf(after.exp) === 0, "strip should reflect the score after a tick, got: " + JSON.stringify(after));
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("==== R14 suite (" + section + ", width " + WIDTH + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
