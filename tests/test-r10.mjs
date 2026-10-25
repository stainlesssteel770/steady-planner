/* Steady BETA BATCH 1 (steady-v19) suite — real buttons throughout.
   Sections: extra (item 1) | yomtov (item 2) | phantom (item 3) |
             fish (item 4) | toast (item 5) | layout (item 6) | scroll (item 7)
   Usage: node test-r10.mjs [section|all]   (WIDTH=360 for the narrow runs) */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

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
/* Pick a log date the extra-counter tests can score against: not a rest
   day and not a pre-rest day (mealsPlan is unscored on pre-rest days).
   v27b item 4 fix: start from yesterday, never today — since v27a, today
   with unanswered questions shows the check-in flow, not the checklist,
   so the extras buttons would not exist. Also enable alcohol: the
   noAlcohol row (and its drink extras) is hidden by default since item 3. */
const pickLogDate = (page) => page.evaluate(() => {
  opSettings("alcoholOn", true);
  let d = addDays(todayStr, -1), guard = 0;
  while ((isRest(d) || isPreRest(d)) && guard++ < 10) d = addDays(d, -1);
  state.days = {}; saveLocal();
  selDate = d; ui.tab = "today"; saveUi(); render(true);
  return d;
});
const clickBtn = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.click();
  return true;
}, sel);
const habitText = (page, title) => page.evaluate((title) => {
  const els = [...document.querySelectorAll(".habit")];
  const h = els.find((e) => (e.querySelector(".habit-title") || {}).textContent === title);
  return h ? h.textContent : null;
}, title);
const seedPlan = (page, week, cells) => page.evaluate((week, cells) => {
  state.plans[week] = { f: {} };
  Object.keys(cells).forEach((k) => { state.plans[week].f[k] = { v: cells[k], ts: 1000 }; });
  saveLocal();
}, week, cells);
const gotoPlan = (page, week, step) => page.evaluate((week, step) => {
  ui.tab = "plan"; ui.planWs = week; ui.planStep = step; saveUi(); render(true);
}, week, step);
const weeksOf = (page) => page.evaluate(() => { const tw = weekSunday(todayStr); return { tw, nw: addDays(tw, 7) }; });

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ================= Item 1: extra counters on habits #3 and #7 ================= */
  if (run("extra")) {
    await test("r10.extra.snack-button-counts-and-scores", async () => {
      const page = await freshPage(browser);
      const d = await pickLogDate(page);
      assert(await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'), "Extra snack button missing on #3");
      await wait(150);
      assert(await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'), "Extra snack button gone after 1 tap");
      await wait(200);
      const got = await page.evaluate((d) => ({
        n: getDayF(d, "snackX"), ticked: !!getDayF(d, "mealsPlan"),
        item: scoreDay(d) ? scoreDay(d).items.mealsPlan : null,
      }), d);
      assert(got.n === 2, "snackX should be 2, got " + JSON.stringify(got));
      assert(!got.ticked, "mealsPlan must not be ticked by extras");
      assert(got.item === true, "extras must count #3 as checked, got " + JSON.stringify(got));
      const txt = await habitText(page, "3 meals + 1 afternoon snack");
      assert(txt && txt.includes("2 extra"), "#3 card should show '2 extra', got: " + txt);
      await page.close();
    });

    await test("r10.extra.undo-and-reset", async () => {
      const page = await freshPage(browser);
      const d = await pickLogDate(page);
      await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'); await wait(120);
      await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'); await wait(200);
      assert(await clickBtn(page, 'button[data-act="extra-undo"][data-f="mealsPlan"]'), "undo (−1) button missing at count 2");
      await wait(200);
      let n = await page.evaluate((d) => getDayF(d, "snackX"), d);
      assert(n === 1, "after undo snackX should be 1, got " + n);
      let txt = await habitText(page, "3 meals + 1 afternoon snack");
      assert(txt && txt.includes("1 extra"), "card should show '1 extra', got: " + txt);
      assert(await clickBtn(page, 'button[data-act="extra-reset"][data-f="mealsPlan"]'), "reset button missing at count 1");
      await wait(200);
      const got = await page.evaluate((d) => ({ n: getDayF(d, "snackX"), item: scoreDay(d).items.mealsPlan }), d);
      assert(!got.n, "after reset snackX should be 0/absent, got " + JSON.stringify(got));
      assert(got.item === false, "after reset #3 must be unchecked again");
      txt = await habitText(page, "3 meals + 1 afternoon snack");
      assert(txt && !/\d+ extra/.test(txt), "count text should be gone after reset, got: " + txt);
      await page.close();
    });

    await test("r10.extra.drinks-score-logged-and-weekly-totals", async () => {
      const page = await freshPage(browser);
      const d = await pickLogDate(page);
      for (let i = 0; i < 3; i++) { await clickBtn(page, 'button[data-act="extra"][data-f="noAlcohol"]'); await wait(120); }
      await wait(200);
      const got = await page.evaluate((d) => {
        const s = scoreDay(d);
        // one seeded snack on another day of the same week (setup data only)
        const other = addDays(weekSunday(d), (dowOf(d) + 3) % 7 === dowOf(d) ? 1 : (dowOf(d) + 3) % 7);
        return { n: getDayF(d, "drinkX"), item: s.items.noAlcohol, logged: s.logged, other };
      }, d);
      assert(got.n === 3, "drinkX should be 3, got " + JSON.stringify(got));
      assert(got.item === true, "drinks must count #7 as checked");
      assert(got.logged === true, "a day with only drinks tapped must count as logged");
      let txt = await habitText(page, "No alcohol");
      assert(txt && txt.includes("3 drinks"), "#7 card should show '3 drinks', got: " + txt);
      assert(txt && txt.includes("3 drinks this week"), "#7 card should show the weekly total, got: " + txt);
      // weekly snack total: 2 clicked today + 1 seeded on another day
      await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'); await wait(120);
      await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'); await wait(150);
      await page.evaluate((other) => { const doc = state.days[other] || (state.days[other] = { f: {} }); doc.f.snackX = { v: 1, ts: 1 }; saveLocal(); render(true); }, got.other);
      await wait(200);
      txt = await habitText(page, "3 meals + 1 afternoon snack");
      assert(txt && txt.includes("3 extra snacks this week"), "#3 card should show '3 extra snacks this week', got: " + txt);
      await page.close();
    });

    await test("r10.extra.backup-roundtrip-old-format-and-range", async () => {
      const page = await freshPage(browser);
      const d = await pickLogDate(page);
      await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'); await wait(120);
      await clickBtn(page, 'button[data-act="extra"][data-f="mealsPlan"]'); await wait(120);
      await clickBtn(page, 'button[data-act="extra"][data-f="noAlcohol"]'); await wait(200);
      const backup = await page.evaluate(() => {
        window.__cap = null;
        URL.createObjectURL = (b) => { window.__cap = b; return "data:application/json,{}"; };
        openSettings();
        return null;
      });
      await wait(200);
      await page.evaluate(() => document.getElementById("backupBtn").click());
      await wait(300);
      const text = await page.evaluate(() => window.__cap ? window.__cap.text() : null);
      assert(text, "backup blob not captured");
      const obj = JSON.parse(text);
      assert(obj.days && obj.days[d] && obj.days[d].f.snackX && obj.days[d].f.snackX.v === 2, "backup missing snackX=2: " + text.slice(0, 300));
      assert(obj.days[d].f.drinkX && obj.days[d].f.drinkX.v === 1, "backup missing drinkX=1");
      // wipe + restore through the real input
      await page.evaluate(() => { state.days = {}; saveLocal(); });
      const p1 = "/tmp/testbed/r10-counters.json";
      fs.writeFileSync(p1, JSON.stringify(obj));
      await (await page.$("#restoreInput")).uploadFile(p1);
      await wait(700);
      let got = await page.evaluate((d) => ({ s: getDayF(d, "snackX"), dr: getDayF(d, "drinkX") }), d);
      assert(got.s === 2 && got.dr === 1, "restore should bring counters back, got " + JSON.stringify(got));
      // old-format backup (no counters anywhere) still loads
      const old = { settings: { f: {} }, days: { [d]: { f: { mealsPlan: { v: 1, ts: 5 } } } }, plans: {} };
      const p2 = "/tmp/testbed/r10-old.json";
      fs.writeFileSync(p2, JSON.stringify(old));
      await (await page.$("#restoreInput")).uploadFile(p2);
      await wait(700);
      got = await page.evaluate((d) => ({ s: getDayF(d, "snackX"), mp: getDayF(d, "mealsPlan") }), d);
      assert(!got.s && !!got.mp, "old-format backup should load with counters absent, got " + JSON.stringify(got));
      // out-of-range counter is dropped by the sanitizer, not stored
      const bad = { settings: { f: {} }, days: { [d]: { f: { snackX: { v: 999, ts: 5 } } } }, plans: {} };
      const p3 = "/tmp/testbed/r10-bad.json";
      fs.writeFileSync(p3, JSON.stringify(bad));
      await (await page.$("#restoreInput")).uploadFile(p3);
      await wait(700);
      const badN = await page.evaluate((d) => getDayF(d, "snackX"), d);
      assert(badN !== 999 && !(badN > 50), "out-of-range snackX must not survive restore, got " + badN);
      await page.close();
    });
  }
  /* ================= Item 2: Yom Tov line only on real Yom Tov ================= */
  if (run("yomtov")) {
    await test("r10.yomtov.no-line-on-plain-friday", async () => {
      const page = await freshPage(browser);
      // Weekday pin: this test hardcodes the week of 2026-10-18, and the
      // week view renders past days as one-line past-lines, not cards —
      // so once Friday 2026-10-23 is past, no Friday card exists at all.
      // Run as Wed 2026-10-21 so Friday is still ahead.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      const got = await page.evaluate(() => {
        const week = "2026-10-18"; // Sunday; Friday is 2026-10-23, a plain Erev Shabbos
        state.plans[week] = { f: { pro: { v: ["chicken", "salmon"], ts: 1 }, m0D: { v: { id: "c1" }, ts: 1 } } };
        saveLocal();
        ui.tab = "plan"; ui.planWs = week; ui.planStep = "week"; saveUi(); render(true);
        const cards = [...document.querySelectorAll("section.card")];
        const fri = cards.find((c) => (c.querySelector(".day-head") || {}).textContent?.startsWith("Friday"));
        return fri ? fri.textContent : null;
      });
      assert(got !== null, "Friday card not rendered for the Oct 23 week");
      assert(!got.includes("Tonight is Yom Tov"), "plain Friday must not show the Yom Tov line, got: " + got.slice(0, 300));
      assert(got.includes("Friday night is Shabbos"), "Friday should keep its Shabbos note, got: " + got.slice(0, 300));
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });

    await test("r10.yomtov.line-on-real-erev-yomtov", async () => {
      const page = await freshPage(browser);
      const got = await page.evaluate(() => {
        // Find a future calendar Yom Tov whose eve is a rendered weekday card.
        const dates = Object.keys(YOMTOV).sort();
        let pick = null;
        for (const dt of dates) {
          if (dt <= todayStr) continue;
          const dow = dowOf(dt);
          if (dow < 2 || dow > 6) continue;
          const eve = addDays(dt, -1);
          if (restName(eve)) continue;
          pick = { yt: dt, eve, dow };
          break;
        }
        if (!pick) return { skip: true };
        const week = weekSunday(pick.yt);
        state.plans[week] = { f: { pro: { v: ["chicken", "salmon"], ts: 1 }, m0D: { v: { id: "c1" }, ts: 1 } } };
        saveLocal();
        // The plan UI only navigates this/next week, so render the target
        // week through the app's own planWeekHTML with its own ctx/cells.
        const html = planWeekHTML(week, planCells(week), planCtx(week));
        const chunks = html.split('<section class="card">').slice(1);
        const byDay = {};
        chunks.forEach((c) => {
          const m = /day-head">([A-Za-z]+),/.exec(c);
          if (m) byDay[m[1]] = c;
        });
        return { skip: false, eveDay: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dowOf(pick.eve)], byDay, yt: pick.yt };
      });
      assert(!got.skip, "no suitable future Yom Tov found in calendar.json");
      const eveText = got.byDay[got.eveDay];
      assert(eveText && eveText.includes("Tonight is Yom Tov: dinner isn't planned."), "erev Yom Tov (" + got.yt + ") card for " + got.eveDay + " should show the line, got: " + (eveText || "").slice(0, 300));
      ["Monday", "Tuesday"].forEach((dn) => {
        if (got.byDay[dn] && dn !== got.eveDay) assert(!got.byDay[dn].includes("Tonight is Yom Tov"), dn + " of the Yom Tov week must not show the line");
      });
      await page.close();
    });
  }
  /* ================= Item 3: phantom leftovers + prep scope ================= */
  if (run("phantom")) {
    const CTX = { week: "2026-10-18", today: "2026-10-21", rest: {}, pre: {} }; // Wed Oct 21 2026
    await test("r10.phantom.saved-source-survives-shuffle", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((ctx) => {
        // A week built on Sunday: Tuesday dinner c1 (makes leftovers),
        // Wednesday lunch is its leftovers. Shuffling on Wednesday must
        // keep both — the dinner was really cooked.
        const cells = { pro: ["chicken", "salmon", "yogurt", "eggs"], m2D: { id: "c1" }, m3L: { lo: 1 }, m3D: { id: "sa1", k: 1 }, m4D: { id: "c5" } };
        let kept = 0, dinnerKept = 0;
        for (let i = 0; i < 10; i++) {
          const out = ENGINE.generate(ctx, JSON.parse(JSON.stringify(cells)), Math.random);
          if (out.m3L && out.m3L.lo) kept++;
          if (out.m2D && out.m2D.id === "c1") dinnerKept++;
        }
        return { kept, dinnerKept };
      }, CTX);
      assert(res.kept === 10, "Wednesday's saved leftovers lunch must survive every shuffle, kept " + res.kept + "/10");
      assert(res.dinnerKept === 10, "Tuesday's saved dinner must not be re-rolled into fiction, kept " + res.dinnerKept + "/10");
      await page.close();
    });

    await test("r10.phantom.no-leftovers-from-past-or-missing-sources", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((ctx) => {
        const bad = { m1L: 0, m2L: 0, m3L: 0 };
        let shownLo = 0;
        for (let i = 0; i < 20; i++) {
          // Building mid-week from proteins only: no past dinner exists.
          const out = ENGINE.generate(ctx, { pro: ["chicken", "salmon", "yogurt", "eggs"] }, Math.random);
          ["m1L", "m2L", "m3L"].forEach((k) => { if (out[k] && out[k].lo) bad[k]++; });
          ["m4L", "m5L"].forEach((k) => { if (out[k] && out[k].lo) shownLo++; });
        }
        // A carried leftovers lunch whose source dinner is missing from
        // the saved plan must be re-picked fresh.
        let dangling = 0;
        for (let i = 0; i < 10; i++) {
          const cells = { pro: ["chicken", "salmon", "yogurt", "eggs"], m3L: { lo: 1 }, m3D: { id: "sa1" }, m4D: { id: "c5" } };
          const out = ENGINE.generate(ctx, cells, Math.random);
          if (out.m3L && out.m3L.lo) dangling++;
        }
        return { bad, shownLo, dangling };
      }, CTX);
      assert(res.bad.m1L === 0 && res.bad.m2L === 0 && res.bad.m3L === 0, "leftovers sourced from past days in a fresh mid-week build: " + JSON.stringify(res.bad));
      assert(res.shownLo > 0, "leftovers from shown days (Thu/Fri lunches) should still occur, got 0 in 20 builds");
      assert(res.dangling === 0, "a leftovers lunch with no source dinner in the saved plan must be re-picked, survived " + res.dangling + "/10");
      await page.close();
    });

    await test("r10.phantom.locked-leftovers-never-touched", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((ctx) => {
        const cells = { pro: ["chicken", "salmon", "yogurt", "eggs"], m3L: { lo: 1, k: 1 }, m3D: { id: "sa1" } };
        const out = ENGINE.generate(ctx, cells, Math.random);
        return out.m3L;
      }, CTX);
      assert(res && res.lo === 1 && res.k === 1, "locked leftovers cell must pass through untouched, got " + JSON.stringify(res));
      await page.close();
    });

    await test("r10.phantom.prep-lists-shown-days-only", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((ctx) => {
        const cells = { pro: ["chicken", "salmon", "yogurt", "eggs"], m0D: { id: "c1" }, m1D: { id: "c2" }, m3D: { id: "c4" }, m4D: { id: "c5" }, m3L: { id: "e4" }, m4L: { id: "tu1" } };
        const p = ENGINE.prep(ctx, cells, 0);
        const dated = [];
        ["before", "fridge", "freezer", "midweekPortions", "cookFresh"].forEach((k) => {
          if (Array.isArray(p[k])) p[k].forEach((e) => { if (e && e.date) dated.push({ k, date: e.date }); });
        });
        return { dated, hasFuture: dated.some((e) => e.date >= ctx.today) };
      }, CTX);
      const pastEntries = res.dated.filter((e) => e.date < CTX.today);
      assert(pastEntries.length === 0, "prep must not list past days, got: " + JSON.stringify(pastEntries));
      assert(res.hasFuture, "prep should still list upcoming days (sanity)");
      await page.close();
    });

    await test("r10.phantom.ui-shuffle-all-keeps-todays-saved-leftovers", async () => {
      const page = await freshPage(browser);
      const pre = await page.evaluate(() => {
        const td = dowOf(todayStr);
        if (td < 1 || td > 5) return { skip: true, td };
        const week = weekSunday(todayStr);
        const cells = { pro: ["chicken", "salmon", "yogurt", "eggs"] };
        cells["m" + (td - 1) + "D"] = { id: "c1" };
        cells["m" + td + "L"] = { lo: 1 };
        if (td < 5) cells["m" + td + "D"] = { id: "sa1", k: 1 }; // tonight locked fish: keeps wantLo deterministic
        state.plans[week] = { f: {} };
        Object.keys(cells).forEach((k) => { state.plans[week].f[k] = { v: cells[k], ts: 1000 }; });
        saveLocal();
        ui.tab = "plan"; ui.planWs = week; ui.planStep = "week"; saveUi(); render(true);
        return { skip: false, week, srcK: "m" + (td - 1) + "D", lunchK: "m" + td + "L" };
      });
      if (pre.skip) { console.log("  (ui phantom test skipped: today dow=" + pre.td + "; engine tests carry the rule)"); await page.close(); return; }
      const btn = await page.$('button[data-act="shuffle-all"]');
      assert(btn, "Shuffle all unlocked button missing");
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await wait(150);
      await btn.click();
      await wait(400);
      const got = await page.evaluate((pre) => {
        const cells = planCells(pre.week);
        return { lunch: cells[pre.lunchK], dinner: cells[pre.srcK] };
      }, pre);
      assert(got.lunch && got.lunch.lo === 1, "today's saved leftovers lunch must survive Shuffle all, got " + JSON.stringify(got.lunch));
      assert(got.dinner && got.dinner.id === "c1", "yesterday's saved dinner must survive Shuffle all, got " + JSON.stringify(got.dinner));
      await page.close();
    });
  }
  /* ================= Item 4: fish + meat same day allowed ================= */
  if (run("fish")) {
    await test("r10.fish.pickerblocked-pairs", async () => {
      const page = await freshPage(browser);
      const got = await page.evaluate(() => ({
        fAfterM_L: pickerBlocked("F", "L", "M"), fAfterM_D: pickerBlocked("F", "D", "M"),
        mAfterF_L: pickerBlocked("M", "L", "F"), mAfterF_D: pickerBlocked("M", "D", "F"),
        dAfterM: pickerBlocked("D", "D", "M"), mBeforeD: pickerBlocked("M", "L", "D"),
      }));
      assert(got.fAfterM_L === false && got.fAfterM_D === false && got.mAfterF_L === false && got.mAfterF_D === false,
        "fish/meat pairs must not be blocked anymore: " + JSON.stringify(got));
      assert(got.dAfterM === true && got.mBeforeD === true, "meat/dairy pairs must stay blocked: " + JSON.stringify(got));
      await page.close();
    });

    await test("r10.fish.replacement-can-be-fish", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const ctx = planCtx(weekSunday(todayStr));
        // Only fish proteins chosen and tonight is a meat dinner: a fish
        // leftover replacement must be reachable now.
        const cells = { pro: ["salmon", "tuna"], m2D: { id: "c2" }, m3L: { lo: 1 }, m3D: { id: "b3" } };
        let fish = 0, any = 0;
        for (let i = 0; i < 80; i++) {
          const out = ENGINE.shuffleOne(ctx, cells, "m2D", Math.random);
          const v = out && out.m3L;
          if (v && v.id) { any++; if (PLAN_DATA.MEALS[v.id].t === "F") fish++; }
        }
        return { fish, any };
      });
      assert(res.any >= 5, "expected several replacements, got " + JSON.stringify(res));
      assert(res.fish > 0, "a fish replacement before a meat dinner must be possible now, got " + JSON.stringify(res));
      await page.close();
    });
  }

  /* ================= Item 5: Shuffle all unlocked gets an Undo toast ================= */
  if (run("toast")) {
    await test("r10.toast.shuffle-all-undo-restores", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeksOf(page);
      const cells = { pro: ["chicken", "gbeef", "salmon", "yogurt"], m0D: { id: "c1" }, m1D: { id: "c2" }, m2D: { id: "sa1" }, m3D: { id: "y3" }, m4D: { id: "c5" }, m0L: { id: "e4" }, m1L: { id: "tu1" }, m2L: { id: "c3" }, m4L: { lo: 1, k: 1 } };
      await seedPlan(page, nw, cells);
      await gotoPlan(page, nw, "week");
      await wait(200);
      const btn = await page.$('button[data-act="shuffle-all"]');
      assert(btn, "Shuffle all unlocked button missing");
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await wait(150);
      await btn.click();
      await wait(450);
      const toast = await page.evaluate(() => { const t = document.querySelector(".undo-toast span"); return t ? t.textContent : null; });
      assert(toast === "Changed the whole week.", "expected the shuffle-all Undo toast, got: " + toast);
      const undoBtn = await page.$(".undo-toast button");
      assert(undoBtn, "Undo button missing on the shuffle-all toast");
      await undoBtn.click();
      await wait(350);
      const after = await page.evaluate((nw) => planCells(nw), nw);
      ["m0D", "m1D", "m2D", "m3D", "m4D", "m0L", "m1L", "m2L"].forEach((k) => {
        assert(JSON.stringify(after[k]) === JSON.stringify(cells[k]), "Undo must restore " + k + ", got " + JSON.stringify(after[k]) + " vs " + JSON.stringify(cells[k]));
      });
      assert(after.m4L && after.m4L.lo === 1 && after.m4L.k === 1, "locked cell must be untouched throughout");
      await page.close();
    });

    await test("r10.toast.shuffle-all-locked-week-stays-silent", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeksOf(page);
      const cells = { pro: ["chicken", "salmon"] };
      ["c1", "c2", "sa1", "c4", "c5"].forEach((id, d) => { cells["m" + d + "D"] = { id, k: 1 }; });
      ["e4", "tu1", "c3", "y1", "sa4", "l3"].forEach((id, d) => { cells["m" + d + "L"] = { id, k: 1 }; });
      await seedPlan(page, nw, cells);
      await page.evaluate((nw) => {
        const doc = state.plans[nw];
        doc.f.bk = { v: PLAN_DATA.BREAKFAST_DEFAULT.slice(), ts: 1000 };
        saveLocal();
      }, nw);
      await gotoPlan(page, nw, "week");
      await wait(200);
      const btn = await page.$('button[data-act="shuffle-all"]');
      assert(btn, "Shuffle all unlocked button missing");
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await wait(150);
      await btn.click();
      await wait(450);
      const toast = await page.evaluate(() => document.querySelector(".undo-toast"));
      assert(!toast, "nothing can change in a fully locked week, so no toast should appear");
      await page.close();
    });
  }

  /* ================= Item 6: 360px fit (toggle + step bar) ================= */
  if (run("layout")) {
    await test("r10.layout.no-horizontal-overflow-and-toggle-visible", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeksOf(page);
      await seedPlan(page, tw, { pro: ["chicken", "salmon"], m0D: { id: "c1" } });
      for (const step of ["pro", "week", "shop", "prep"]) {
        await gotoPlan(page, tw, step);
        await wait(250);
        const m = await page.evaluate(() => {
          const seg = document.querySelector(".week-toggle");
          const btn = [...document.querySelectorAll(".week-toggle button")].find((b) => b.textContent.trim() === "Next week");
          const r = btn ? btn.getBoundingClientRect() : null;
          const stepBtns = [...document.querySelectorAll(".step-btn")].map((b) => ({ sw: b.scrollWidth, cw: b.clientWidth }));
          const bar = document.querySelector(".stepper-bar");
          return {
            sw: document.documentElement.scrollWidth, iw: window.innerWidth,
            rect: r ? { left: r.left, right: r.right } : null,
            segSW: seg ? seg.scrollWidth : null, segCW: seg ? seg.clientWidth : null,
            btnH: btn ? btn.offsetHeight : null,
            stepClip: stepBtns.some((b) => b.sw > b.cw + 1),
            barScrollable: bar ? bar.scrollWidth > bar.clientWidth + 1 : false,
          };
        });
        assert(m.sw <= m.iw + 1, "step " + step + ": page overflows horizontally (" + m.sw + " > " + m.iw + ")");
        assert(m.rect && m.rect.left >= 0 && m.rect.right <= m.iw + 1, "step " + step + ": Next week toggle clipped: " + JSON.stringify(m.rect) + " vs innerWidth " + m.iw);
        assert(m.segSW <= m.segCW + 1, "step " + step + ": week toggle content clipped inside the seg (" + m.segSW + " > " + m.segCW + ")");
        assert(m.btnH <= 50, "step " + step + ": toggle button text wraps/squeezed (height " + m.btnH + ")");
        assert(!m.stepClip, "step " + step + ": a step button's text is clipped inside its box");
      }
      await page.close();
    });
  }

  /* ================= Item 7: Next buttons land at the top ================= */
  if (run("scroll")) {
    await test("r10.scroll.next-buttons-land-at-top", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeksOf(page);
      const cells = { pro: ["chicken", "gbeef", "salmon", "yogurt"] };
      for (let d = 0; d <= 5; d++) { cells["m" + d + "D"] = { id: ["c1", "c2", "sa1", "y3", "c5", "b8"][d] }; cells["m" + d + "L"] = { id: "e4" }; }
      await seedPlan(page, nw, cells);
      await gotoPlan(page, nw, "week");
      await wait(250);
      // Click the BOTTOM "Next:" button (not the top stepper tab): found by label.
      const clickNext = (label) => page.evaluate((label) => {
        const btn = [...document.querySelectorAll('button[data-act="plan-step"]')].find((b) => b.textContent.trim().indexOf(label) === 0);
        if (!btn) return false;
        btn.click();
        return true;
      }, label);
      await page.evaluate(() => window.scrollTo(0, 99999));
      await wait(150);
      const before = await page.evaluate(() => window.scrollY);
      assert(before > 300, "setup: week step should be scrolled well down, scrollY=" + before);
      assert(await clickNext("Next: shopping list"), "bottom 'Next: shopping list' button missing");
      await wait(400);
      let m = await page.evaluate(() => ({ y: window.scrollY, step: ui.planStep }));
      assert(m.step === "shop" && m.y < 10, "after Next: shopping list, land at the top (step=" + m.step + ", scrollY=" + m.y + ")");
      await page.evaluate(() => window.scrollTo(0, 99999));
      await wait(150);
      const before2 = await page.evaluate(() => window.scrollY);
      assert(before2 > 300, "setup: shop step should be scrolled well down, scrollY=" + before2);
      assert(await clickNext("Next: prep day"), "bottom 'Next: prep day' button missing");
      await wait(400);
      m = await page.evaluate(() => ({ y: window.scrollY, step: ui.planStep }));
      assert(m.step === "prep" && m.y < 10, "after Next: prep day, land at the top (step=" + m.step + ", scrollY=" + m.y + ")");
      await page.close();
    });
  }
} finally { await browser.close(); }

console.log("\n==== R10 suite (" + filter + ", width " + WIDTH + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
