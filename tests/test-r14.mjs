/* Steady BUG-FIX BATCH (post-v23) suite.
   Sections: bf1 (kashrus rebuild pairing) | bf2 (top-up Yom Tov walk) |
             bf3 (stale-save guard) | bf4 (rest-day leftovers) |
             bf5 (broth split) | bf6 (failed-save status) |
             bf7 (copy fixes) | bf8 (screen-reader labels) |
             bf10 (calendar data) | bf11 (fast / Nine Days rules) |
             v25i1 (compact Today hero) | v25i2 (On-the-plan above habits) |
             v25i3 (habit group sections) | v25i4 (sticky score strip) |
             v27a1 (Today inline check-in flow) |
             v27a2 (per-meal seconds taps) |
             v27a3 (planned-meal wording) |
             v27a4 (explicit No grey style + scoring regression) |
             v29a (recipe library: generation uses recipes only, old meals render marked)
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
      const page = await freshPage(browser);
      // Weeks from the app's own todayStr (real clock minus 4h), never from
      // the test runner's clock: the two disagree between midnight and 4am.
      const { sunS, monS } = await page.evaluate(() => {
        const sun = addDays(weekSunday(todayStr), 7);
        return { sunS: sun, monS: addDays(sun, 1) };
      });
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
      // v27a migration: Today is now the inline check-in, and the real
      // date (Saturday) is a rest screen — so pin a Wednesday fake and
      // drive the edit through the flow's real Yes button. Intent
      // unchanged: a real edit through a real control must report a
      // failed save honestly, with Mark's wording + Try again.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      await page.evaluate(() => {
        // Seed everything answered except noAlcohol, so the flow opens on it.
        const f = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "workoutOff", "bed"].forEach((k) => { f[k] = { v: true, ts: 1 }; });
        f.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f };
        saveLocal(); try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
      await page.evaluate(() => {
        const orig = Storage.prototype.setItem;
        window.__origSetItem = orig;
        Storage.prototype.setItem = function (k, v) {
          if (k === "steady.state") { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
          return orig.call(this, k, v);
        };
        ui.tab = "today"; saveUi(); render(true);
      });
      // A real edit through a real control: answer the noAlcohol question Yes.
      // (The "noAlcohol" question is used because no day rule ever removes it.)
      await page.waitForSelector('[data-act="checkin-yes"]', { timeout: 15000 });
      await page.evaluate(() => document.querySelector('[data-act="checkin-yes"]').click());
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
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
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
        // Weeks from the app's own todayStr, not the real clock: the app's
        // today runs 4h behind, so the two disagree between midnight and 4am.
        const cur = weekSunday(todayStr);
        const nxt = addDays(cur, 7);
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
      // Weeks from the app's own todayStr (real clock minus 4h), never from
      // the test runner's clock: the two disagree between midnight and 4am.
      const { cur, nxt } = await page.evaluate(() => {
        const cur = weekSunday(todayStr);
        return { cur, nxt: addDays(cur, 7) };
      });
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
      // Check-in inputs carry explicit labels. (v27a migration: pin a
      // Wednesday fake — on a real Saturday the weigh-in inputs don't
      // render because Today is a rest screen. TESTMODE is read at load,
      // so the fake needs a reload to take effect.)
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      const ci = await page.evaluate(() => {
        ui.tab = "today"; saveUi(); render(true);
        const w = document.getElementById("ciWeight"), wa = document.getElementById("ciWaist");
        return { w: w && w.getAttribute("aria-label"), wa: wa && wa.getAttribute("aria-label") };
      });
      assert(ci.w && ci.wa, "weight/waist inputs should have aria-labels, got: " + JSON.stringify(ci));
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
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
      const outs = await seededGen(page, ctx, { pro: ["chicken", "stew", "yogurt", "salmon", "schnitzel"] }, seeds200);
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
      // Wait for the Today render to settle (not a blind 350ms): on a slow
      // runner the flow card may not exist yet when the read runs.
      await page.waitForFunction(() => document.querySelector(".checkin-card") || document.querySelector(".checkin-done") || document.querySelector(".rest-score"), { timeout: 10000 });
      // v27a migration: Today is now the inline check-in, so the
      // breakfast/lunch questions must be ABSENT from the flow (not
      // merely disabled ticks), and the dinner questions must lead it.
      const res = await page.evaluate(() => {
        const card = document.querySelector(".checkin-card");
        const q = card ? card.querySelector(".checkin-q") : null;
        return {
          card: !!card,
          firstQ: q ? q.textContent.trim() : null,
          fields: checkinQuestions("2027-07-22").map((x) => x.field),
          sel: selDate, today: todayStr
        };
      });
      assert(res.card, "a minor fast day should still show the check-in flow, selDate=" + res.sel + " todayStr=" + res.today);
      assert(res.firstQ === "Protein at dinner?", "the fast-day flow should lead with the dinner question, got: " + JSON.stringify(res.firstQ));
      assert(res.fields.indexOf("proteinB") < 0 && res.fields.indexOf("proteinL") < 0 && res.fields.indexOf("vegL") < 0,
        "breakfast/lunch meal questions should be skipped on a minor fast, got: " + JSON.stringify(res.fields));
      assert(res.fields.indexOf("proteinD") >= 0 && res.fields.indexOf("vegD") >= 0,
        "the dinner (break-fast) questions should stay live, got: " + JSON.stringify(res.fields));
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ v25 item 1: compact Today hero ============ */
  if (run("v25i1")) {
    await test("r14.v25i1.compact-hero-summary-row", async () => {
      const page = await freshPage(browser);
      // v27a migration: pin a Wednesday fake — on a real Saturday Today
      // is a rest screen with no score line.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
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
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ v25 item 2: On-the-plan above the habits ============ */
  if (run("v25i2")) {
    await test("r14.v25i2.plan-card-above-habits", async () => {
      const page = await freshPage(browser);
      // v27a migration: pin a Wednesday fake (a real Saturday is a rest
      // screen) and seed the day fully answered, so the checklist renders
      // below the plan card instead of the check-in flow.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate(() => {
        const f = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "workoutOff", "bed"].forEach((k) => { f[k] = { v: true, ts: 1 }; });
        f.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f };
        try { delete ui.checkin; } catch (e) {}
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
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ v25 item 3: habits grouped Food / Drinks / Body ============ */
  if (run("v25i3")) {
    await test("r14.v25i3.habit-groups", async () => {
      const page = await freshPage(browser);
      // Shared profile: an earlier section may leave a TESTMODE fake (e.g. a
      // fast day, which disables proteinB). v27a migration: pin a Wednesday
      // fake (a real Saturday is a rest screen) and seed the day fully
      // answered, so the checklist renders instead of the check-in flow.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      await page.evaluate(() => {
        const f = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "workoutOff", "bed"].forEach((k) => { f[k] = { v: true, ts: 1 }; });
        f.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f };
        saveLocal(); try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
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
      // One control per group still works end-to-end. (Assert each flag FLIPS,
      // and Drinks water rises by exactly one; the shared profile may
      // legitimately start with a tick already on.)
      const before = await page.evaluate(() => ({ p: !!getDayF(todayStr, "proteinB"), water: getDayF(todayStr, "water"), w: !!getDayF(todayStr, "workoutOff") }));
      await page.evaluate(() => document.querySelector('[data-act="tick"][data-f="proteinB"]').click());
      await page.evaluate(() => document.querySelector('[data-act="water-plus"]').click());
      await page.evaluate(() => document.querySelector('[data-act="tick"][data-f="workoutOff"]').click());
      await wait(300);
      const flags = await page.evaluate(() => ({ p: !!getDayF(todayStr, "proteinB"), water: getDayF(todayStr, "water"), w: !!getDayF(todayStr, "workoutOff") }));
      assert(flags.p === !before.p && flags.w === !before.w && flags.water === (before.water || 0) + 1, "controls in all three groups should toggle, before: " + JSON.stringify(before) + " after: " + JSON.stringify(flags));
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ v25 item 4: sticky score strip (pure CSS) ============ */
  if (run("v25i4")) {
    await test("r14.v25i4.sticky-score-strip", async () => {
      const page = await freshPage(browser);
      // State-isolate like bf6/v25i3 (shared profile, TESTMODE leaks).
      // v27a migration: pin a Wednesday fake (a real Saturday is a rest
      // screen, which has no score strip) and seed the day fully answered,
      // so the checklist ticks exist for the strip-update step.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate(() => {
        const f = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "workoutOff", "bed"].forEach((k) => { f[k] = { v: true, ts: 1 }; });
        f.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f };
        saveLocal(); try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
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
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ v26 item 1: Tomorrow line + thaw reminder ============ */
  if (run("v26i1")) {
    await test("r14.v26i1.tomorrow-line-and-thaw", async () => {
      const page = await freshPage(browser);
      // Pin TESTMODE to Wednesday 2026-10-21 so tomorrow (Thu 10-22) is a
      // normal planned day. On the real today (a Friday) tomorrow is
      // Shabbos, when the block correctly never renders.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      // Pick, from the data itself, one Thursday dinner that needs a freezer
      // thaw and one that doesn't. The thaw computation is the week's plan
      // as made from its prep day (ctx.today before the week — see the
      // item-1 note on the board): prep() re-bases to today for a current
      // week, which would hide a Sunday-frozen portion's thaw entirely.
      const pick = await page.evaluate(() => {
        const wk = "2026-10-18", base = planCtx(wk);
        const ctx = Object.assign({}, base, { today: "2026-10-17" });
        function thawsFor(meal) {
          const cells = { pro: [meal.p], m4D: { id: meal.id } };
          return PLAN_ENGINE.prep(ctx, cells, getSetting("prepDay")).midweek.thaws.filter((t) => t.dow === 4);
        }
        let frozen = null, fresh = null;
        for (const m of Object.values(PLAN_DATA.MEALS)) {
          if ((m.s || "").indexOf("D") < 0) continue;
          const th = thawsFor(m);
          if (th.length && !frozen) frozen = { id: m.id, p: m.p, n: m.n };
          if (!th.length && !fresh) fresh = { id: m.id, p: m.p, n: m.n };
          if (frozen && fresh) break;
        }
        return { frozen, fresh };
      });
      assert(pick.frozen, "test data should contain a dinner needing a Thursday thaw");
      assert(pick.fresh, "test data should contain a dinner with no Thursday thaw");
      const seed = async (meal) => {
        await page.evaluate((fz) => {
          const wk = "2026-10-18";
          const lunch = Object.values(PLAN_DATA.MEALS).find((m) => (m.s || "").indexOf("L") >= 0);
          state.plans[wk] = { f: { pro: { v: [lunch.p, fz.p], ts: 1 } } };
          state.plans[wk].f.m3L = { v: { id: lunch.id }, ts: 1 };
          state.plans[wk].f.m4D = { v: { id: fz.id }, ts: 1 };
          saveLocal(); ui.tab = "today"; saveUi(); render(true);
        }, meal);
        await wait(300);
      };
      const read = () => page.evaluate(() => {
        const card = Array.from(document.querySelectorAll("section.card")).find((s) => { const h = s.querySelector("h3"); return h && h.textContent === "On the plan"; });
        const tmr = card ? card.querySelector(".tmr") : null;
        const th = tmr ? tmr.querySelector(".tmr-thaw") : null;
        return { card: !!card, tmr: !!tmr, text: tmr ? tmr.textContent : "", thaw: !!th, thawText: th ? th.textContent.trim() : "" };
      });
      await seed(pick.frozen);
      let res = await read();
      assert(res.card && res.tmr, "the Tomorrow block should render inside On the plan");
      assert(res.text.indexOf(pick.frozen.n) >= 0, "tomorrow's dinner should show, got: " + res.text);
      assert(res.thaw, "the thaw line should show when a freezer portion is due tomorrow");
      assert(res.text.indexOf("Tonight:") >= 0, "the thaw line should read as a tonight action, got: " + res.text);
      const thawText1 = res.thawText;
      // Swap in the no-thaw dinner: block stays, thaw line goes.
      await seed(pick.fresh);
      res = await read();
      assert(res.tmr && res.text.indexOf(pick.fresh.n) >= 0, "tomorrow's dinner should update after the swap");
      assert(!res.thaw, "no thaw line when nothing needs thawing for tomorrow");
      // Tomorrow = rest day (fake Friday 2026-10-23): no block at all.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-23", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate(() => {
        const lunch = Object.values(PLAN_DATA.MEALS).find((m) => (m.s || "").indexOf("L") >= 0);
        const wk = "2026-10-18";
        state.plans[wk] = state.plans[wk] || { f: {} };
        state.plans[wk].f.pro = { v: [lunch.p], ts: 1 };
        state.plans[wk].f.m5L = { v: { id: lunch.id }, ts: 1 };
        saveLocal(); ui.tab = "today"; saveUi(); render(true);
      });
      await wait(300);
      res = await read();
      assert(!res.tmr, "no Tomorrow block when tomorrow is a rest day");
      // Tab's added assert (6375571990): Today's Tonight line and the Plan
      // tab's Thaw reminders must agree. Two halves:
      // (a) Non-vacuous cross-check — the Thursday thaw from the Wednesday
      //     scenario above must appear, same words, in the Plan tab's own
      //     Thaw reminders for that week (viewed on prep day, Sunday).
      // (b) On prep day itself both surfaces agree about tomorrow: with
      //     current data no Monday thaw exists (every freezable component
      //     keeps >= 1 day), so both must list none for Monday.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-18", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate((fz) => {
        const wk = "2026-10-18";
        const lunch = Object.values(PLAN_DATA.MEALS).find((m) => (m.s || "").indexOf("L") >= 0);
        state.plans[wk] = { f: { pro: { v: [lunch.p, fz.p], ts: 1 } } };
        state.plans[wk].f.m0L = { v: { id: lunch.id }, ts: 1 };
        state.plans[wk].f.m1D = { v: { id: fz.id }, ts: 1 };
        state.plans[wk].f.m4D = { v: { id: fz.id }, ts: 1 };
        saveLocal(); ui.tab = "today"; saveUi(); render(true);
      }, pick.frozen);
      await wait(300);
      res = await read();
      assert(res.tmr && res.text.indexOf(pick.frozen.n) >= 0, "on prep day the Tomorrow block should show Monday's dinner");
      assert(!res.thaw, "on prep day, Today must list no thaw for Monday (agreeing with the Plan tab)");
      const planThaws = await page.evaluate(() => {
        ui.tab = "plan"; ui.planStep = "prep"; ui.planWs = "2026-10-18"; saveUi(); render(true);
        const heads = Array.from(document.querySelectorAll("h4"));
        const th = heads.find((x) => x.textContent === "Thaw reminders");
        if (!th) return { found: false, rows: [] };
        const rows = [];
        let el = th.nextElementSibling;
        while (el && el.tagName !== "H4") { rows.push(el.textContent.trim()); el = el.nextElementSibling; }
        return { found: true, rows };
      });
      assert(planThaws.found, "the Plan tab should render its Thaw reminders list for this week");
      const core = thawText1.replace(/^❄\s*/, "").replace(/^Tonight: move /, "Move ");
      assert(planThaws.rows.some((r) => r.indexOf(core) >= 0), "the Plan tab's Thaw reminders should list the same thaw as Today's Tonight line ('" + core + "'), rows: " + JSON.stringify(planThaws.rows));
      assert(!planThaws.rows.some((r) => r.indexOf("Monday") >= 0), "the Plan tab should list no Monday thaw (agreeing with Today on prep day)");
      // Clean up the fake so later sections see the real date, and delete
      // the seeded week plan: meal wording (v27a item 3) makes plan state
      // visible on Today, so a leaked plan would rewrite later sections'
      // expected question texts.
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} try { delete state.plans["2026-10-18"]; saveLocal(); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ v26 item 2: tap a meal on Today -> recipe/ingredients ============ */
  if (run("v26i2")) {
    await test("r14.v26i2.today-meal-accordion", async () => {
      const page = await freshPage(browser);
      // State-isolate like bf6/v25i3 (shared profile, TESTMODE leaks).
      // v27a migration: pin a Wednesday fake — a real Saturday is a rest
      // screen with no On-the-plan card.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      // Seed today's lunch + dinner from the data (meals with a method and
      // at least two resolvable ingredients). v28d: linked meals show the
      // link instead of the method, so pick unlinked meals here — the
      // linked rendering is covered by r13.v28d.
      const seedInfo = await page.evaluate(() => {
        const wk = weekSunday(todayStr), dow = dowOf(todayStr);
        const pickFor = (slot) => Object.values(PLAN_DATA.MEALS).find((m) => (m.s || "").indexOf(slot) >= 0 && !m.src && m.how && (m.ing || []).filter((p) => PLAN_DATA.ITEMS[p[0]]).length >= 2);
        const lunch = pickFor("L"), dinner = pickFor("D");
        state.plans[wk] = { f: { pro: { v: [lunch.p, dinner.p], ts: 1 } } };
        state.plans[wk].f["m" + dow + "L"] = { v: { id: lunch.id }, ts: 1 };
        state.plans[wk].f["m" + dow + "D"] = { v: { id: dinner.id }, ts: 1 };
        saveLocal(); ui.tab = "today"; saveUi(); render(true);
        return {
          lk: "m" + dow + "L", dk: "m" + dow + "D",
          dHow: dinner.how, dIng: PLAN_DATA.ITEMS[dinner.ing[0][0]][0],
          lHow: lunch.how
        };
      });
      await wait(300);
      const state1 = () => page.evaluate(() => {
        const card = Array.from(document.querySelectorAll("section.card")).find((s) => { const h = s.querySelector("h3"); return h && h.textContent === "On the plan"; });
        const det = card ? card.querySelector(".meal-detail") : null;
        return {
          btns: card ? card.querySelectorAll('[data-act="today-meal"]').length : 0,
          detail: !!det,
          detailText: det ? det.textContent : ""
        };
      });
      let st = await state1();
      assert(st.btns === 2, "both of today's meal lines should be tappable buttons, got: " + st.btns);
      assert(!st.detail, "no recipe should be expanded before any tap");
      // Tap dinner (real DOM click on the button).
      await page.evaluate((k) => document.querySelector('[data-act="today-meal"][data-k="' + k + '"]').click(), seedInfo.dk);
      await wait(300);
      st = await state1();
      assert(st.detail, "tapping dinner should expand its recipe");
      assert(st.detailText.indexOf(seedInfo.dHow.slice(0, 24)) >= 0, "the expansion should show the meal's method, got: " + st.detailText.slice(0, 120));
      assert(st.detailText.indexOf(seedInfo.dIng) >= 0, "the expansion should list ingredient names (first: " + seedInfo.dIng + "), got: " + st.detailText.slice(0, 200));
      // Tap lunch: dinner closes, lunch opens (one at a time).
      await page.evaluate((k) => document.querySelector('[data-act="today-meal"][data-k="' + k + '"]').click(), seedInfo.lk);
      await wait(300);
      st = await state1();
      assert(st.detail && st.detailText.indexOf(seedInfo.lHow.slice(0, 24)) >= 0, "tapping lunch should open lunch's recipe");
      assert(st.detailText.indexOf(seedInfo.dHow.slice(0, 24)) < 0, "dinner's recipe should be closed once lunch opens");
      // Tap lunch again: collapses.
      await page.evaluate((k) => document.querySelector('[data-act="today-meal"][data-k="' + k + '"]').click(), seedInfo.lk);
      await wait(300);
      st = await state1();
      assert(!st.detail, "tapping the open meal again should collapse it");
      // v26i2 seeds the Oct-18 plan; clean it so later sections (v27a) see no stale meal wording.
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} try { delete state.plans["2026-10-18"]; saveLocal(); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ v26 item 3: completion moment at a full score ============ */
  if (run("v26i3")) {
    await test("r14.v26i3.completion-moment", async () => {
      const page = await freshPage(browser);
      // Pin TESTMODE to Wednesday 2026-10-21 (a plain 10-point day).
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      // Seed the day one tick short of full: everything except "bed".
      const pre = await page.evaluate(() => {
        const f = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "workoutOff"].forEach((k) => { f[k] = { v: true, ts: 1 }; });
        f.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f };
        saveLocal(); try { delete ui.checkin; } catch (e) {}
        try { delete ui.celebratedDate; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
        const sc = scoreDay("2026-10-21");
        return { score: sc.score, of: sc.of, celebrated: ui.celebratedDate || null, stripMoment: !!document.querySelector(".score-strip.moment") };
      });
      assert(pre.of === 10 && pre.score === 9, "precondition: seeded day should be 9/10, got " + JSON.stringify(pre));
      assert(!pre.stripMoment, "no moment before the day completes");
      // The final answer, via the flow's real Yes button (v27a: the
      // checklist tick is hidden while the flow is active, and the bed
      // question is the only unanswered one, so the flow opens on it).
      const flowQ = await page.evaluate(() => { const q = document.querySelector(".checkin-q"); return q ? q.textContent.trim() : null; });
      assert(flowQ === "In bed by midnight?", "the flow should open on the one unanswered question (bed), got: " + JSON.stringify(flowQ));
      await page.evaluate(() => document.querySelector('[data-act="checkin-yes"]').click());
      await wait(350);
      const post = await page.evaluate(() => {
        const strip = document.querySelector(".score-strip");
        const banner = document.querySelector(".banner.full");
        const sc = scoreDay("2026-10-21");
        return {
          score: sc.score, of: sc.of,
          stripMoment: !!document.querySelector(".score-strip.moment"),
          bannerMoment: !!document.querySelector(".banner.full.moment"),
          bannerText: banner ? banner.textContent.trim() : null,
          celebrated: ui.celebratedDate || null
        };
      });
      assert(post.score === 10 && post.of === 10, "the bed tick should complete the day, got " + JSON.stringify(post));
      assert(post.stripMoment, "the score strip should carry the one-time moment class on the completing render");
      assert(post.bannerMoment, "the full-day banner should carry the moment class on the completing render");
      assert(post.bannerText === "All 10. That's a full day.", "banner copy must be unchanged, got: " + JSON.stringify(post.bannerText));
      assert(post.celebrated === "2026-10-21", "the celebrated flag should be recorded for the date");
      // Reload: the day is still full, but the moment must not replay.
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await page.evaluate(() => { ui.tab = "today"; saveUi(); render(true); });
      await wait(300);
      const again = await page.evaluate(() => ({ stripMoment: !!document.querySelector(".score-strip.moment"), banner: !!document.querySelector(".banner.full") }));
      assert(!again.stripMoment, "the moment must not replay on reload");
      assert(again.banner, "the static full-day banner should still show after reload");
      // Reduced-motion: the CSS must disable the moment animation.
      const css = await page.evaluate(() => fetch("styles.css").then((r) => r.text()));
      assert(css.indexOf("prefers-reduced-motion") >= 0, "styles.css should honor prefers-reduced-motion");
      assert(css.indexOf(".score-strip.moment") >= 0, "styles.css should define the strip moment animation");
      // Clean up the fake so later sections see the real date.
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }
  if (run("v27a1")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    // r14 sections share one browser profile: reset the day record and any
    // stored flow state so earlier tests cannot leak answers into this one.
    const resetDay = async (page, date) => page.evaluate((d) => {
      state.days[d] = { f: {} }; saveLocal();
      try { delete ui.checkin; } catch (e) {}
      ui.tab = "today"; saveUi(); render(true);
    }, date);
    const flowState = (page) => page.evaluate(() => {
      const card = document.querySelector(".checkin-card");
      const q = card ? card.querySelector(".checkin-q") : null;
      const prog = card ? card.querySelector(".checkin-progress") : null;
      return {
        card: !!card,
        q: q ? q.textContent.trim() : null,
        prog: prog ? prog.textContent.trim() : null,
        back: !!(card && card.querySelector('[data-act="checkin-back"]')),
        skip: !!(card && card.querySelector('[data-act="checkin-skip"]')),
        yes: !!(card && card.querySelector('[data-act="checkin-yes"]')),
        no: !!(card && card.querySelector('[data-act="checkin-no"]')),
        habits: !!document.querySelector(".habit"),
        checkinBtn: !!document.querySelector('[data-act="checkin-open"]'),
        forwardBtn: !!document.querySelector('[data-act="checkin-forward"]'),
        selDate
      };
    });

    await test("r14.v27a1.flow-nav-skip-loop-complete", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21"); // Wednesday, plain day
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      await resetDay(page, "2026-10-21");
      let s = await flowState(page);
      assert(s.card, "today with unanswered questions should show the inline question card, got " + JSON.stringify(s));
      assert(s.q === "Protein at breakfast?", "first question should be breakfast protein, got " + JSON.stringify(s.q));
      assert(s.prog === "1 of 12", "progress should be 1 of 12 on a plain day, got " + JSON.stringify(s.prog));
      assert(s.skip && s.yes && s.no, "Q1 needs Yes/No/Skip");
      assert(!s.back, "Q1 must show Skip only, no Back");
      assert(!s.forwardBtn, "Forward must not appear during today's active flow");
      assert(!s.habits, "the habit checklist must be hidden while the flow is active");
      // Yes advances to Q2 with Back.
      await click(page, '[data-act="checkin-yes"]');
      s = await flowState(page);
      assert(s.q === "Protein at lunch?" && s.prog === "2 of 12", "Yes should advance to Q2, got " + JSON.stringify(s));
      assert(s.back, "Q2 onward must show Back");
      // Back returns to Q1; Skip it; Q2 again.
      await click(page, '[data-act="checkin-back"]');
      s = await flowState(page);
      assert(s.q === "Protein at breakfast?" && s.prog === "1 of 12", "Back should return to Q1, got " + JSON.stringify(s));
      await click(page, '[data-act="checkin-skip"]');
      s = await flowState(page);
      assert(s.q === "Protein at lunch?", "Skip should move to Q2, got " + JSON.stringify(s));
      // Answer Q2..Q13 Yes (12 clicks): the loop must return to skipped Q1.
      for (let i = 0; i < 11; i++) await click(page, '[data-act="checkin-yes"]');
      s = await flowState(page);
      assert(s.card && s.q === "Protein at breakfast?", "after the last question the loop must return to skipped Q1, got " + JSON.stringify(s));
      // Answer looped Q1: completed state.
      await click(page, '[data-act="checkin-yes"]');
      // v27b5: the flow's last step is the optional note — skip it to reach the checklist.
      await click(page, '[data-act="checkin-note-skip"]');
      s = await flowState(page);
      assert(!s.card && s.habits, "after the loop the checklist should show, got " + JSON.stringify(s));
      assert(s.checkinBtn && s.forwardBtn, "completed today needs Check-in + Forward buttons");
      // v27b2: the flow no longer asks drinks, so a full day needs the
      // water counter at goal before it can score 10/10.
      for (let i = 0; i < 8; i++) await click(page, '[data-act="water-plus"]');
      const done = await page.evaluate(() => {
        const sc = scoreDay("2026-10-21");
        const banner = document.querySelector(".banner.full");
        return { score: sc.score, of: sc.of, banner: banner ? banner.textContent.trim() : null, proteinB: getDayF("2026-10-21", "proteinB"), steps: getDayF("2026-10-21", "steps") };
      });
      assert(done.score === 10 && done.of === 10, "all-Yes day should score 10/10, got " + JSON.stringify(done));
      assert(done.banner === "All 10. That's a full day.", "full-day banner copy unchanged, got " + JSON.stringify(done.banner));
      assert(done.steps === 7500, "steps Yes should write the default goal, got " + JSON.stringify(done.steps));
      // Check-in reopens at Q1 (nothing unanswered).
      await click(page, '[data-act="checkin-open"]');
      s = await flowState(page);
      assert(s.card && s.q === "Protein at breakfast?", "Check-in should reopen at Q1 when all answered, got " + JSON.stringify(s));
      await clearFake(page);
    });

    await test("r14.v27a1.skip-twice-stays-unanswered", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      await resetDay(page, "2026-10-21");
      for (let i = 0; i < 11; i++) await click(page, '[data-act="checkin-yes"]');
      // Q12 (bed): skip, loop back, skip again -> completed with bed unanswered.
      await click(page, '[data-act="checkin-skip"]');
      let s = await flowState(page);
      assert(s.card && s.q === "In bed by midnight?", "loop should return to skipped bed question, got " + JSON.stringify(s));
      await click(page, '[data-act="checkin-skip"]');
      // v27b5: the flow's last step is the optional note — skip it to reach the checklist.
      await click(page, '[data-act="checkin-note-skip"]');
      s = await flowState(page);
      assert(!s.card && s.habits, "after the second skip the checklist should show");
      const sc = await page.evaluate(() => { const r = scoreDay("2026-10-21"); return { score: r.score, of: r.of, bed: getDayF("2026-10-21", "bed") }; });
      assert(sc.score === 8 && sc.bed === undefined, "twice-skipped bed stays unanswered at 8/10 (drinks, no longer asked, is also unanswered), got " + JSON.stringify(sc));
      await click(page, '[data-act="checkin-open"]');
      s = await flowState(page);
      assert(s.card && s.q === "In bed by midnight?", "Check-in should reopen at the first unanswered question, got " + JSON.stringify(s));
      await clearFake(page);
    });

    await test("r14.v27a1.earlier-day-checklist-and-forward", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await resetDay(page, "2026-10-20");
      await resetDay(page, "2026-10-21");
      await click(page, '[data-act="dot"][data-date="2026-10-20"]');
      let s = await flowState(page);
      assert(!s.card && s.habits && s.selDate === "2026-10-20", "an earlier day should show its checklist, not the flow, got " + JSON.stringify(s));
      assert(s.forwardBtn && s.checkinBtn, "an earlier day needs Forward + Check-in buttons");
      await click(page, '[data-act="checkin-forward"]');
      s = await flowState(page);
      assert(s.selDate === "2026-10-21" && s.card, "Forward should advance to today and its flow, got " + JSON.stringify(s));
      await click(page, '[data-act="dot"][data-date="2026-10-20"]');
      await click(page, '[data-act="checkin-open"]');
      s = await flowState(page);
      assert(s.card && s.q === "Protein at breakfast?", "Check-in on an earlier day should open its flow, got " + JSON.stringify(s));
      await clearFake(page);
    });

    await test("r14.v27a1.applicability-pre-fast-tisha", async () => {
      const page = await freshPage(browser);
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      const qs = await page.evaluate(() => {
        const probes = {
          preFri: isPreRest("2026-10-23"), fastSun: isFastDay("2026-12-20"), tisha: isTishaBav("2026-07-23")
        };
        const fields = (d) => checkinQuestions(d).map((q) => q.field);
        return { probes, pre: fields("2026-10-23"), fast: fields("2026-12-20"), tisha: fields("2026-07-23") };
      });
      assert(qs.probes.preFri, "2026-10-23 should be a pre-rest Friday, got " + JSON.stringify(qs.probes));
      assert(JSON.stringify(qs.pre) === JSON.stringify(["proteinB", "proteinL", "vegL", "noAlcohol", "steps", "workout"]),
        "pre-rest questions should be daytime only, got " + JSON.stringify(qs.pre));
      assert(qs.probes.fastSun, "2026-12-20 should be a minor fast day, got " + JSON.stringify(qs.probes));
      assert(JSON.stringify(qs.fast) === JSON.stringify(["proteinD", "vegD", "treat", "kitchenClosed", "noAlcohol", "steps", "bed"]),
        "fast-day questions should be dinner + non-meal habits, got " + JSON.stringify(qs.fast));
      assert(qs.probes.tisha, "2026-07-23 should be Tisha B'Av, got " + JSON.stringify(qs.probes));
      assert(JSON.stringify(qs.tisha) === JSON.stringify(["treat", "kitchenClosed", "noAlcohol", "steps", "bed"]),
        "Tisha B'Av questions should exclude all meal questions, got " + JSON.stringify(qs.tisha));
      await page.close();
    });

    await test("r14.v27a1.steps-workout-no-semantics", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      await page.evaluate(() => {
        state.days["2026-10-21"] = { f: { steps: { v: 3000, ts: 1 } } };
        saveLocal();
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
      // Q1..Q9 Yes -> steps question (Q10).
      for (let i = 0; i < 9; i++) await click(page, '[data-act="checkin-yes"]');
      let s = await flowState(page);
      assert(s.q === "Hit your step goal?", "Q11 should be the steps question, got " + JSON.stringify(s));
      await click(page, '[data-act="checkin-no"]');
      const afterNo = await page.evaluate(() => ({ steps: getDayF("2026-10-21", "steps"), stepsNo: getDayF("2026-10-21", "stepsNo") }));
      assert(afterNo.steps === 3000 && afterNo.stepsNo === true, "steps No must keep the partial count and record the No, got " + JSON.stringify(afterNo));
      s = await flowState(page);
      assert(s.q === "Workout done?", "steps No should advance to workout, got " + JSON.stringify(s));
      await click(page, '[data-act="checkin-no"]');
      const w = await page.evaluate(() => {
        const sc = scoreDay("2026-10-21");
        return { workout: getDayF("2026-10-21", "workout"), workoutOff: getDayF("2026-10-21", "workoutOff"), wItem: sc.items.workout, sItem: sc.items.steps, score: sc.score };
      });
      assert(w.workout === false && !w.workoutOff && w.wItem === false && w.sItem === false,
        "workout No must be an explicit No that does not score, got " + JSON.stringify(w));
      await click(page, '[data-act="checkin-yes"]'); // bed
      const fin = await page.evaluate(() => scoreDay("2026-10-21"));
      assert(fin.score === 7 && fin.of === 10, "day should finish 7/10 with steps+workout Nos (and drinks, no longer asked, unanswered), got " + JSON.stringify(fin));
      await clearFake(page);
    });
  }
  if (run("v27a2")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    const resetDay = async (page, date) => page.evaluate((d) => {
      state.days[d] = { f: {} }; saveLocal();
      try { delete ui.checkin; } catch (e) {}
      ui.tab = "today"; saveUi(); render(true);
    }, date);
    const secRow = (page) => page.evaluate(() => {
      const card = document.querySelector(".checkin-card");
      const row = card ? card.querySelector(".seconds-row") : null;
      const q = card ? card.querySelector(".checkin-q") : null;
      return {
        row: !!row,
        plus: !!(row && row.querySelector('[data-act="seconds-plus"]')),
        minus: !!(row && row.querySelector('[data-act="seconds-minus"]')),
        text: row ? row.textContent.replace(/\s+/g, " ").trim() : null,
        q: q ? q.textContent.trim() : null
      };
    });

    await test("r14.v27a2.per-meal-taps-independent", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await resetDay(page, "2026-10-21");
      let r = await secRow(page);
      assert(r.q === "Protein at breakfast?" && r.plus, "breakfast protein question should carry a + seconds tap, got " + JSON.stringify(r));
      await click(page, '[data-act="seconds-plus"][data-meal="B"]');
      await click(page, '[data-act="seconds-plus"][data-meal="B"]');
      await click(page, '[data-act="seconds-minus"][data-meal="B"]');
      r = await secRow(page);
      assert(r.text && r.text.indexOf("1 at this meal") >= 0, "two taps minus one should leave 1 breakfast second, got " + JSON.stringify(r));
      const b1 = await page.evaluate(() => ({ b: getDayF("2026-10-21", "secondsB"), week: secondsWeekTotal("2026-10-21") }));
      assert(b1.b === 1 && b1.week === 1, "breakfast tap should store secondsB=1 and week total 1, got " + JSON.stringify(b1));
      // Lunch is independent; veg questions carry no seconds row.
      await click(page, '[data-act="checkin-yes"]'); // proteinB -> proteinL
      r = await secRow(page);
      assert(r.q === "Protein at lunch?" && r.plus, "lunch protein question should carry its own tap, got " + JSON.stringify(r));
      await click(page, '[data-act="seconds-plus"][data-meal="L"]');
      const bl = await page.evaluate(() => ({ b: getDayF("2026-10-21", "secondsB"), l: getDayF("2026-10-21", "secondsL"), week: secondsWeekTotal("2026-10-21") }));
      assert(bl.b === 1 && bl.l === 1 && bl.week === 2, "lunch tap must not touch breakfast, week total 2, got " + JSON.stringify(bl));
      await click(page, '[data-act="checkin-yes"]'); // proteinL -> proteinD
      await click(page, '[data-act="checkin-yes"]'); // proteinD -> vegL
      r = await secRow(page);
      assert(r.q === "Veggies at lunch?" && !r.row, "veg questions must not carry a seconds row, got " + JSON.stringify(r));
      await clearFake(page);
    });

    await test("r14.v27a2.legacy-seconds-counts-as-one", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await page.evaluate(() => {
        state.days["2026-10-19"] = { f: { seconds: { v: true, ts: 1 } } }; // Monday, legacy only
        state.days["2026-10-20"] = { f: { seconds: { v: true, ts: 1 }, secondsB: { v: 1, ts: 1 } } }; // both: per-meal wins, no double count
        state.days["2026-10-21"] = { f: { secondsB: { v: 2, ts: 1 } } };
        saveLocal(); ui.tab = "today"; saveUi(); render(true);
      });
      const tot = await page.evaluate(() => ({
        mon: secondsDayTotal("2026-10-19"), tue: secondsDayTotal("2026-10-20"),
        wed: secondsDayTotal("2026-10-21"), week: secondsWeekTotal("2026-10-21")
      }));
      assert(tot.mon === 1, "legacy seconds=true should count as 1, got " + JSON.stringify(tot));
      assert(tot.tue === 1, "a day with both legacy and per-meal taps must not double count, got " + JSON.stringify(tot));
      assert(tot.wed === 2 && tot.week === 4, "week total should be 1+1+2=4, got " + JSON.stringify(tot));
      await clearFake(page);
    });

    await test("r14.v27a2.old-card-gone-done-line-kept", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      await resetDay(page, "2026-10-21");
      for (let i = 0; i < 12; i++) await click(page, '[data-act="checkin-yes"]');
      // v27b5: the flow's last step is the optional note — skip it to reach the done card.
      await click(page, '[data-act="checkin-note-skip"]');
      const res = await page.evaluate(() => ({
        oldTick: !!document.querySelector('[data-act="tick"][data-f="seconds"]'),
        oldTitle: !!Array.from(document.querySelectorAll("section.card b")).find((b) => b.textContent.trim() === "Had seconds"),
        doneLine: (document.querySelector(".checkin-done") || {}).textContent || ""
      }));
      assert(!res.oldTick, "the standalone seconds tick must be gone");
      assert(!res.oldTitle, "the standalone 'Had seconds' card must be gone");
      assert(res.doneLine.indexOf("Seconds:") >= 0 && res.doneLine.indexOf("About 2 a week is fine") >= 0,
        "the done card should keep the week count + note, got: " + JSON.stringify(res.doneLine));
      await clearFake(page);
    });
  }
  if (run("v27a3")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };

    await test("r14.v27a3.meal-wording-planned-generic-veg", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21"); // Wednesday
      const names = await page.evaluate(() => {
        const wk = "2026-10-18"; // week Sunday of the fake Wednesday
        const lunch = Object.values(PLAN_DATA.MEALS).find((m) => (m.s || "").indexOf("L") >= 0);
        const tueDinner = Object.values(PLAN_DATA.MEALS).find((m) => (m.s || "").indexOf("D") >= 0);
        state.plans[wk] = { f: {
          pro: { v: [lunch.p, tueDinner.p], ts: 1 },
          m3L: { v: { id: lunch.id }, ts: 1 },
          m2D: { v: { id: tueDinner.id }, ts: 1 },
          m3D: { v: { lo: 1 }, ts: 1 }
        } };
        state.days["2026-10-21"] = { f: {} };
        saveLocal();
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
        const qs = checkinQuestions("2026-10-21");
        const byField = {};
        qs.forEach((q) => { byField[q.field] = q.text; });
        return { lunch: lunch.n, tueDinner: tueDinner.n, byField };
      });
      // Direct: wording comes from the plan, veg stays generic.
      assert(names.byField.proteinL === "Lunch: " + names.lunch + ". On plan?",
        "lunch protein question should name the planned meal, got: " + JSON.stringify(names.byField.proteinL));
      assert(names.byField.proteinD === "Dinner: Leftovers: " + names.tueDinner + ". On plan?",
        "dinner protein question should name the leftover meal, got: " + JSON.stringify(names.byField.proteinD));
      assert(names.byField.proteinB === "Protein at breakfast?",
        "breakfast has no planned meal and stays generic, got: " + JSON.stringify(names.byField.proteinB));
      assert(names.byField.vegL === "Veggies at lunch?" && names.byField.vegD === "Veggies at dinner?",
        "veg questions stay generic even with a plan, got: " + JSON.stringify({ l: names.byField.vegL, d: names.byField.vegD }));
      // Through the flow: Q2 shows the lunch wording.
      await click(page, '[data-act="checkin-yes"]'); // breakfast -> lunch
      const q2 = await page.evaluate(() => { const q = document.querySelector(".checkin-q"); return q ? q.textContent.trim() : null; });
      assert(q2 === "Lunch: " + names.lunch + ". On plan?", "flow Q2 should show the lunch wording, got: " + JSON.stringify(q2));
      // Generic fallback: a week with no plan at all.
      const fb = await page.evaluate(() => {
        const qs = checkinQuestions("2026-10-28"); // next Wednesday, no plan seeded
        const byField = {};
        qs.forEach((q) => { byField[q.field] = q.text; });
        return byField;
      });
      assert(fb.proteinL === "Protein at lunch?" && fb.proteinD === "Protein at dinner?",
        "without a plan the meal questions fall back to generic wording, got: " + JSON.stringify({ l: fb.proteinL, d: fb.proteinD }));
      // Clean up the seeded week plan so later sections see generic wording.
      await page.evaluate(() => { try { delete state.plans["2026-10-18"]; saveLocal(); } catch (e) {} });
      await clearFake(page);
    });
  }
  if (run("v27a4")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };

    await test("r14.v27a4.grey-no-style", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await page.evaluate(() => {
        const f = {};
        ["proteinL", "proteinD", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "bed", "workoutOff"].forEach((k) => { f[k] = { v: true, ts: 1 }; });
        f.proteinB = { v: false, ts: 1 };
        f.vegL = { v: false, ts: 1 };
        f.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f };
        saveLocal();
        try { delete ui.checkin; } catch (e) {}
        try { delete ui.celebratedDate; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
      // Done mode (all answered) -> checklist ticks carry the grey no-style
      // exactly on the explicitly-false fields.
      const cls = await page.evaluate(() => {
        const c = (f) => { const b = document.querySelector('[data-act="tick"][data-f="' + f + '"]'); return b ? b.className : null; };
        return { pB: c("proteinB"), pL: c("proteinL"), vL: c("vegL"), bed: c("bed") };
      });
      assert(cls.pB && cls.pB.indexOf("no") >= 0 && cls.pB.indexOf("on") < 0, "explicit-No proteinB tick should be grey, got: " + JSON.stringify(cls.pB));
      assert(cls.vL && cls.vL.indexOf("no") >= 0, "explicit-No vegL tick should be grey, got: " + JSON.stringify(cls.vL));
      assert(cls.pL && cls.pL.indexOf("on") >= 0 && cls.pL.indexOf("no") < 0, "Yes proteinL tick should be green, not grey, got: " + JSON.stringify(cls.pL));
      assert(cls.bed && cls.bed.indexOf("on") >= 0, "Yes bed tick should be green, got: " + JSON.stringify(cls.bed));
      // Flow: reopening Check-in shows the No answer grey on Q1.
      await click(page, '[data-act="checkin-open"]');
      const flowBtns = await page.evaluate(() => {
        const card = document.querySelector(".checkin-card");
        const yes = card ? card.querySelector('[data-act="checkin-yes"]') : null;
        const no = card ? card.querySelector('[data-act="checkin-no"]') : null;
        return { q: card ? card.querySelector(".checkin-q").textContent.trim() : null, yes: yes ? yes.className : null, no: no ? no.className : null };
      });
      assert(flowBtns.q === "Protein at breakfast?", "Check-in should reopen at Q1, got: " + JSON.stringify(flowBtns.q));
      assert(flowBtns.no && flowBtns.no.indexOf("no") >= 0, "flow No button should be grey for the answered No, got: " + JSON.stringify(flowBtns.no));
      assert(flowBtns.yes && flowBtns.yes.indexOf("on") < 0, "flow Yes button should not be highlighted for a No answer, got: " + JSON.stringify(flowBtns.yes));
      await clearFake(page);
    });

    await test("r14.v27a4.scoring-regression-and-old-data", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      // Alcohol defaults off; this test needs it asked (see item 3).
      await page.evaluate(() => { opSettings("alcoholOn", true); });
      // A day of explicit Nos: scores 0, is not "logged", and is treated
      // exactly like an unanswered day by the never-miss-twice rule.
      const sc = await page.evaluate(() => {
        const f = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "bed", "workout", "workoutOff"].forEach((k) => { f[k] = { v: false, ts: 1 }; });
        f.stepsNo = { v: true, ts: 1 };
        state.days["2026-10-21"] = { f };
        state.days["2026-10-20"] = { f: {} };
        saveLocal(); ui.tab = "today"; saveUi(); render(true);
        const allNo = scoreDay("2026-10-21"), empty = scoreDay("2026-10-20");
        return {
          allNo: { score: allNo.score, of: allNo.of, logged: allNo.logged, ratio: allNo.ratio },
          empty: { score: empty.score, of: empty.of, logged: empty.logged, ratio: empty.ratio }
        };
      });
      assert(sc.allNo.score === 0 && sc.allNo.of === 10 && sc.allNo.logged === false,
        "a day of explicit Nos must score 0/10 and not count as logged, got: " + JSON.stringify(sc.allNo));
      assert(sc.empty.score === 0 && sc.empty.logged === false && sc.empty.ratio === sc.allNo.ratio,
        "an unanswered day must get the same never-miss-twice treatment as an all-No day, got: " + JSON.stringify(sc.empty));
      // Old data: true stays done, missing stays unanswered (never No).
      const old = await page.evaluate(() => {
        state.days["2026-10-21"] = { f: { proteinB: { v: true, ts: 1 } } };
        saveLocal();
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
        const card = document.querySelector(".checkin-card");
        const yes = card ? card.querySelector('[data-act="checkin-yes"]') : null;
        const no = card ? card.querySelector('[data-act="checkin-no"]') : null;
        return {
          pB: checkinAnswer("2026-10-21", { field: "proteinB" }),
          pL: checkinAnswer("2026-10-21", { field: "proteinL" }),
          q: card ? card.querySelector(".checkin-q").textContent.trim() : null,
          yesOn: !!(yes && yes.className.indexOf("on") >= 0),
          noGrey: !!(no && no.className.indexOf("no") >= 0)
        };
      });
      assert(old.pB === "yes" && old.pL === null, "old true stays done and old missing stays unanswered, got: " + JSON.stringify(old));
      assert(old.q === "Protein at lunch?", "the flow should open at the first unanswered question, got: " + JSON.stringify(old.q));
      assert(!old.yesOn && !old.noGrey, "an unanswered question must show neither Yes nor No highlighted, got: " + JSON.stringify(old));
      // A flow No writes an explicit false (strict), and does not score.
      await click(page, '[data-act="checkin-no"]');
      const noW = await page.evaluate(() => ({
        v: getDayF("2026-10-21", "proteinL"),
        proteinItem: scoreDay("2026-10-21").items.protein
      }));
      assert(noW.v === false && noW.proteinItem === false, "a flow No must store false and not score, got: " + JSON.stringify(noW));
      await clearFake(page);
    });
  }
  if (run("v27b1")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    const resetDay = async (page, date) => page.evaluate((d) => {
      state.days[d] = { f: {} }; saveLocal();
      try { delete ui.checkin; } catch (e) {}
      ui.tab = "today"; saveUi(); render(true);
    }, date);
    const flowState = (page) => page.evaluate(() => {
      const card = document.querySelector(".checkin-card");
      const q = card ? card.querySelector(".checkin-q") : null;
      return { card: !!card, q: q ? q.textContent.trim() : null, selDate };
    });

    await test("r14.v27b1.catchup-friday-then-sunday", async () => {
      const page = await freshPage(browser);
      // Clear leaked seeds from earlier sections inside the 7-day window.
      await resetDay(page, "2026-10-19");
      await resetDay(page, "2026-10-20");
      await resetDay(page, "2026-10-21");
      await setFake(page, "2026-10-25"); // Sunday, plain day
      await page.evaluate(() => {
        const full = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "workoutOff", "bed"].forEach((k) => { full[k] = { v: true, ts: 1 }; });
        full.steps = { v: 9000, ts: 1 };
        state.days["2026-10-22"] = { f: full };
        const fri = {};
        ["proteinB", "proteinL", "vegL", "drinks", "noAlcohol"].forEach((k) => { fri[k] = { v: true, ts: 1 }; });
        fri.steps = { v: 9000, ts: 1 };
        // workout left unanswered: Friday's first unanswered question.
        state.days["2026-10-23"] = { f: fri };
        state.days["2026-10-25"] = { f: {} };
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
      await wait(350);
      let s = await flowState(page);
      assert(s.card, "Sunday evening should open on Friday's flow, got " + JSON.stringify(s));
      assert(s.selDate === "2026-10-23", "catch-up should open on Friday, got " + JSON.stringify(s.selDate));
      assert(s.q === "Workout done?", "Friday's first unanswered question should be the workout, got " + JSON.stringify(s.q));
      // Answering Friday's last question completes it: the chain moves to
      // Sunday (today), skipping Shabbos (Sat Oct 24) entirely.
      await click(page, '[data-act="checkin-yes"]');
      s = await flowState(page);
      assert(s.selDate === "2026-10-25", "after Friday, the flow should move to Sunday, got " + JSON.stringify(s.selDate));
      assert(s.q === "Protein at breakfast?", "Sunday's flow should start at breakfast protein, got " + JSON.stringify(s.q));
      const done = await page.evaluate(() => getDayF("2026-10-23", "flowDone"));
      assert(done === true, "completing Friday's flow should mark it handled, got " + JSON.stringify(done));
      await resetDay(page, "2026-10-22");
      await resetDay(page, "2026-10-23");
      await resetDay(page, "2026-10-25");
      await clearFake(page);
    });
  }
  if (run("v27b2")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    const resetDay = async (page, date) => page.evaluate((d) => {
      state.days[d] = { f: {} }; saveLocal();
      try { delete ui.checkin; } catch (e) {}
      ui.tab = "today"; saveUi(); render(true);
    }, date);
    const flowState = (page) => page.evaluate(() => {
      const card = document.querySelector(".checkin-card");
      const q = card ? card.querySelector(".checkin-q") : null;
      return { card: !!card, q: q ? q.textContent.trim() : null, selDate };
    });
    const waterState = (page, scope) => page.evaluate((sc) => {
      const root = sc ? document.querySelector(sc) : document;
      const plus = root ? root.querySelector('[data-act="water-plus"]') : null;
      const minus = root ? root.querySelector('[data-act="water-minus"]') : null;
      const cnt = root ? root.querySelector(".water-count") : null;
      return {
        plus: !!plus, minus: !!minus,
        text: cnt ? cnt.textContent.trim() : null,
        on: cnt ? cnt.className.indexOf("on") >= 0 : false,
        water: getDayF(selDate, "water"),
        drinks: scoreDay(selDate).items.drinks
      };
    }, scope || null);

    await test("r14.v27b2.checklist-counter-and-scoring", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      // Fully answered except drinks: done mode, so the checklist (and its
      // counter) shows instead of the flow.
      await page.evaluate(() => {
        const full = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "noAlcohol", "workoutOff", "bed"].forEach((k) => { full[k] = { v: true, ts: 1 }; });
        full.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f: full };
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
      await wait(350);
      let w = await waterState(page);
      assert(w.plus && !w.minus && w.text === "0 of 8 cups" && w.water === undefined && w.drinks === false,
        "untouched water should show 0 of 8 cups with no minus, drinks unscored-as-0, got " + JSON.stringify(w));
      await click(page, '[data-act="water-plus"]');
      w = await waterState(page);
      assert(w.text === "1 of 8 cups" && w.minus && w.water === 1 && w.drinks === false,
        "one tap should show 1 of 8 cups with a minus, drinks still 0, got " + JSON.stringify(w));
      await click(page, '[data-act="water-minus"]');
      w = await waterState(page);
      assert(w.text === "0 of 8 cups" && !w.minus && w.water === 0 && w.drinks === false,
        "minus should return to 0 (water now governs, drinks stays 0), got " + JSON.stringify(w));
      for (let i = 0; i < 8; i++) await click(page, '[data-act="water-plus"]');
      w = await waterState(page);
      assert(w.text === "8 of 8 cups" && w.on && w.water === 8 && w.drinks === true,
        "8 taps should reach goal with done styling and drinks true, got " + JSON.stringify(w));
      await click(page, '[data-act="water-plus"]');
      w = await waterState(page);
      assert(w.text === "9 of 8 cups" && w.on && w.water === 9 && w.drinks === true,
        "taps past goal should keep counting and stay done, got " + JSON.stringify(w));
      // Old data: drinks=true with no water keeps its score until touched.
      await page.evaluate(() => {
        const full = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "workoutOff", "bed"].forEach((k) => { full[k] = { v: true, ts: 1 }; });
        full.steps = { v: 9000, ts: 1 };
        state.days["2026-10-21"] = { f: full };
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
      await wait(350);
      w = await waterState(page);
      assert(w.text === "0 of 8 cups" && w.drinks === true,
        "an old drinks=true day should keep its score with no water tapped, got " + JSON.stringify(w));
      await click(page, '[data-act="water-plus"]');
      w = await waterState(page);
      assert(w.water === 1 && w.drinks === false,
        "once water is tapped it governs: 1 cup under goal scores drinks 0, got " + JSON.stringify(w));
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b2.flow-counter-today", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await resetDay(page, "2026-10-21");
      await wait(350);
      let s = await flowState(page);
      assert(s.card && s.q === "Protein at breakfast?", "today's flow should open at Q1, got " + JSON.stringify(s));
      let w = await waterState(page, ".checkin-card");
      assert(w.plus, "the flow card should carry its own water counter, got " + JSON.stringify(w));
      await click(page, '.checkin-card [data-act="water-plus"]');
      w = await waterState(page, ".checkin-card");
      s = await flowState(page);
      assert(w.water === 1 && s.card && s.q === "Protein at breakfast?",
        "a flow tap should log water without moving the question, got " + JSON.stringify({ w, s }));
      await click(page, '.checkin-card [data-act="water-minus"]');
      w = await waterState(page, ".checkin-card");
      assert(w.water === 0, "flow minus should return water to 0, got " + JSON.stringify(w));
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b2.flow-counter-catchup-day", async () => {
      const page = await freshPage(browser);
      await resetDay(page, "2026-10-19");
      await resetDay(page, "2026-10-20");
      await resetDay(page, "2026-10-21");
      await setFake(page, "2026-10-25"); // Sunday, plain day
      await page.evaluate(() => {
        const full = {};
        ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "workoutOff", "bed"].forEach((k) => { full[k] = { v: true, ts: 1 }; });
        full.steps = { v: 9000, ts: 1 };
        state.days["2026-10-22"] = { f: full };
        const fri = {};
        ["proteinB", "proteinL", "vegL", "noAlcohol"].forEach((k) => { fri[k] = { v: true, ts: 1 }; });
        fri.steps = { v: 9000, ts: 1 };
        // workout left unanswered: Friday's first unanswered question.
        state.days["2026-10-23"] = { f: fri };
        state.days["2026-10-25"] = { f: {} };
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      });
      await wait(350);
      let s = await flowState(page);
      assert(s.card && s.selDate === "2026-10-23" && s.q === "Workout done?",
        "the chain should open on Friday's workout, got " + JSON.stringify(s));
      await click(page, '.checkin-card [data-act="water-plus"]');
      const got = await page.evaluate(() => ({ fri: getDayF("2026-10-23", "water"), sun: getDayF("2026-10-25", "water") }));
      assert(got.fri === 1 && got.sun === undefined,
        "a chain-day tap should log Friday's water, not Sunday's, got " + JSON.stringify(got));
      await resetDay(page, "2026-10-22");
      await resetDay(page, "2026-10-23");
      await resetDay(page, "2026-10-25");
      await clearFake(page);
    });

    await test("r14.v27b2.no-counter-on-rest", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-24"); // Saturday, Shabbos
      await wait(350);
      const has = await page.evaluate(() => !!document.querySelector('[data-act="water-plus"]'));
      assert(!has, "a rest day should show no water counter");
      await clearFake(page);
    });
  }
  if (run("v27b3")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    const resetDay = async (page, date) => page.evaluate((d) => {
      state.days[d] = { f: {} }; saveLocal();
      try { delete ui.checkin; } catch (e) {}
      ui.tab = "today"; saveUi(); render(true);
    }, date);
    const seedDone = (page) => page.evaluate(() => {
      const full = {};
      ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "noAlcohol", "workoutOff", "bed"].forEach((k) => { full[k] = { v: true, ts: 1 }; });
      full.steps = { v: 9000, ts: 1 };
      state.days["2026-10-21"] = { f: full };
      try { delete ui.checkin; } catch (e) {}
      ui.tab = "today"; saveUi(); render(true);
    });
    const setSettings = async (page, goal, unit, coffee) => {
      await click(page, "#gearBtn");
      await page.evaluate((g, u, c) => {
        document.getElementById("setWaterGoal").value = g;
        document.getElementById("setWaterUnit").value = u;
        document.getElementById("setCoffeeOn").checked = c;
      }, goal, unit, coffee);
      await click(page, "#setSave");
    };
    const counterText = (page, scope) => page.evaluate((sc) => {
      const root = sc ? document.querySelector(sc) : document;
      const cnt = root ? root.querySelector(".water-count") : null;
      return cnt ? cnt.textContent.trim() : null;
    }, scope || null);

    await test("r14.v27b3.defaults-and-wording", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await seedDone(page);
      await wait(350);
      const got = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll("section.card")).filter((s) => s.querySelector(".habit-group"));
        const drinks = sections.find((s) => (s.querySelector(".habit-group") || {}).textContent.trim() === "Drinks");
        return {
          text: (document.querySelector(".water-count") || {}).textContent || "",
          coffee: !!document.querySelector('[data-act="coffee"]'),
          drinksTitles: drinks ? Array.from(drinks.querySelectorAll(".habit-title")).map((t) => t.textContent.trim()) : []
        };
      });
      assert(got.text.trim() === "0 of 8 cups", "default goal should be 8 cups, got " + JSON.stringify(got.text));
      assert(!got.coffee, "coffee button should be off by default");
      assert(got.drinksTitles[0] === "Water" && !got.drinksTitles.includes("Seltzer or water"),
        "the drinks habit should be labeled just Water, got " + JSON.stringify(got.drinksTitles));
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b3.settings-coffee-and-flow", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await seedDone(page);
      await setSettings(page, 10, "oz", true);
      let text = await counterText(page);
      assert(text === "0 of 80 oz", "goal 10 in ounces should show 0 of 80 oz, got " + JSON.stringify(text));
      let hasCoffee = await page.evaluate(() => !!document.querySelector('[data-act="coffee"]'));
      assert(hasCoffee, "coffee button should appear when the toggle is on");
      await click(page, '[data-act="water-plus"]');
      text = await counterText(page);
      assert(text === "8 of 80 oz", "one tap in ounces should show 8 of 80 oz, got " + JSON.stringify(text));
      const sc0 = await page.evaluate(() => { const s = scoreDay("2026-10-21"); return { score: s.score, of: s.of }; });
      await click(page, '[data-act="coffee"]');
      let cf = await page.evaluate(() => ({
        coffee: getDayF("2026-10-21", "coffee"),
        on: (document.querySelector('[data-act="coffee"]') || {}).className || ""
      }));
      const sc1 = await page.evaluate(() => { const s = scoreDay("2026-10-21"); return { score: s.score, of: s.of }; });
      assert(cf.coffee === true && cf.on.indexOf("on") >= 0, "coffee tap should set coffee true with the button highlighted, got " + JSON.stringify(cf));
      assert(sc1.score === sc0.score && sc1.of === sc0.of, "coffee must not change the score, got " + JSON.stringify({ sc0, sc1 }));
      await click(page, '[data-act="coffee"]');
      cf = await page.evaluate(() => getDayF("2026-10-21", "coffee"));
      assert(cf === false, "a second coffee tap should toggle it off, got " + JSON.stringify(cf));
      // The flow card carries the coffee button too, for its own day.
      await click(page, '[data-act="checkin-open"]');
      await wait(350);
      const flow = await page.evaluate(() => {
        const card = document.querySelector(".checkin-card");
        const q = card ? card.querySelector(".checkin-q") : null;
        return { card: !!card, q: q ? q.textContent.trim() : null, coffee: !!(card && card.querySelector('[data-act="coffee"]')) };
      });
      assert(flow.card && flow.q === "Protein at breakfast?" && flow.coffee,
        "the flow card should carry the coffee button at Q1, got " + JSON.stringify(flow));
      await click(page, '.checkin-card [data-act="coffee"]');
      cf = await page.evaluate(() => getDayF("2026-10-21", "coffee"));
      assert(cf === true, "a flow coffee tap should log coffee for the flow day, got " + JSON.stringify(cf));
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b3.goal-drives-scoring", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await seedDone(page);
      await setSettings(page, 10, "cups", false);
      let text = await counterText(page);
      assert(text === "0 of 10 cups", "goal 10 in cups should show 0 of 10 cups, got " + JSON.stringify(text));
      let hasCoffee = await page.evaluate(() => !!document.querySelector('[data-act="coffee"]'));
      assert(!hasCoffee, "coffee button should hide when the toggle is off");
      for (let i = 0; i < 8; i++) await click(page, '[data-act="water-plus"]');
      let got = await page.evaluate(() => ({ text: (document.querySelector(".water-count") || {}).textContent.trim(), drinks: scoreDay("2026-10-21").items.drinks }));
      assert(got.text === "8 of 10 cups" && got.drinks === false,
        "8 cups under a 10 goal should still score drinks 0, got " + JSON.stringify(got));
      for (let i = 0; i < 2; i++) await click(page, '[data-act="water-plus"]');
      got = await page.evaluate(() => ({ text: (document.querySelector(".water-count") || {}).textContent.trim(), drinks: scoreDay("2026-10-21").items.drinks }));
      assert(got.text === "10 of 10 cups" && got.drinks === true,
        "reaching the 10 goal should score drinks true, got " + JSON.stringify(got));
      // Restore defaults so later sections start clean.
      await page.evaluate(() => { opSettings("waterGoal", 8); opSettings("waterUnit", "cups"); opSettings("coffeeOn", false); });
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b3.alcohol-toggle", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await seedDone(page);
      await wait(350);
      // Baseline: alcohol off by default — question absent, row hidden,
      // item unscored (8/9). The shared profile may carry alcoholOn=true
      // from earlier tests that enabled it, so drop the setting first to
      // observe the true fresh-profile default.
      await page.evaluate(() => { try { if (state.settings && state.settings.f) delete state.settings.f.alcoholOn; } catch (e) {} saveLocal(); render(true); });
      await wait(350);
      let base = await page.evaluate(() => {
        const s = scoreDay("2026-10-21");
        return {
          q: checkinQuestions("2026-10-21").map((x) => x.field),
          row: !!Array.from(document.querySelectorAll(".habit-title")).find((t) => t.textContent.trim() === "No alcohol"),
          score: s.score, of: s.of, item: s.items.noAlcohol,
          nums: Array.from(document.querySelectorAll(".habit-num")).map((n) => n.textContent.trim())
        };
      });
      assert(!base.q.includes("noAlcohol") && !base.row && base.item === null && base.score === 8 && base.of === 9,
        "baseline with alcohol off by default should unask, hide, and unscore it (8/9), got " + JSON.stringify(base));
      assert(JSON.stringify(base.nums) === JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8", "9"]),
        "numbering should stay contiguous with alcohol hidden, got " + JSON.stringify(base.nums));
      // Toggle on: question asked, row shown, item scored (9/10).
      await click(page, "#gearBtn");
      await page.evaluate(() => { document.getElementById("setAlcoholOn").checked = true; });
      await click(page, "#setSave");
      let on = await page.evaluate(() => {
        const s = scoreDay("2026-10-21");
        return {
          q: checkinQuestions("2026-10-21").map((x) => x.field),
          row: !!Array.from(document.querySelectorAll(".habit-title")).find((t) => t.textContent.trim() === "No alcohol"),
          score: s.score, of: s.of, item: s.items.noAlcohol,
          nums: Array.from(document.querySelectorAll(".habit-num")).map((n) => n.textContent.trim())
        };
      });
      assert(on.q.includes("noAlcohol") && on.row && on.item === true && on.score === 9 && on.of === 10,
        "alcohol on should ask, show, and score it (9/10), got " + JSON.stringify(on));
      assert(JSON.stringify(on.nums) === JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]),
        "numbering should run 1-10 with alcohol shown, got " + JSON.stringify(on.nums));
      // The flow includes it too: reopening shows 12 questions, starting at Q1.
      await click(page, '[data-act="checkin-open"]');
      await wait(350);
      const flow = await page.evaluate(() => {
        const card = document.querySelector(".checkin-card");
        const prog = card ? card.querySelector(".checkin-progress") : null;
        const q = card ? card.querySelector(".checkin-q") : null;
        return { card: !!card, prog: prog ? prog.textContent.trim() : null, q: q ? q.textContent.trim() : null };
      });
      assert(flow.card && flow.prog === "1 of 12" && flow.q === "Protein at breakfast?",
        "the flow should show 12 questions with alcohol on, got " + JSON.stringify(flow));
      // Restore OFF (the default) so later sections start clean.
      await click(page, "#gearBtn");
      await page.evaluate(() => { document.getElementById("setAlcoholOn").checked = false; });
      await click(page, "#setSave");
      const back = await page.evaluate(() => ({
        q: checkinQuestions("2026-10-21").map((x) => x.field),
        of: scoreDay("2026-10-21").of
      }));
      assert(!back.q.includes("noAlcohol") && back.of === 9, "restoring alcohol off should exclude it again, got " + JSON.stringify(back));
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });
  }

  /* ============ v27b item 4: Sunday weekly review ============ */
  if (run("v27b4")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    // Seed the Oct 11-17 week (fake today Wed Oct 21 => just-ended week is
    // Oct 11) plus clear Oct 4-10 so the prev-week figures are deterministic.
    const seedWeek = async (page) => {
      await page.evaluate(() => {
        ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
         "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"].forEach((d) => { state.days[d] = { f: {} }; });
        const full = (d, over) => {
          const f = {};
          ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "bed", "workoutOff"].forEach((k) => { f[k] = { v: true, ts: 1 }; });
          f.steps = { v: 9000, ts: 1 };
          Object.keys(over || {}).forEach((k) => { f[k] = over[k]; });
          state.days[d] = { f };
        };
        const num = (v) => ({ v, ts: 1 });
        const fals = (k) => ({ v: false, ts: 1 });
        full("2026-10-11", { water: num(8), secondsB: num(3) });
        full("2026-10-12", { treat: fals("treat"), water: num(8), secondsL: num(2) });
        full("2026-10-13", { treat: fals("treat"), water: num(5) });
        full("2026-10-14", { treat: fals("treat"), water: num(8) });
        full("2026-10-15", { steps: num(3000), drinks: num(true) });
        // Fri Oct 16 is pre-rest: only daytime habits apply.
        state.days["2026-10-16"] = { f: { proteinB: num(true), proteinL: num(true), vegL: num(true), workoutOff: num(true), steps: num(9000), water: num(10) } };
        saveLocal(); ui.tab = "today"; saveUi(); render(true);
      });
    };
    const resetWeek = async (page) => {
      await page.evaluate(() => {
        ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
         "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"].forEach((d) => { state.days[d] = { f: {} }; });
        saveLocal(); render(true);
      });
    };
    const reviewFigs = (page) => page.evaluate(() => {
      const t = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; };
      const next = document.querySelector('[data-act="review-next"]');
      return {
        week: t(".review-week"), score: t(".review-score"), seconds: t(".review-seconds"),
        water: t(".review-water"), missed: t(".review-missed"),
        nextDisabled: next ? next.disabled : null,
        days: Array.from(document.querySelectorAll(".review-day")).map((d) => d.textContent.trim())
      };
    });

    await test("r14.v27b4.figures-and-nav", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      // Alcohol off + goal 8 so the figures are deterministic regardless of
      // what earlier sections left in the shared profile.
      await page.evaluate(() => { opSettings("alcoholOn", false); opSettings("waterGoal", 8); });
      await seedWeek(page);
      await click(page, '[data-tab="review"]');
      let r = await reviewFigs(page);
      assert(r.week === "Week of Oct 11", "review should default to the just-ended week, got " + JSON.stringify(r));
      assert(r.score === "Score: 45 of 50", "week score should be 45 of 50, got " + JSON.stringify(r));
      assert(r.seconds === "Seconds: 5", "week seconds should be 5, got " + JSON.stringify(r));
      assert(r.water === "Water: 4 of 6 days at goal", "water should be 4 of 6 days at goal, got " + JSON.stringify(r));
      assert(r.missed && r.missed.includes("Treat") && r.missed.includes("3 of 5"),
        "most missed should be Treat 3 of 5, got " + JSON.stringify(r));
      assert(r.nextDisabled === true, "next should be disabled on the just-ended week, got " + JSON.stringify(r));
      assert(r.days.length === 7 && r.days[0].includes("9/9") && r.days[6].includes("rest"),
        "per-day lines should cover all 7 days with Sat as rest, got " + JSON.stringify(r.days));
      // Earlier week: empty, so all figures drop; tie-break picks Protein.
      // (Sun Oct 4 is itself Simchas Torah, a rest day, so this week has
      // 5 non-rest days: 4 plain x 9 + 1 pre-rest x 5 = 41.)
      await click(page, '[data-act="review-prev"]');
      r = await reviewFigs(page);
      assert(r.week === "Week of Oct 4", "prev should move to the Oct 4 week, got " + JSON.stringify(r));
      assert(r.score === "Score: 0 of 41", "empty week score should be 0 of 41, got " + JSON.stringify(r));
      assert(r.seconds === "Seconds: 0" && r.water === "Water: 0 of 5 days at goal",
        "empty week seconds/water should be 0, got " + JSON.stringify(r));
      assert(r.missed && r.missed.includes("Protein") && r.missed.includes("5 of 5"),
        "empty week most missed should be Protein 5 of 5, got " + JSON.stringify(r));
      assert(r.nextDisabled === false, "next should be enabled after moving back, got " + JSON.stringify(r));
      // Round-trip back to the just-ended week.
      await click(page, '[data-act="review-next"]');
      r = await reviewFigs(page);
      assert(r.week === "Week of Oct 11" && r.score === "Score: 45 of 50" && r.nextDisabled === true,
        "next should return to the just-ended week, got " + JSON.stringify(r));
      await resetWeek(page);
      await clearFake(page);
    });
  }

  /* ============ v27b item 5: one-line day note ============ */
  if (run("v27b5")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    const resetDay = async (page, date) => {
      await page.evaluate((date) => {
        state.days[date] = { f: {} }; saveLocal();
        try { delete ui.checkin; } catch (e) {}
        ui.tab = "today"; saveUi(); render(true);
      }, date);
    };
    const noteCard = (page) => page.evaluate(() => {
      const inp = document.querySelector("#checkinNote");
      return {
        input: !!inp, max: inp ? inp.getAttribute("maxlength") : null,
        save: !!document.querySelector('[data-act="checkin-note-save"]'),
        skip: !!document.querySelector('[data-act="checkin-note-skip"]')
      };
    });

    await test("r14.v27b5.flow-note-save-and-show", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await page.evaluate(() => { opSettings("alcoholOn", false); });
      await resetDay(page, "2026-10-21");
      for (let i = 0; i < 11; i++) await click(page, '[data-act="checkin-yes"]');
      const card = await noteCard(page);
      assert(card.input && card.max === "140" && card.save && card.skip,
        "after the last question the flow should offer a note step, got " + JSON.stringify(card));
      await page.evaluate(() => { document.getElementById("checkinNote").value = "Felt strong today"; });
      await click(page, '[data-act="checkin-note-save"]');
      const got = await page.evaluate(() => ({
        note: getDayF("2026-10-21", "note"),
        done: !!document.querySelector(".checkin-done"),
        section: (() => { const el = document.querySelector(".day-note-text"); return el ? el.textContent.trim() : null; })()
      }));
      assert(got.note === "Felt strong today", "saved note should persist, got " + JSON.stringify(got));
      assert(got.done, "flow should complete after saving the note, got " + JSON.stringify(got));
      assert(got.section === "Felt strong today", "the day view should show the note, got " + JSON.stringify(got));
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b5.flow-note-skip", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await page.evaluate(() => { opSettings("alcoholOn", false); });
      await resetDay(page, "2026-10-21");
      for (let i = 0; i < 11; i++) await click(page, '[data-act="checkin-yes"]');
      const card = await noteCard(page);
      assert(card.input, "note step should appear before skip, got " + JSON.stringify(card));
      await click(page, '[data-act="checkin-note-skip"]');
      const got = await page.evaluate(() => ({
        note: getDayF("2026-10-21", "note"),
        done: !!document.querySelector(".checkin-done")
      }));
      assert(got.note === undefined || got.note === null || got.note === "",
        "skipping must not store a note, got " + JSON.stringify(got));
      assert(got.done, "flow should complete after skipping the note, got " + JSON.stringify(got));
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b5.note-edit-on-past-day-and-cap", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await page.evaluate(() => {
        state.days["2026-10-20"] = { f: { note: { v: "Old note", ts: 1 } } };
        saveLocal(); ui.tab = "today"; saveUi(); render(true);
      });
      await click(page, '[data-act="day-prev"]');
      let sec = await page.evaluate(() => {
        const el = document.querySelector(".day-note-text");
        return { text: el ? el.textContent.trim() : null, edit: !!document.querySelector('[data-act="note-edit"]') };
      });
      assert(sec.text === "Old note" && sec.edit, "past day should show its note with Edit, got " + JSON.stringify(sec));
      await click(page, '[data-act="note-edit"]');
      const pre = await page.evaluate(() => {
        const inp = document.querySelector("#dayNoteInput");
        return inp ? inp.value : null;
      });
      assert(pre === "Old note", "edit should prefill the existing note, got " + JSON.stringify(pre));
      const long = "x".repeat(200);
      await page.evaluate((v) => { document.getElementById("dayNoteInput").value = v; }, long);
      await click(page, '[data-act="note-save"]');
      const got = await page.evaluate(() => ({
        note: getDayF("2026-10-20", "note"),
        text: (() => { const el = document.querySelector(".day-note-text"); return el ? el.textContent.trim() : null; })()
      }));
      assert(typeof got.note === "string" && got.note.length === 140 && got.note === long.slice(0, 140),
        "saved note must be capped at 140 chars, got length " + (got.note && got.note.length));
      assert(got.text === long.slice(0, 140), "day view should show the capped note, got " + JSON.stringify(got.text && got.text.length));
      await resetDay(page, "2026-10-20");
      await resetDay(page, "2026-10-21");
      await clearFake(page);
    });

    await test("r14.v27b5.review-shows-note", async () => {
      const page = await freshPage(browser);
      await setFake(page, "2026-10-21");
      await page.evaluate(() => {
        opSettings("alcoholOn", false);
        state.days["2026-10-14"] = { f: { note: { v: "Leg day", ts: 1 } } };
        saveLocal(); render(true);
      });
      await click(page, '[data-tab="review"]');
      const line = await page.evaluate(() => {
        const lines = Array.from(document.querySelectorAll(".review-day")).map((d) => d.textContent.trim());
        return lines.find((l) => l.includes("Oct 14")) || null;
      });
      assert(line && line.includes("Leg day"), "review line for Oct 14 should carry its note, got " + JSON.stringify(line));
      await resetDay(page, "2026-10-14");
      await clearFake(page);
    });
  }
  /* ============ v29a: recipe library replaces built-in meals ============ */
  if (run("v29a")) {
    const setFake = async (page, fake) => {
      await page.evaluate((f) => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {} }, fake);
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
    };
    const clearFake = async (page) => {
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    };
    const click = async (page, sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); await wait(350); };
    const SEED_PROS = ["chicken", "gbeef", "gturkey", "schnitzel", "stew", "salmon", "tuna", "whitefish", "eggs", "tofu", "legumes", "yogurt"];
    // v29b: the library grows past the 12 seed rows, so the test asserts the
    // seed set intact + a growing count, not an exact total.
    const SEED_IDS = ["r-chicken-shawarma-salad", "r-grandma-meatballs", "r-turkey-meatballs-spinach", "r-matzo-schnitzel", "r-bazin", "r-dry-rub-salmon", "r-provencal-tuna", "r-sheet-pan-fish-chips", "r-shakshuka-hummus", "r-thai-tofu-curry", "r-mujadara", "r-berry-yogurt-granola-parfait"];

    await test("r14.v29a.generation-uses-recipes-only", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc, pros, seedIds) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const RECIPES = PLAN_DATA.RECIPES || {};
        const byProtein = {};
        Object.keys(RECIPES).forEach((id) => { const p = RECIPES[id].p; byProtein[p] = (byProtein[p] || 0) + 1; });
        // candidates() is not exported; generation over seeds is the funnel check.
        let filled = 0, retiredSeen = [], nonRecipeSeen = [];
        for (let s = 1; s <= 200; s++) {
          const out = PLAN_ENGINE.generate(ctx, { pro: pros.slice() }, mulberry(s));
          Object.keys(out).forEach((k) => {
            const c = out[k];
            if (c && c.id) {
              filled++;
              const m = PLAN_DATA.MEALS[c.id];
              if (!m) nonRecipeSeen.push(c.id);
              else if (m.retired) retiredSeen.push(c.id);
              else if (!RECIPES[c.id]) nonRecipeSeen.push(c.id);
            }
          });
        }
        const old = PLAN_ENGINE.resolve(ctx, { m0L: { id: "c1" } }, "m0L");
        return {
          recipeCount: Object.keys(RECIPES).length,
          seedMissing: seedIds.filter((id) => !RECIPES[id]),
          byProtein, filled, retiredSeen: retiredSeen.slice(0, 5), nonRecipeSeen: nonRecipeSeen.slice(0, 5),
          oldResolves: !!(old && old.meal), oldRetired: !!(old && old.meal && old.meal.retired),
          oldName: old && old.meal ? old.meal.n : null
        };
      }, MULBERRY, SEED_PROS, SEED_IDS);
      assert(res.seedMissing.length === 0, "all 12 seed recipes must still resolve, missing " + JSON.stringify(res.seedMissing));
      assert(res.recipeCount >= 12, "library must hold at least the 12 seed recipes, got " + res.recipeCount);
      assert(res.byProtein.yogurt === 1 && res.byProtein.deli >= 1 && res.byProtein.deli < 5,
        "yogurt must have its seed recipe, deli sourced by B1 but still under Tab's 5-flag, got " + JSON.stringify(res.byProtein));
      assert(res.filled >= 200, "generated weeks must fill slots, got " + res.filled);
      assert(res.retiredSeen.length === 0, "generation must never return a retired meal, got " + JSON.stringify(res.retiredSeen));
      assert(res.nonRecipeSeen.length === 0, "generation must return recipe ids only, got " + JSON.stringify(res.nonRecipeSeen));
      assert(res.oldResolves && res.oldRetired, "saved old weeks must still resolve, marked retired, got " + JSON.stringify(res));
      await page.close();
    });

    await test("r14.v29a.old-meal-mark-and-recipe-card", async () => {
      const page = await freshPage(browser);
      const tw = await page.evaluate(() => {
        const tw = addDays(weekSunday(todayStr), 7);
        state.plans[tw] = { f: {
          pro: { v: ["chicken", "eggs"], ts: 1000 },
          m0L: { v: { id: "c1" }, ts: 1000 },
          m0D: { v: { id: "r-shakshuka-hummus" }, ts: 1000 }
        } };
        saveLocal(); ui.tab = "plan"; ui.planWs = tw; ui.planStep = "week"; saveUi(); render(true);
        return tw;
      });
      const cards = await page.evaluate(() => Array.from(document.querySelectorAll(".meal-card")).map((c) => c.textContent.replace(/\s+/g, " ").trim()));
      const oldCard = cards.find((t) => t.includes("Sheet-pan chicken"));
      assert(oldCard && oldCard.includes("old meal"), "saved old meal card must carry the old-meal mark, got " + JSON.stringify(cards));
      const recipeCard = cards.find((t) => t.includes("Shakshuka with Hummus"));
      assert(recipeCard && recipeCard.includes("serves 4"), "recipe card must show its servings, got " + JSON.stringify(cards));
      assert(recipeCard && recipeCard.includes("Recipe"), "recipe card must link its recipe, got " + JSON.stringify(cards));
      await page.evaluate((tw) => { delete state.plans[tw]; saveLocal(); }, tw);
      await page.close();
    });

    await test("r14.v29a.picker-excludes-retired", async () => {
      const page = await freshPage(browser);
      const tw = await page.evaluate(() => {
        const tw = addDays(weekSunday(todayStr), 7);
        state.plans[tw] = { f: {
          pro: { v: ["chicken", "salmon"], ts: 1000 },
          m0L: { v: { id: "r-chicken-shawarma-salad" }, ts: 1000 }
        } };
        saveLocal(); ui.tab = "plan"; ui.planWs = tw; ui.planStep = "week"; saveUi(); render(true);
        return tw;
      });
      await click(page, '.meal-card[data-act="meal-pick"]');
      const { opts, expectN } = await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll("#mpList .mp-opt[data-id]")).map((b) => ({ id: b.getAttribute("data-id"), retired: PLAN_DATA.MEALS[b.getAttribute("data-id")].retired }));
        const expectN = Object.keys(PLAN_DATA.MEALS).filter((id) => { const m = PLAN_DATA.MEALS[id]; return !m.retired && (m.p === "chicken" || m.p === "salmon") && m.s.indexOf("L") >= 0; }).length;
        return { opts, expectN };
      });
      const ids = opts.map((o) => o.id);
      assert(ids.length === expectN, "picker for chicken+salmon should list every non-retired chicken/salmon lunch recipe, got " + ids.length + " expected " + expectN + ": " + JSON.stringify(ids));
      assert(ids.includes("r-chicken-shawarma-salad") && ids.includes("r-dry-rub-salmon"),
        "picker must list recipes, got " + JSON.stringify(ids));
      assert(!ids.includes("c1") && opts.every((o) => !o.retired),
        "picker must never list a retired meal, got " + JSON.stringify(opts));
      await page.evaluate(() => { const d = document.getElementById("mealPickerDlg"); if (d && d.open) d.close(); });
      await page.evaluate((tw) => { delete state.plans[tw]; saveLocal(); }, tw);
      await page.close();
    });

    await test("r14.v29a.shopping-two-person-recipe-week", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const cells = { pro: ["eggs", "legumes"], bk: [], srvL: 2, srvD: 2,
          m0L: { id: "r-mujadara" }, m0D: { id: "r-shakshuka-hummus" } };
        const shop = PLAN_ENGINE.shopping(ctx, cells);
        const line = (id) => {
          for (const sec of shop.sections) for (const l of sec.lines) if (l.id === id) return l;
          return null;
        };
        return { eggs: line("eggs"), lentils: line("lentils") };
      });
      assert(res.eggs && res.eggs.amount === 3 && res.eggs.qty === "6 eggs",
        "2-person shakshuka week must total 3 eggs (shown as 6), got " + JSON.stringify(res.eggs));
      assert(res.lentils && Math.abs(res.lentils.amount - 0.3) < 0.01,
        "2-person mujadara week must total 0.3 lentils (1 cup / 7 servings = 0.15/person x 2), got " + JSON.stringify(res.lentils));
      await page.close();
    });

    await test("r14.v29a.prep-attaches-protein-component", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const chickenPrep = PLAN_DATA.MEALS["r-chicken-shawarma-salad"].prep || [];
        const salmonPrep = PLAN_DATA.MEALS["r-dry-rub-salmon"].prep || [];
        const prep = PLAN_ENGINE.prep(ctx, { pro: ["chicken"], bk: [], m0D: { id: "r-chicken-shawarma-salad" } }, 0);
        return {
          chickenPrep, salmonPrep,
          stepTitles: (prep.steps || []).map((s) => s.title)
        };
      });
      assert(res.chickenPrep.includes("chicken"), "chicken recipe must carry its protein COMP component, got " + JSON.stringify(res.chickenPrep));
      assert(res.salmonPrep.length === 0, "salmon has no same-named COMP, so its recipe carries no prep component, got " + JSON.stringify(res.salmonPrep));
      assert(res.stepTitles.includes("Chicken"), "prep timeline for a chicken recipe week must include the Chicken step, got " + JSON.stringify(res.stepTitles));
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("==== R14 suite (" + section + ", width " + WIDTH + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
