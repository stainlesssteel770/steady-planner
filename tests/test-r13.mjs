/* Steady BETA BATCH 4 (steady-v22) suite.
   Sections: kashrus (item 1) | mdgap (item 4) | picker (item 3) |
             dots (item 2) | long (item 5) | v28a (item 1 + item 5) | v28d (item 4)
   Usage: node test-r13.mjs [section|all]   (WIDTH env, default 390) */
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
  /* ============ Item 1: kashrus fix — hard rule always holds ============ */
  if (run("kashrus")) {
    await test("r13.kashrus.tab-repro-engine-never-meat-never-offprotein", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const MEALS = PLAN_DATA.MEALS;
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const variants = [
          { pro: ["stew", "chicken"], m0L: { id: "y1", k: 1 }, m1D: { id: "y3", k: 1 }, m3D: { id: "y5", k: 1 }, m5D: { id: "y3", k: 1 } },
          { pro: ["stew", "chicken"], m1D: { id: "y3", k: 1 }, m3D: { id: "y5", k: 1 }, m5D: { id: "y3", k: 1 } }
        ];
        let meat = 0, offProtein = 0, firstBad = null;
        variants.forEach((cells) => {
          for (let s = 1; s <= 500; s++) {
            const out = PLAN_ENGINE.generate(ctx, JSON.parse(JSON.stringify(cells)), mulberry(s));
            ["m1L", "m3L", "m5L"].forEach((k) => {
              const r = PLAN_ENGINE.resolve(ctx, out, k);
              if (r && r.meal) {
                if (r.meal.t === "M") { meat++; if (!firstBad) firstBad = { k, id: r.meal.id, seed: s }; }
                if (cells.pro.indexOf(r.meal.p) < 0) { offProtein++; if (!firstBad) firstBad = { k, id: r.meal.id, seed: s }; }
              }
            });
          }
        });
        return { meat, offProtein, firstBad };
      }, MULBERRY);
      assert(res.meat === 0, "meat lunch under a locked dairy dinner in " + res.meat + " cases, first: " + JSON.stringify(res.firstBad));
      assert(res.offProtein === 0, "lunch from a deselected protein in " + res.offProtein + " cases, first: " + JSON.stringify(res.firstBad));
      await page.close();
    });

    await test("r13.kashrus.locked-deselected-dinner-never-pulls-its-lunches", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        // Yogurt is NOT chosen; a yogurt dinner is locked Wed (tonight-widen
        // trap) and Tue (last-night-widen trap for Wed lunch). Dairy dinners
        // exclude meat, so salmon (fish) lunches are the rule-passing fill.
        const cells = { pro: ["chicken", "salmon"], lo: false, m1D: { id: "y5", k: 1 }, m2D: { id: "y3", k: 1 } };
        let yogurt = 0, filled = 0, firstBad = null;
        for (let s = 1; s <= 200; s++) {
          const out = PLAN_ENGINE.generate(ctx, JSON.parse(JSON.stringify(cells)), mulberry(s + 777));
          ["m1L", "m2L", "m3L"].forEach((k) => {
            const r = PLAN_ENGINE.resolve(ctx, out, k);
            if (r && r.meal) {
              filled++;
              if (r.meal.p === "yogurt") { yogurt++; if (!firstBad) firstBad = { k, id: r.meal.id, seed: s }; }
            }
          });
        }
        return { yogurt, filled, firstBad };
      }, MULBERRY);
      assert(res.yogurt === 0, "deselected yogurt lunches served in " + res.yogurt + " cases, first: " + JSON.stringify(res.firstBad));
      assert(res.filled > 300, "test vacuous: only " + res.filled + "/600 dairy-day lunches filled at all");
      await page.close();
    });

    await test("r13.kashrus.tab-repro-real-buttons-friday-lunch-not-meat", async () => {
      const page = await freshPage(browser);
      const setup = await page.evaluate(() => {
        const tw = weekSunday(todayStr);
        // Current week, today is Thursday. Sun-Wed are past: all four yogurt
        // lunches spent as history; Mon/Wed/Fri dairy dinners locked; yogurt
        // still selected at seed time (Tab's repro deselects it in the UI).
        const cells = {
          pro: ["stew", "chicken", "yogurt"],
          m0D: { id: "s1" }, m0L: { id: "y1" },
          m1D: { id: "y3", k: 1 }, m1L: { id: "y2" },
          m2D: { id: "c1" }, m2L: { id: "y4" },
          m3D: { id: "y5", k: 1 }, m3L: { id: "y6" },
          m5D: { id: "y3", k: 1 }
        };
        state.plans[tw] = { f: {} };
        Object.keys(cells).forEach((k) => { state.plans[tw].f[k] = { v: cells[k], ts: 1000 }; });
        saveLocal();
        ui.tab = "plan"; ui.planWs = tw; ui.planStep = "pro"; saveUi(); render(true);
        return { tw };
      });
      // Real buttons: deselect the yogurt chip, then Rebuild.
      const deselected = await page.evaluate(() => {
        const chip = document.querySelector('button.protein-chip[data-id="yogurt"]');
        if (!chip) return false;
        chip.click();
        return true;
      });
      assert(deselected, "yogurt protein chip not found on the setup step");
      await wait(350);
      const rebuilt = await page.evaluate(() => {
        const b = document.querySelector('button[data-act="build"]');
        if (!b) return false;
        b.click();
        return true;
      });
      assert(rebuilt, "Build/Rebuild button not found");
      await wait(500);
      const after = await page.evaluate((tw) => {
        const cells = planCells(tw);
        const ctx = planCtx(tw);
        const r = PLAN_ENGINE.resolve(ctx, cells, "m5L");
        return { pro: cells.pro, m5L: cells.m5L || null, friTag: r && r.meal ? r.meal.t : null, friId: r && r.meal ? r.meal.id : null };
      }, setup.tw);
      assert(after.pro && after.pro.indexOf("yogurt") < 0, "yogurt still selected after chip click: " + JSON.stringify(after.pro));
      assert(after.friTag !== "M", "Friday lunch is meat (" + after.friId + ") under the locked dairy dinner — cell: " + JSON.stringify(after.m5L));
      await page.close();
    });
  }

  /* ============ Item 4: mdGap toggle — meat lunch before dairy dinner ============ */
  if (run("mdgap")) {
    const TABCELLS = { pro: ["stew", "chicken"], m0L: { id: "y1", k: 1 }, m1D: { id: "y3", k: 1 }, m3D: { id: "y5", k: 1 }, m5D: { id: "y3", k: 1 } };

    await test("r13.mdgap.engine-on-fills-dairy-days-off-never", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc, base) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const tally = (cells) => {
          let meat = 0, filled = 0;
          for (let s = 1; s <= 200; s++) {
            const out = PLAN_ENGINE.generate(ctx, JSON.parse(JSON.stringify(cells)), mulberry(s));
            ["m1L", "m3L", "m5L"].forEach((k) => {
              const r = PLAN_ENGINE.resolve(ctx, out, k);
              if (r && r.meal) { filled++; if (r.meal.t === "M") meat++; }
            });
          }
          return { meat, filled };
        };
        return { off: tally(base), on: tally(Object.assign({ mdGap: true }, base)) };
      }, MULBERRY, TABCELLS);
      assert(res.off.meat === 0, "toggle OFF must never serve meat under a dairy dinner, got " + res.off.meat);
      assert(res.on.meat > 300 && res.on.meat === res.on.filled, "toggle ON should fill the dairy days (meat is all the chosen proteins offer): " + JSON.stringify(res.on));
      await page.close();
    });

    await test("r13.mdgap.dice-respect-the-toggle", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const MEALS = PLAN_DATA.MEALS;
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        const tally = (on) => {
          let meat = 0;
          for (let s = 1; s <= 300; s++) {
            const cells = { pro: ["chicken", "yogurt"], mdGap: on, m1D: { id: "y3", k: 1 }, m0D: { id: "c1" }, m0L: { id: "y1" }, m1L: { id: "y2" }, m2D: { id: "c4" }, m2L: { id: "c3" } };
            const out = PLAN_ENGINE.shuffleOne(ctx, cells, "m1L", mulberry(s + 50));
            if (out.m1L && out.m1L.id && MEALS[out.m1L.id].t === "M") meat++;
          }
          return meat;
        };
        return { on: tally(true), off: tally(false) };
      }, MULBERRY);
      assert(res.off === 0, "dice must never serve meat under a dairy dinner with the toggle off, got " + res.off + "/300");
      assert(res.on > 0, "dice should be able to serve meat under a dairy dinner with the toggle on, got 0/300");
      await page.close();
    });

    await test("r13.mdgap.real-button-toggle-rebuild-and-no-warning", async () => {
      const page = await freshPage(browser);
      // Saturday pin (same time-proofing as the picker section below): the
      // test seeds Friday of the current week, but on Saturday Friday is
      // past, so the rebuild drops it and m5L resolves to nothing. Wed
      // 2026-10-21 keeps the same current week with Friday still ahead.
      await page.evaluate(() => { try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2026-10-21", lastSeen: Date.now() })); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      const setup = await page.evaluate(() => {
        const tw = weekSunday(todayStr);
        const cells = {
          pro: ["stew", "chicken"],
          m0D: { id: "s1" }, m0L: { id: "y1" },
          m1D: { id: "y3", k: 1 }, m1L: { id: "y2" },
          m2D: { id: "c1" }, m2L: { id: "y4" },
          m3D: { id: "y5", k: 1 }, m3L: { id: "y6" },
          m5D: { id: "y3", k: 1 }
        };
        state.plans[tw] = { f: {} };
        Object.keys(cells).forEach((k) => { state.plans[tw].f[k] = { v: cells[k], ts: 1000 }; });
        saveLocal();
        ui.tab = "plan"; ui.planWs = tw; ui.planStep = "pro"; saveUi(); render(true);
        const sw = document.querySelector('button.switch[data-k="mdGap"]');
        return { tw, found: !!sw, label: sw ? sw.getAttribute("aria-label") : null, checked: sw ? sw.getAttribute("aria-checked") : null };
      });
      assert(setup.found, "mdGap toggle switch not rendered on the setup step");
      assert(setup.label && setup.label.indexOf("Meat lunch OK before dairy dinner") >= 0, "toggle label should say what it allows: " + setup.label);
      assert(setup.checked === "false", "toggle must default OFF, got aria-checked=" + setup.checked);
      await page.evaluate(() => { document.querySelector('button.switch[data-k="mdGap"]').click(); });
      await wait(350);
      const onState = await page.evaluate((tw) => planCells(tw).mdGap, setup.tw);
      assert(onState === true, "clicking the switch should store mdGap=true, got " + JSON.stringify(onState));
      await page.evaluate(() => { document.querySelector('button[data-act="build"]').click(); });
      await wait(500);
      const after = await page.evaluate((tw) => {
        const cells = planCells(tw);
        const r = PLAN_ENGINE.resolve(planCtx(tw), cells, "m5L");
        return { tag: r && r.meal ? r.meal.t : null, warn: document.body.textContent.indexOf("Meat lunch, dairy dinner") >= 0 };
      }, setup.tw);
      assert(after.tag === "M", "with the toggle on, Friday lunch should be fillable (meat) under the dairy dinner, got tag " + after.tag);
      assert(!after.warn, "with the toggle on, the meat/dairy day warning must not show");
      await page.evaluate(() => { try { localStorage.removeItem("steady.testmode"); } catch (e) {} });
      await page.reload({ waitUntil: "networkidle0" });
      await page.close();
    });
  }

  /* ============ Item 3: picker override — blocked meals stay pickable ============ */
  if (run("picker")) {
    const seedWeek = async (page, cells) => page.evaluate((cells) => {
      const tw = weekSunday(todayStr);
      state.plans[tw] = { f: {} };
      Object.keys(cells).forEach((k) => { state.plans[tw].f[k] = { v: cells[k], ts: 1000 }; });
      saveLocal();
      ui.tab = "plan"; ui.planWs = tw; ui.planStep = "week"; saveUi(); render(true);
      return { tw };
    }, cells);
    const openViaCard = async (page, key) => {
      await page.evaluate((k) => {
        const card = document.querySelector('.meal-card[data-k="' + k + '"]');
        if (!card) throw new Error("no meal card " + k);
        card.querySelector(".meal-name, .meal-how, .slot-label").click();
      }, key);
      await page.waitForSelector("#mpList .mp-opt", { timeout: 5000 });
      await wait(250);
    };
    // TIME-PROOFING (issue #1): the picker section seeds day m4 (Thursday) of
    // the CURRENT week and expects a .meal-card. planWeekHTML renders days
    // before app-today as one-line past-day stubs with NO .meal-card, so once
    // the 4 AM rollover flips app-today to Friday, "no meal card m4L" fails all
    // three picker tests. Pin the app to Thursday via the TESTMODE hook
    // (localStorage steady.testmode, read at boot) so app-today is always the
    // seeded Thursday, at any wall-clock hour. Test-only; the app is untouched.
    const freshPinnedPage = async (browser) => {
      const page = await freshPage(browser);
      const fake = await page.evaluate(() => {
        const f = addDays(weekSunday(todayStr), 4); // Thursday of this week
        try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {}
        return f;
      });
      await page.reload({ waitUntil: "networkidle0", timeout: 90000 });
      await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
      await wait(350);
      return { page, fake };
    };
    // Regression guard: the pin must be in force AND the m4L card must render
    // as a full card (a past-day stub means the pin regressed).
    const assertPin = async (page, fake) => {
      const p = await page.evaluate(() => ({
        todayStr: todayStr, card: !!document.querySelector('.meal-card[data-k="m4L"]')
      }));
      assert(p.todayStr === fake, "TESTMODE pin did not take: todayStr=" + p.todayStr + " fake=" + fake);
      assert(p.card, "m4L must render as a full meal card under the Thursday pin, not a past-day stub");
    };

    await test("r13.picker.blocked-meals-shown-marked-and-pickable", async () => {
      const { page, fake } = await freshPinnedPage(browser);
      const { tw } = await seedWeek(page, { pro: ["chicken", "gbeef", "stew", "yogurt"], m4D: { id: "y3" }, m4L: { id: "y1" } });
      await assertPin(page, fake);
      await openViaCard(page, "m4L");
      const pk = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#mpList .mp-opt[data-id]"));
        return {
          normalTags: rows.filter((e) => !e.classList.contains("mp-opt-blocked")).map((e) => PLAN_DATA.MEALS[e.getAttribute("data-id")].t),
          blocked: rows.filter((e) => e.classList.contains("mp-opt-blocked")).map((e) => e.getAttribute("data-id")),
          hint: (document.querySelector("#mpList .mp-hint") || {}).textContent || ""
        };
      });
      assert(pk.normalTags.every((t) => t !== "M"), "normal list must not contain meat under a dairy dinner");
      assert(pk.blocked.length >= 3, "meat lunches should be in the override section, got " + pk.blocked.join(","));
      assert(/Not usually allowed/.test(pk.hint), "override section must be explained: " + pk.hint);
      await page.click('#mpList .mp-opt-blocked[data-id="r-chicken-shawarma-salad"]');
      await wait(450);
      const after = await page.evaluate((tw) => ({
        cell: planCells(tw).m4L || null,
        warn: document.body.textContent.indexOf("Meat lunch, dairy dinner") >= 0,
        dlgOpen: document.getElementById("mealPickerDlg").open
      }), tw);
      assert(after.cell && after.cell.id === "r-chicken-shawarma-salad", "picking the blocked meal should save it, got " + JSON.stringify(after.cell));
      assert(after.warn, "the day must show the existing meat/dairy warning after an override pick");
      assert(!after.dlgOpen, "picker should close after the pick");
      await page.close();
    });

    await test("r13.picker.blocked-leftovers-row-pickable", async () => {
      const { page, fake } = await freshPinnedPage(browser);
      const { tw } = await seedWeek(page, { pro: ["chicken", "yogurt"], m3D: { id: "c1" }, m4D: { id: "y3" }, m4L: { id: "y1" } });
      await assertPin(page, fake);
      await openViaCard(page, "m4L");
      const lo = await page.evaluate(() => {
        const b = document.querySelector('#mpList [data-act="mp-lo"]');
        return b ? { found: true, blocked: b.classList.contains("mp-opt-blocked") } : { found: false, blocked: false };
      });
      assert(lo.found && lo.blocked, "meat leftovers before a dairy dinner should be offered in the override section: " + JSON.stringify(lo));
      await page.click('#mpList [data-act="mp-lo"]');
      await wait(450);
      const after = await page.evaluate((tw) => ({
        cell: planCells(tw).m4L || null,
        warn: document.body.textContent.indexOf("Meat lunch, dairy dinner") >= 0
      }), tw);
      assert(after.cell && after.cell.lo === 1, "picking blocked leftovers should save the leftovers lunch, got " + JSON.stringify(after.cell));
      assert(after.warn, "the day must show the warning after a blocked leftovers pick");
      await page.close();
    });

    await test("r13.picker.toggle-on-no-override-section", async () => {
      const { page, fake } = await freshPinnedPage(browser);
      await seedWeek(page, { pro: ["chicken", "yogurt"], mdGap: true, m4D: { id: "y3" }, m4L: { id: "y1" } });
      await assertPin(page, fake);
      await openViaCard(page, "m4L");
      const pk = await page.evaluate(() => ({
        blocked: document.querySelectorAll("#mpList .mp-opt-blocked").length,
        meatNormal: Array.from(document.querySelectorAll("#mpList .mp-opt[data-id]")).filter((e) => PLAN_DATA.MEALS[e.getAttribute("data-id")].t === "M" && !e.classList.contains("mp-opt-blocked")).length,
        hint: (document.querySelector("#mpList .mp-hint") || {}).textContent || ""
      }));
      assert(pk.blocked === 0, "with mdGap on nothing is blocked, got " + pk.blocked + " blocked rows");
      assert(pk.meatNormal > 0, "with mdGap on, meat lunches should be in the normal list");
      assert(!/Not usually allowed/.test(pk.hint), "no override hint with mdGap on");
      await page.close();
    });
  }

  /* ============ Item 2: week dots — centred, inside the card, 341-373 ============ */
  if (run("dots")) {
    await test("r13.dots.geometry-341-to-390", async () => {
      const measure = async (w) => {
        const p = await browser.newPage();
        await p.setViewport({ width: w, height: 844 });
        p.on("dialog", (d) => d.accept());
        await p.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0", timeout: 90000 });
        await p.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
        await wait(300);
        const m = await p.evaluate(() => {
          ui.tab = "today"; saveUi(); render(true);
          const row = document.querySelector(".weekdots");
          const card = row.closest(".card");
          const cr = card.getBoundingClientRect();
          const ds = Array.from(document.querySelectorAll(".dot")).map((d) => d.getBoundingClientRect());
          const gaps = []; for (let i = 1; i < ds.length; i++) gaps.push(+(ds[i].left - ds[i - 1].right).toFixed(2));
          return {
            iw: window.innerWidth, docSW: document.documentElement.scrollWidth,
            dotW: +ds[0].width.toFixed(1),
            leftSlack: +(ds[0].left - cr.left).toFixed(1), rightSlack: +(cr.right - ds[ds.length - 1].right).toFixed(1),
            lastR: +ds[ds.length - 1].right.toFixed(1), cardR: +cr.right.toFixed(1), minGap: Math.min.apply(null, gaps)
          };
        });
        await p.close();
        return m;
      };
      for (const w of [390, 373, 366, 360, 357, 350, 345, 341]) {
        const m = await measure(w);
        assert(m.dotW >= 43.5, w + "px: dots should stay 44px, got " + m.dotW);
        assert(m.docSW <= m.iw + 1, w + "px: page overflows: " + m.docSW + " > " + m.iw);
        assert(Math.abs(m.leftSlack - m.rightSlack) <= 1.5, w + "px: dots off-centre, slacks " + m.leftSlack + "/" + m.rightSlack);
        assert(m.lastR <= m.cardR - 1.5, w + "px: last dot crosses the card border: " + m.lastR + " vs card " + m.cardR);
      }
      const m360 = await measure(360);
      assert(m360.minGap >= 0.3, "360px: dots should not touch, min gap " + m360.minGap);
      const m320 = await measure(320);
      assert(m320.dotW < 44 && m320.docSW <= m320.iw + 1, "320px: dots shrink and page fits, got " + JSON.stringify(m320));
    });
  }

  /* ============ Item 5 (v29a P1): long = total time for recipes; leftovers never spend ============ */
  if (run("long")) {
    await test("r13.long.long-dinners-capped-at-two", async () => {
      // v29a P1: long = total time for recipes. With a non-long dinner
      // available (parfait, 10 min), the weekly cap binds at 2 long
      // dinners; without one, relaxation would repeat longs instead.
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        let max = 0, atCap = 0;
        for (let s = 1; s <= 500; s++) {
          const out = PLAN_ENGINE.generate(ctx, { pro: ["stew", "chicken", "yogurt"] }, mulberry(s));
          let n = 0;
          for (let d = 0; d <= 4; d++) { const c = out["m" + d + "D"]; if (c && c.id && PLAN_ENGINE.isLong(PLAN_DATA.MEALS[c.id], 30)) n++; }
          max = Math.max(max, n); if (n === 2) atCap++;
        }
        return { max, atCap };
      }, MULBERRY);
      assert(res.max <= 2, "long dinners (total time >= 30) must cap at 2, max seen " + res.max);
      assert(res.atCap > 50, "the cap should actually bind in some weeks, at-cap weeks " + res.atCap + "/500");
      await page.close();
    });

    await test("r13.long.short-dinners-not-capped", async () => {
      // v29a P1, B1 exemplar: parfait (10 min total) is below the
      // default 30 threshold, so the cap never binds it — 3+ parfait
      // dinners (via repeats) must be reachable in a week. (Matzo
      // retired as the exemplar in B1: schnitzel now has two recipes,
      // so matzo alone maxes at 2/week via variety — node probe: avg
      // matzo 1.05, sheet-pan 0.99 — not via the cap. Parfait, the
      // remaining single-short-recipe protein, proves the property:
      // 190/500 weeks reach 3+.)
      // v29c B2: yogurt gains a second 10-min recipe (the bowl), so
      // parfait alone no longer reaches 3+/week — the property is now
      // proven by short yogurt dinners (parfait + bowl) together.
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        let ge3 = 0;
        for (let s = 1; s <= 500; s++) {
          const out = PLAN_ENGINE.generate(ctx, { pro: ["yogurt", "chicken"] }, mulberry(s));
          let n = 0;
          for (let d = 0; d <= 4; d++) { const c = out["m" + d + "D"]; if (c && c.id && PLAN_DATA.MEALS[c.id].p === "yogurt" && !PLAN_ENGINE.isLong(PLAN_DATA.MEALS[c.id], 30)) n++; }
          if (n >= 3) ge3++;
        }
        return { ge3 };
      }, MULBERRY);
      assert(res.ge3 > 50, "10-min yogurt dinners (parfait + B2 bowl, not long at 30) should be able to reach 3+ in a week, got " + res.ge3 + "/500 weeks");
      await page.close();
    });

    await test("r13.long.threshold-adjustable-via-longmin", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        let ge3at45 = 0, maxLong20 = 0;
        for (let s = 1; s <= 500; s++) {
          const o45 = PLAN_ENGINE.generate(ctx, { pro: ["yogurt", "chicken"], longMin: 45 }, mulberry(s));
          let n = 0;
          for (let d = 0; d <= 4; d++) { const c = o45["m" + d + "D"]; if (c && c.id && PLAN_DATA.MEALS[c.id].p === "yogurt" && !PLAN_ENGINE.isLong(PLAN_DATA.MEALS[c.id], 45)) n++; }
          if (n >= 3) ge3at45++;
          // At 20 every recipe in the set is long except the yogurt
          // shorts (parfait + B2 bowl), which are the non-long fallback
          // that lets the cap bind at 2.
          const o20 = PLAN_ENGINE.generate(ctx, { pro: ["schnitzel", "chicken", "gbeef", "yogurt"], longMin: 20 }, mulberry(s));
          let nl = 0;
          for (let d = 0; d <= 4; d++) { const c = o20["m" + d + "D"]; if (c && c.id && PLAN_ENGINE.isLong(PLAN_DATA.MEALS[c.id], 20)) nl++; }
          maxLong20 = Math.max(maxLong20, nl);
        }
        return { ge3at45, maxLong20, def: PLAN_ENGINE.longMinOf({}), bad: PLAN_ENGINE.longMinOf({ longMin: "x" }) };
      }, MULBERRY);
      assert(res.ge3at45 > 50, "at longMin 45 yogurt shorts (10 min) are not long, so 3+ short yogurt dinners should occur, got " + res.ge3at45 + "/500");
      assert(res.maxLong20 <= 2, "at longMin 20 the cap must bind all total-time>=20 dinners, max seen " + res.maxLong20);
      assert(res.def === 30 && res.bad === 30, "longMinOf must default to 30: " + JSON.stringify(res));
      await page.close();
    });

    await test("r13.long.leftover-lunch-never-spends-the-budget", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-21", rest: {}, pre: {} };
        let hit = 0;
        for (let s = 1; s <= 200; s++) {
          // Past days: exactly one long dinner (bazin) + its leftover
          // lunch. Every other past cell is non-long, so the remaining
          // budget is 1 — Wed/Thu must still be able to serve a long
          // dinner. If the leftover lunch spent the budget too, none could.
          const cells = { pro: ["stew", "chicken", "gbeef", "schnitzel", "yogurt"], m0D: { id: "r-bazin" }, m0L: { id: "r-berry-yogurt-granola-parfait" }, m1L: { lo: 1 }, m1D: { id: "r-matzo-schnitzel" }, m2D: { id: "r-berry-yogurt-granola-parfait" }, m2L: { id: "r-matzo-schnitzel" } };
          const out = PLAN_ENGINE.generate(ctx, cells, mulberry(s + 31));
          const ds = [out.m3D, out.m4D].filter((c) => c && c.id).map((c) => PLAN_DATA.MEALS[c.id]);
          if (ds.some((m) => PLAN_ENGINE.isLong(m, 30))) hit++;
        }
        return { hit };
      }, MULBERRY);
      assert(res.hit > 40, "after a past bazin dinner + its leftover lunch, Wed/Thu should still be able to serve a long dinner (leftover must not spend the budget), got " + res.hit + "/200");
      await page.close();
    });

    await test("r13.long.stepper-real-buttons", async () => {
      const page = await freshPage(browser);
      const setup = await page.evaluate(() => {
        const tw = weekSunday(todayStr);
        state.plans[tw] = { f: { pro: { v: ["chicken", "yogurt"], ts: 1000 } } };
        saveLocal();
        ui.tab = "plan"; ui.planWs = tw; ui.planStep = "pro"; saveUi(); render(true);
        const row = Array.from(document.querySelectorAll(".srv-row")).find((r) => r.textContent.indexOf("Long meal") >= 0);
        return { tw, rowText: row ? row.textContent.replace(/\s+/g, " ").trim() : null };
      });
      assert(setup.rowText && setup.rowText.indexOf("prep ≥ 30 min") >= 0, "stepper should start at the 30-min default, got: " + setup.rowText);
      await page.evaluate(() => { document.querySelector('button[data-act="longmin"][data-d="5"]').click(); });
      await wait(250);
      await page.evaluate(() => { document.querySelector('button[data-act="longmin"][data-d="5"]').click(); });
      await wait(250);
      const mid = await page.evaluate((tw) => ({
        v: planCells(tw).longMin,
        rowText: (Array.from(document.querySelectorAll(".srv-row")).find((r) => r.textContent.indexOf("Long meal") >= 0) || {}).textContent || ""
      }), setup.tw);
      assert(mid.v === 40, "two + clicks should store longMin=40, got " + JSON.stringify(mid.v));
      assert(mid.rowText.indexOf("prep ≥ 40 min") >= 0, "row should show the new threshold: " + mid.rowText);
      await page.evaluate(() => { document.querySelector('button[data-act="longmin"][data-d="-5"]').click(); });
      await wait(250);
      const end = await page.evaluate((tw) => planCells(tw).longMin, setup.tw);
      assert(end === 35, "one - click should store 35, got " + JSON.stringify(end));
      await page.close();
    });
  }
  if (run("v28a")) {
    /* Batch A (v28a) item 1: custom proteins + exclusions. Helpers mirror
       the picker section's idioms (seeded week, Thursday pin, real buttons). */
    const click = async (page, sel) => { await page.waitForSelector(sel, { timeout: 5000 }); await page.click(sel); await wait(250); };
    const seedPlan = async (page, cells, step) => page.evaluate((cells, step) => {
      const tw = weekSunday(todayStr);
      state.plans[tw] = { f: {} };
      Object.keys(cells).forEach((k) => { state.plans[tw].f[k] = { v: cells[k], ts: 1000 }; });
      saveLocal();
      ui.tab = "plan"; ui.planWs = tw; ui.planStep = step || "week"; saveUi(); render(true);
      return { tw };
    }, cells, step);
    const freshPinnedPage = async (browser) => {
      const page = await freshPage(browser);
      const fake = await page.evaluate(() => {
        const f = addDays(weekSunday(todayStr), 4);
        try { localStorage.setItem("steady.testmode", JSON.stringify({ fake: f, lastSeen: Date.now() })); } catch (e) {}
        return f;
      });
      await page.reload({ waitUntil: "networkidle0", timeout: 90000 });
      await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
      await wait(350);
      return { page, fake };
    };
    const assertPin = async (page, fake) => {
      const p = await page.evaluate(() => ({
        todayStr: todayStr, card: !!document.querySelector('.meal-card[data-k="m4L"]')
      }));
      assert(p.todayStr === fake, "TESTMODE pin did not take: todayStr=" + p.todayStr);
      assert(p.card, "m4L must render as a full meal card under the Thursday pin, not a past-day stub");
    };
    const openViaCard = async (page, key) => {
      await page.evaluate((k) => {
        const card = document.querySelector('.meal-card[data-k="' + k + '"]');
        if (!card) throw new Error("no meal card " + k);
        card.querySelector(".meal-name, .meal-how, .slot-label").click();
      }, key);
      await page.waitForSelector("#mpList .mp-opt", { timeout: 5000 });
      await wait(250);
    };
    const setExclViaUI = async (page, ids) => {
      await click(page, "#gearBtn");
      for (const id of ids) {
        await page.evaluate((id) => { document.querySelector('#setProteinList button[data-act="set-pro"][data-id="' + id + '"]').click(); }, id);
        await wait(150);
      }
      await click(page, "#setSave");
    };
    const getExcl = (page) => page.evaluate(() => getSetting("proteinExcl") || {});
    const clearExcl = (page) => page.evaluate(() => { opSettings("proteinExcl", {}); });

    await test("r13.v28a.settings-exclude-fish-disables-picker", async () => {
      const page = await freshPage(browser);
      await setExclViaUI(page, ["salmon", "tuna", "whitefish"]);
      const excl = await getExcl(page);
      assert(excl.salmon && excl.tuna && excl.whitefish, "settings must store all three fish exclusions, got: " + JSON.stringify(excl));
      await seedPlan(page, {}, "pro");
      const chips = await page.evaluate(() => {
        const out = {};
        ["salmon", "tuna", "whitefish", "chicken"].forEach((id) => {
          const c = document.querySelector('.protein-chip[data-id="' + id + '"]');
          out[id] = c ? { disabled: c.disabled, hint: (c.querySelector(".hint") || {}).textContent || "" } : null;
        });
        return out;
      });
      ["salmon", "tuna", "whitefish"].forEach((id) => {
        assert(chips[id] && chips[id].disabled, id + " chip must be disabled when excluded");
        assert(/excluded in Settings/.test(chips[id].hint), id + " chip must note the exclusion, hint: " + chips[id].hint);
      });
      assert(chips.chicken && !chips.chicken.disabled, "chicken chip must stay enabled");
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.nofish-shortcut", async () => {
      const page = await freshPage(browser);
      await click(page, "#gearBtn");
      await page.evaluate(() => { document.querySelector('button[data-act="set-nofish"]').click(); });
      await wait(200);
      await click(page, "#setSave");
      const excl = await getExcl(page);
      assert(excl.salmon && excl.tuna && excl.whitefish, "No fish must exclude all three fish, got: " + JSON.stringify(excl));
      await click(page, "#gearBtn");
      await page.evaluate(() => { document.querySelector('button[data-act="set-nofish"]').click(); });
      await wait(200);
      await click(page, "#setSave");
      const excl2 = await getExcl(page);
      assert(!excl2.salmon && !excl2.tuna && !excl2.whitefish, "No fish again must clear all three fish, got: " + JSON.stringify(excl2));
      await page.close();
    });

    await test("r13.v28a.guard-min-two", async () => {
      const page = await freshPage(browser);
      await page.evaluate(() => {
        const all = ["chicken", "gbeef", "gturkey", "schnitzel", "stew", "deli", "salmon", "tuna", "whitefish", "eggs", "yogurt"];
        const e = {}; all.forEach((id) => { e[id] = true; });
        opSettings("proteinExcl", e);
      });
      await wait(250);
      await click(page, "#gearBtn");
      await page.evaluate(() => { document.querySelector('#setProteinList button[data-act="set-pro"][data-id="tofu"]').click(); });
      await wait(250);
      const msg = await page.evaluate(() => (document.getElementById("setProteinMsg") || {}).textContent || "");
      assert(/at least 2/.test(msg), "guard message must show when a toggle would leave fewer than 2, got: " + msg);
      await page.evaluate(() => { const d = document.getElementById("settingsDlg"); if (d && d.open) d.close(); });
      const after = await getExcl(page);
      assert(!after.tofu && Object.keys(after).length === 11, "guard must refuse the 12th exclusion, got: " + JSON.stringify(after));
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.generate-excludes-fish", async () => {
      const page = await freshPage(browser);
      await setExclViaUI(page, ["salmon", "tuna", "whitefish"]);
      await seedPlan(page, {}, "pro");
      await page.evaluate(() => { ["chicken", "yogurt"].forEach((id) => { document.querySelector('.protein-chip[data-id="' + id + '"]').click(); }); });
      await wait(250);
      await page.evaluate(() => { document.querySelector('button[data-act="build"]').click(); });
      await wait(500);
      const res = await page.evaluate(() => {
        const tw = weekSunday(todayStr);
        const cells = planCells(tw);
        const ctx = planCtx(tw);
        const mealIds = Object.keys(cells).filter((k) => /^m\d[LD]$/.test(k)).map((k) => cells[k] && cells[k].id).filter(Boolean);
        const tags = mealIds.map((id) => PLAN_DATA.MEALS[id] ? PLAN_DATA.MEALS[id].t : "?");
        const shop = ENGINE.shopping(ctx, cells);
        const shopIds = [];
        shop.sections.forEach((s) => s.lines.forEach((l) => shopIds.push(l.id)));
        return { mealTags: tags, shopIds: shopIds };
      });
      assert(!res.mealTags.includes("F"), "generated meals must have no fish, got: " + res.mealTags.join(","));
      ["salmon", "tunacan", "whitefish"].forEach((id) => assert(!res.shopIds.includes(id), "shopping must not list " + id));
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.replace-picker-excludes", async () => {
      const { page, fake } = await freshPinnedPage(browser);
      await setExclViaUI(page, ["salmon"]);
      await seedPlan(page, { pro: ["chicken", "salmon"], m4L: { id: "c3" }, m4D: { id: "y3" } }, "week");
      await assertPin(page, fake);
      await openViaCard(page, "m4L");
      const ids = await page.evaluate(() => Array.from(document.querySelectorAll("#mpList .mp-opt[data-id]")).map((el) => {
        const id = el.getAttribute("data-id");
        const m = PLAN_DATA.MEALS[id];
        return { id: id, p: m ? m.p : null };
      }));
      const fishIds = ids.filter((x) => x.p === "salmon").map((x) => x.id);
      assert(fishIds.length === 0, "picker must not list salmon meals when salmon excluded, got: " + fishIds.join(","));
      assert(ids.length > 0, "picker should still list non-excluded meals");
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.shuffle-one-excludes", async () => {
      const { page, fake } = await freshPinnedPage(browser);
      await setExclViaUI(page, ["salmon"]);
      await seedPlan(page, { pro: ["chicken", "salmon"], m4D: { id: "sa1" } }, "week");
      await assertPin(page, fake);
      await page.evaluate(() => { document.querySelector('.meal-card[data-k="m4D"] button[data-act="shuffle-one"]').click(); });
      await wait(500);
      const res = await page.evaluate(() => {
        const tw = weekSunday(todayStr);
        const id = planCells(tw).m4D && planCells(tw).m4D.id;
        return { id: id, p: id && PLAN_DATA.MEALS[id] ? PLAN_DATA.MEALS[id].p : null };
      });
      assert(res.id && res.id !== "sa1", "shuffle must replace the salmon dinner, got: " + JSON.stringify(res));
      assert(res.p !== "salmon", "shuffled dinner must not be salmon, got: " + JSON.stringify(res));
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.breakfast-exclusions", async () => {
      const page = await freshPage(browser);
      await setExclViaUI(page, ["eggs"]);
      await seedPlan(page, {}, "week");
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => { document.querySelector('button[data-act="bk-shuffle"]').click(); });
        await wait(200);
        const bk = await page.evaluate(() => planCells(weekSunday(todayStr)).bk);
        assert(bk && !bk.some((id) => ["bk1", "bk5", "bk6"].includes(id)), "shuffled breakfasts must exclude eggs, got: " + JSON.stringify(bk));
      }
      await seedPlan(page, {}, "pro");
      await page.evaluate(() => { ["chicken", "yogurt"].forEach((id) => { document.querySelector('.protein-chip[data-id="' + id + '"]').click(); }); });
      await wait(250);
      await page.evaluate(() => { document.querySelector('button[data-act="build"]').click(); });
      await wait(500);
      const bk2 = await page.evaluate(() => planCells(weekSunday(todayStr)).bk);
      assert(bk2 && !bk2.some((id) => ["bk1", "bk5", "bk6"].includes(id)), "generated week breakfasts must exclude eggs, got: " + JSON.stringify(bk2));
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.kashrus-still-blocked", async () => {
      const { page, fake } = await freshPinnedPage(browser);
      await setExclViaUI(page, ["salmon"]);
      await seedPlan(page, { pro: ["chicken", "gbeef", "stew", "yogurt"], m4D: { id: "y3" }, m4L: { id: "y1" } }, "week");
      await assertPin(page, fake);
      await openViaCard(page, "m4L");
      const pk = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#mpList .mp-opt[data-id]"));
        return {
          normalTags: rows.filter((e) => !e.classList.contains("mp-opt-blocked")).map((e) => PLAN_DATA.MEALS[e.getAttribute("data-id")].t),
          blocked: rows.filter((e) => e.classList.contains("mp-opt-blocked")).map((e) => e.getAttribute("data-id")),
          hint: (document.querySelector("#mpList .mp-hint") || {}).textContent || ""
        };
      });
      assert(pk.normalTags.every((t) => t !== "M"), "normal list must not contain meat under a dairy dinner, even with exclusions active");
      assert(pk.blocked.length >= 3, "meat lunches should still be in the override section, got: " + pk.blocked.join(","));
      assert(/Not usually allowed/.test(pk.hint), "override section must still be explained: " + pk.hint);
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.buildweek-copy-filters", async () => {
      const page = await freshPage(browser);
      await setExclViaUI(page, ["eggs"]);
      await page.evaluate(() => {
        state.plans["2026-10-11"] = { f: {
          pro: { v: ["chicken", "yogurt"], ts: 1000 },
          m0D: { v: { id: "y3" }, ts: 1001 },
          bk: { v: ["bk1", "bk2"], ts: 1002 }
        } };
        state.plans["2026-10-18"] = { f: { pro: { v: ["chicken", "yogurt"], ts: 1000 } } };
        saveLocal();
        buildWeek("2026-10-18");
      });
      await wait(400);
      const bk = await page.evaluate(() => planCells("2026-10-18").bk);
      assert(bk && !bk.some((id) => ["bk1", "bk5", "bk6"].includes(id)), "carried-forward breakfasts must exclude eggs, got: " + JSON.stringify(bk));
      assert(bk && bk.length >= 2, "carried pair must refill to 2, got: " + JSON.stringify(bk));
      await page.evaluate(() => { delete state.plans["2026-10-11"]; delete state.plans["2026-10-18"]; saveLocal(); });
      await clearExcl(page);
      await page.close();
    });

    await test("r13.v28a.old-backup-loads", async () => {
      const page = await freshPage(browser);
      const dialogs = [];
      page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
      const tw = await page.evaluate(() => weekSunday(todayStr));
      const fs = await import("fs");
      fs.mkdirSync("/tmp/testbed", { recursive: true });
      fs.writeFileSync("/tmp/testbed/v28a-old-backup.json", JSON.stringify({ settings: { f: {} }, favorites: { items: {} }, days: {},
        grocery: { f: {} }, plans: { [tw]: { f: { pro: { v: ["chicken", "yogurt"], ts: 111 }, m4D: { v: { id: "y3" }, ts: 112 } } } } }));
      const input = await page.$("#restoreInput");
      await input.uploadFile("/tmp/testbed/v28a-old-backup.json");
      await page.waitForFunction(() => false, { timeout: 1 }).catch(() => {});
      for (let i = 0; i < 30 && dialogs.length < 2; i++) await wait(150);
      assert(dialogs.length >= 2, "expected confirm + alert dialogs, got " + JSON.stringify(dialogs));
      const alertMsg = dialogs[dialogs.length - 1];
      assert(!/bad value/.test(alertMsg), "alert should report 0 bad values, got: " + alertMsg);
      await wait(500);
      const excl = await page.evaluate(() => getSetting("proteinExcl"));
      assert(excl && typeof excl === "object" && Object.keys(excl).length === 0, "old backup must load with exclusions empty, got: " + JSON.stringify(excl));
      await page.close();
    });
  }
  if (run("v28b")) {
    /* Batch B (v28b): sanitizer fix first, then exercise rotation. */
    const click = async (page, sel) => { await page.waitForSelector(sel, { timeout: 5000 }); await page.click(sel); await wait(250); };
    const seedWorkout = async (page, dates) => page.evaluate((dates) => {
      dates.forEach((d) => { state.days[d] = { f: { workout: { v: true, ts: 1000 } } }; });
      saveLocal();
    }, dates);
    const clearDays = async (page, dates) => page.evaluate((dates) => {
      dates.forEach((d) => { delete state.days[d]; });
      saveLocal();
    }, dates);

    await test("r13.v28b.sanitizer-survives", async () => {
      const page = await freshPage(browser);
      const dialogs = [];
      page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
      const fs = await import("fs");
      fs.mkdirSync("/tmp/testbed", { recursive: true });
      fs.writeFileSync("/tmp/testbed/v28b-sanitizer.json", JSON.stringify({ settings: { f: {
        coffeeOn: { v: true, ts: 111 }, alcoholOn: { v: true, ts: 112 }, waterUnit: { v: "oz", ts: 113 }
      } }, favorites: { items: {} }, days: {}, grocery: { f: {} }, plans: {} }));
      const input = await page.$("#restoreInput");
      await input.uploadFile("/tmp/testbed/v28b-sanitizer.json");
      await page.waitForFunction(() => false, { timeout: 1 }).catch(() => {});
      for (let i = 0; i < 30 && dialogs.length < 2; i++) await wait(150);
      assert(dialogs.length >= 2, "expected confirm + alert dialogs, got " + JSON.stringify(dialogs));
      const alertMsg = dialogs[dialogs.length - 1];
      assert(!/bad value/.test(alertMsg), "alert should report 0 bad values, got: " + alertMsg);
      await wait(500);
      const vals = await page.evaluate(() => ({ coffee: getSetting("coffeeOn"), alcohol: getSetting("alcoholOn"), unit: getSetting("waterUnit") }));
      assert(vals.coffee === true, "coffeeOn must survive restore, got: " + JSON.stringify(vals));
      assert(vals.alcohol === true, "alcoholOn must survive restore, got: " + JSON.stringify(vals));
      assert(vals.unit === "oz", "waterUnit must survive restore, got: " + JSON.stringify(vals));
      await page.close();
    });

    await test("r13.v28b.rotation-four-weeks", async () => {
      const page = await freshPage(browser);
      const sets = await page.evaluate(() => ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"].map((s) => workoutSetFor(s).setIdx));
      assert(sets[0] !== sets[1] && sets[1] !== sets[2] && sets[2] !== sets[3] && sets[0] !== sets[2] && sets[0] !== sets[3] && sets[1] !== sets[3],
        "four consecutive Sundays must show four different sets, got: " + JSON.stringify(sets));
      assert(sets[4] === sets[0], "fifth Sunday must repeat set 1, got: " + JSON.stringify(sets));
      await page.close();
    });

    await test("r13.v28b.rotation-ab-parity", async () => {
      const page = await freshPage(browser);
      await seedWorkout(page, ["2026-11-02"]);
      let v = await page.evaluate(() => workoutSetFor("2026-11-04").variant);
      assert(v === "B", "one earlier logged workout → variant B for Wed, got: " + v);
      await seedWorkout(page, ["2026-11-03"]);
      v = await page.evaluate(() => workoutSetFor("2026-11-04").variant);
      assert(v === "A", "two earlier logged workouts → variant A for Wed, got: " + v);
      v = await page.evaluate(() => workoutSetFor("2026-11-02").variant);
      assert(v === "A", "a logged day keeps the variant it was performed as (Mon = A), got: " + v);
      v = await page.evaluate(() => workoutSetFor("2026-11-03").variant);
      assert(v === "B", "Tue performed B (Mon before it), got: " + v);
      await clearDays(page, ["2026-11-02", "2026-11-03"]);
      await page.close();
    });

    await test("r13.v28b.rotation-ui-names-set-and-variant", async () => {
      const page = await freshPage(browser);
      await seedWorkout(page, ["2026-11-02"]);
      await page.evaluate(() => { selDate = "2026-11-04"; ui.tab = "workout"; saveUi(); render(true); });
      await wait(300);
      const txt = await page.evaluate(() => document.body.innerText);
      assert(/Foundation/.test(txt), "workout tab must name the current set, body lacks Foundation");
      assert(/Variant B/.test(txt), "workout tab must name variant B (one earlier log), body lacks Variant B");
      assert(/Wide push-ups/.test(txt) && /Reverse lunges/.test(txt), "variant B must swap in Wide push-ups + Reverse lunges");
      assert(!/^\s*Push-ups\s*$/m.test(txt), "variant B must not show the base Push-ups move");
      await clearDays(page, ["2026-11-02"]);
      await page.close();
    });

    await test("r13.v28b.rotation-level-rounds-rest", async () => {
      const page = await freshPage(browser);
      await page.evaluate(() => { opSettings("workoutLevel", 0); opSettings("workoutRounds", 3); selDate = "2026-11-04"; ui.tab = "workout"; saveUi(); render(true); });
      await wait(300);
      const before = await page.evaluate(() => document.querySelector(".move-amt").textContent);
      assert(/12 reps/.test(before), "level 0 Squats should read 12 reps, got: " + before);
      await click(page, 'button[data-act="level"][data-d="1"]');
      const after = await page.evaluate(() => document.querySelector(".move-amt").textContent);
      assert(/13 reps/.test(after), "level +1 should scale Squats to 13 reps, got: " + after);
      await click(page, 'button[data-act="rounds-set"][data-n="4"]');
      const rounds = await page.evaluate(() => getSetting("workoutRounds"));
      assert(rounds === 4, "rounds seg must store 4, got: " + JSON.stringify(rounds));
      await page.evaluate(() => { selDate = "2026-11-07"; render(true); });
      await wait(300);
      const rest = await page.evaluate(() => ({
        note: document.body.innerText.indexOf("no logging today") >= 0,
        btn: !!document.querySelector('button[data-act="workout-done"]')
      }));
      assert(rest.note && !rest.btn, "Shabbos must show no-logging and no log button, got: " + JSON.stringify(rest));
      await page.close();
    });
  }
  if (run("v28c")) {
    /* Batch C (v28c): picky mode — plain protein + single-side meals only. */
    const buildPickyWeek = async (page, proteins, picky) => page.evaluate((proteins, picky) => {
      const week = addDays(weekSunday(todayStr), 7);
      opSettings("pickyMode", picky);
      state.plans[week] = { f: { pro: { v: proteins, ts: 1000 } } };
      saveLocal();
      buildWeek(week);
      return week;
    }, proteins, picky);
    const readWeekMeals = async (page, week) => page.evaluate((week) => {
      const cells = planCells(week);
      const meals = [];
      Object.keys(cells).forEach((k) => {
        if (/^m\d[LD]$/.test(k) && cells[k] && cells[k].id) meals.push({ key: k, id: cells[k].id, fb: !!cells[k].fb, simple: !!PD.MEALS[cells[k].id].simple });
      });
      return meals;
    }, week);
    const clearPickyWeek = async (page, week) => page.evaluate((week) => {
      delete state.plans[week]; opSettings("pickyMode", false); saveLocal();
    }, week);

    await test("r13.v28c.picky-on-mixed", async () => {
      const page = await freshPage(browser);
      // v29a: chicken's only recipe (shawarma salad) is not simple, salmon's
      // is — so the mixed simple/fallback week now uses chicken+salmon.
      const week = await buildPickyWeek(page, ["chicken", "salmon"], true);
      await wait(400);
      const meals = await readWeekMeals(page, week);
      assert(meals.length >= 6, "expected a full generated week, got: " + JSON.stringify(meals));
      assert(meals.every((m) => m.simple || m.fb), "every picky-ON meal must be simple or fallback-flagged, got: " + JSON.stringify(meals));
      assert(meals.some((m) => m.simple), "expected at least one simple meal, got: " + JSON.stringify(meals));
      assert(meals.some((m) => m.fb), "expected at least one fallback (chicken has no simple recipe), got: " + JSON.stringify(meals));
      await clearPickyWeek(page, week);
      await page.close();
    });

    await test("r13.v28c.picky-off-tofu", async () => {
      const page = await freshPage(browser);
      const week = await buildPickyWeek(page, ["tofu"], false);
      await wait(400);
      const meals = await readWeekMeals(page, week);
      assert(meals.length >= 6, "expected a full generated week, got: " + JSON.stringify(meals));
      assert(meals.every((m) => !m.simple), "picky OFF must not filter to simple meals, got: " + JSON.stringify(meals));
      assert(!meals.some((m) => m.fb), "picky OFF must never set the fallback flag, got: " + JSON.stringify(meals));
      await clearPickyWeek(page, week);
      await page.close();
    });

    await test("r13.v28c.picky-on-tofu-fallback", async () => {
      const page = await freshPage(browser);
      const week = await buildPickyWeek(page, ["tofu"], true);
      await wait(400);
      const meals = await readWeekMeals(page, week);
      assert(meals.length >= 6, "expected a full generated week, got: " + JSON.stringify(meals));
      assert(meals.every((m) => !m.simple && m.fb), "tofu-only picky week must fall back on every slot, got: " + JSON.stringify(meals));
      await clearPickyWeek(page, week);
      await page.close();
    });

    await test("r13.v28c.picky-shuffle-prefers-simple", async () => {
      const page = await freshPage(browser);
      const out = await page.evaluate(() => {
        opSettings("pickyMode", true);
        const ctx = planCtx(addDays(weekSunday(todayStr), 7));
        // v29a: chicken has no simple recipe, so the simple-shuffle week
        // uses salmon+whitefish (both simple); the current meal is the
        // salmon recipe, so the shuffle must land on the whitefish one.
        const res = ENGINE.shuffleOne(ctx, { pro: ["salmon", "whitefish"], m0L: { id: "r-dry-rub-salmon" } }, "m0L");
        opSettings("pickyMode", false);
        return { id: res.m0L && res.m0L.id, fb: !!(res.m0L && res.m0L.fb), simple: !!(res.m0L && res.m0L.id && PD.MEALS[res.m0L.id].simple) };
      });
      assert(out && out.id && out.simple, "shuffled lunch must be simple, got: " + JSON.stringify(out));
      assert(!out.fb, "a simple shuffle replacement must not carry the fallback flag, got: " + JSON.stringify(out));
      await page.close();
    });

    await test("r13.v28c.picky-ui-fallback-note", async () => {
      const page = await freshPage(browser);
      const week = await buildPickyWeek(page, ["tofu"], true);
      await wait(400);
      await page.evaluate((week) => { ui.tab = "plan"; ui.planWs = week; saveUi(); render(true); }, week);
      await wait(300);
      const txt = await page.evaluate(() => document.body.innerText);
      assert(txt.indexOf("no simple option — showing regular") >= 0, "fallback meals must carry the note on the plan tab");
      await clearPickyWeek(page, week);
      await page.close();
    });

    await test("r13.v28c.picky-toggle-persists", async () => {
      const page = await freshPage(browser);
      await page.click("#gearBtn");
      await page.waitForSelector("#setPickyMode", { timeout: 5000 });
      const was = await page.evaluate(() => document.getElementById("setPickyMode").checked);
      assert(was === false, "picky toggle must default OFF, got: " + was);
      await page.click("#setPickyMode");
      await page.click("#setSave");
      await wait(400);
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
      await wait(350);
      await page.click("#gearBtn");
      await page.waitForSelector("#setPickyMode", { timeout: 5000 });
      const now = await page.evaluate(() => document.getElementById("setPickyMode").checked);
      assert(now === true, "picky toggle must persist across reload, got: " + now);
      await page.click("#setPickyMode");
      await page.click("#setSave");
      await wait(300);
      await page.close();
    });

    await test("r13.v28c.picky-old-backup-default-off", async () => {
      const page = await freshPage(browser);
      const dialogs = [];
      page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
      const fs = await import("fs");
      fs.mkdirSync("/tmp/testbed", { recursive: true });
      fs.writeFileSync("/tmp/testbed/v28c-old-backup.json", JSON.stringify({ settings: { f: {} }, favorites: { items: {} }, days: {}, grocery: { f: {} }, plans: {} }));
      const input = await page.$("#restoreInput");
      await input.uploadFile("/tmp/testbed/v28c-old-backup.json");
      await page.waitForFunction(() => false, { timeout: 1 }).catch(() => {});
      for (let i = 0; i < 30 && dialogs.length < 2; i++) await wait(150);
      assert(dialogs.length >= 2, "expected confirm + alert dialogs, got " + JSON.stringify(dialogs));
      const alertMsg = dialogs[dialogs.length - 1];
      assert(!/bad value/.test(alertMsg), "alert should report 0 bad values, got: " + alertMsg);
      await wait(500);
      const picky = await page.evaluate(() => getSetting("pickyMode"));
      assert(picky === false, "old backup must load with picky mode OFF, got: " + JSON.stringify(picky));
      await page.close();
    });
  }
  if (run("v28d")) {
    /* Batch D (v28d): recipe links — verified pages on the approved list only. */
    await test("r13.v28d.src-domains-approved", async () => {
      const page = await freshPage(browser);
      const out = await page.evaluate(() => {
        const APPROVED = ["kosher.com", "busyinbrooklyn.com", "overtimecook.com", "kosherinthekitch.com", "jamiegeller.com", "betweencarpools.com", "kosheronabudget.com", "chabad.org"];
        const bad = [];
        let linked = 0;
        Object.keys(PD.MEALS).forEach((id) => {
          const s = PD.MEALS[id].src;
          if (!s) return;
          linked++;
          let host = "";
          try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch (e) {}
          if (APPROVED.indexOf(host) < 0) bad.push({ id, reason: "domain-not-approved", host });
          else if (s.site !== host) bad.push({ id, reason: "site-mismatch", site: s.site, host });
          if (s.match !== "exact" && s.match !== "near") bad.push({ id, reason: "bad-match", match: s.match });
        });
        return { linked, bad };
      });
      assert(out.linked >= 1, "expected at least one linked meal, got none");
      assert(out.bad.length === 0, "bad src entries: " + JSON.stringify(out.bad));
      await page.close();
    });

    await test("r13.v28d.linked-renders-link-not-how", async () => {
      const page = await freshPage(browser);
      const out = await page.evaluate(() => {
        const week = addDays(weekSunday(todayStr), 7);
        const ctx = planCtx(week);
        const linkedId = Object.keys(PD.MEALS).find((id) => PD.MEALS[id].src);
        const unlinkedId = Object.keys(PD.MEALS).find((id) => !PD.MEALS[id].src);
        const linkedHtml = mealCardHTML(ctx, { pro: [PD.MEALS[linkedId].p], m0L: { id: linkedId } }, "m0L");
        const unlinkedHtml = mealCardHTML(ctx, { pro: [PD.MEALS[unlinkedId].p], m0L: { id: unlinkedId } }, "m0L");
        return { linkedId, unlinkedId, linkedHtml, unlinkedHtml, linkedHow: esc(PD.MEALS[linkedId].how), unlinkedHow: esc(PD.MEALS[unlinkedId].how) };
      });
      assert(out.linkedHtml.indexOf("<a ") >= 0 && (out.linkedHtml.indexOf("Recipe ↗") >= 0 || out.linkedHtml.indexOf("recipe ↗") >= 0), "linked meal card must carry a Recipe link, got: " + out.linkedHtml);
      assert(out.linkedHtml.indexOf(out.linkedHow) < 0, "linked meal card must not show its how-to text");
      assert(out.unlinkedHtml.indexOf(out.unlinkedHow) >= 0, "unlinked meal card must still show its how-to text, got: " + out.unlinkedHtml);
      assert(out.unlinkedHtml.indexOf("<a ") < 0, "unlinked meal card must not carry a link, got: " + out.unlinkedHtml);
      await page.close();
    });

    await test("r13.v28d.meal-how-helper", async () => {
      const page = await freshPage(browser);
      const out = await page.evaluate(() => {
        const near = mealHowHTML({ how: "HOWTEXT", src: { site: "kosher.com", url: "https://www.kosher.com/recipe/x", match: "near" } }, false);
        const exact = mealHowHTML({ how: "HOWTEXT", src: { site: "kosher.com", url: "https://www.kosher.com/recipe/x", match: "exact" } }, false);
        const plain = mealHowHTML({ how: "HOWTEXT" }, false);
        const leftover = mealHowHTML({ how: "HOWTEXT", src: { site: "kosher.com", url: "https://www.kosher.com/recipe/x", match: "exact" } }, true);
        return { near, exact, plain, leftover };
      });
      assert(out.near.indexOf("<a ") >= 0 && out.near.indexOf("Near-match") >= 0, "near-match link must be labeled Near-match, got: " + out.near);
      assert(out.near.indexOf("HOWTEXT") < 0, "near-match must replace the how-to text");
      assert(out.exact.indexOf("Recipe") >= 0 && out.exact.indexOf("Near-match") < 0, "exact link must not carry the near-match label, got: " + out.exact);
      assert(out.plain.indexOf("HOWTEXT") >= 0 && out.plain.indexOf("<a ") < 0, "unlinked meal must render its how-to text with no link, got: " + out.plain);
      assert(out.leftover.indexOf("Second portion") >= 0 && out.leftover.indexOf("<a ") < 0, "leftovers must keep the leftovers line, never a link, got: " + out.leftover);
      await page.close();
    });

    await test("r13.v28d.wraps-not-simple", async () => {
      const page = await freshPage(browser);
      const out = await page.evaluate(() => ({
        c3: PD.MEALS.c3.simple, d2: PD.MEALS.d2.simple, e6: PD.MEALS.e6.simple,
        count: Object.keys(PD.MEALS).filter((id) => PD.MEALS[id].simple).length
      }));
      assert(out.c3 === false && out.d2 === false && out.e6 === false, "the three wraps must not be flagged simple, got: " + JSON.stringify(out));
      assert(out.count === 24, "simple count must be 19 old + 5 recipe simples (4 seed + cajun, B1), got " + out.count);
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log(passed + " passed, " + failed + " failed @ " + WIDTH + "px");
if (failed) process.exit(1);
