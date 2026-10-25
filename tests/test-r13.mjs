/* Steady BETA BATCH 4 (steady-v22) suite.
   Sections: kashrus (item 1) | mdgap (item 4) | picker (item 3) |
             dots (item 2) | long (item 5)
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
      const { tw } = await seedWeek(page, { pro: ["chicken", "yogurt"], m4D: { id: "y3" }, m4L: { id: "y1" } });
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
      await page.click('#mpList .mp-opt-blocked[data-id="c3"]');
      await wait(450);
      const after = await page.evaluate((tw) => ({
        cell: planCells(tw).m4L || null,
        warn: document.body.textContent.indexOf("Meat lunch, dairy dinner") >= 0,
        dlgOpen: document.getElementById("mealPickerDlg").open
      }), tw);
      assert(after.cell && after.cell.id === "c3", "picking the blocked meal should save it, got " + JSON.stringify(after.cell));
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
        meatNormal: Array.from(document.querySelectorAll("#mpList .mp-opt[data-id]")).filter((e) => ["c2", "c3", "c5", "c6"].indexOf(e.getAttribute("data-id")) >= 0 && !e.classList.contains("mp-opt-blocked")).length,
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

  /* ============ Item 5: long = hands-on prep; leftovers never spend ============ */
  if (run("long")) {
    await test("r13.long.stew-pots-are-not-long-anymore", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        let ge3 = 0;
        for (let s = 1; s <= 500; s++) {
          const out = PLAN_ENGINE.generate(ctx, { pro: ["stew", "chicken"] }, mulberry(s));
          let n = 0;
          for (let d = 0; d <= 4; d++) { const c = out["m" + d + "D"]; if (c && c.id && c.id.charAt(0) === "s") n++; }
          if (n >= 3) ge3++;
        }
        return { ge3 };
      }, MULBERRY);
      assert(res.ge3 > 50, "stew dinners (15-20 min hands-on) should be able to reach 3+ in a week, got " + res.ge3 + "/500 weeks");
      await page.close();
    });

    await test("r13.long.schnitzel-dinners-capped-at-two", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        let max = 0, atCap = 0;
        for (let s = 1; s <= 500; s++) {
          const out = PLAN_ENGINE.generate(ctx, { pro: ["schnitzel", "chicken", "gbeef"] }, mulberry(s));
          let n = 0;
          for (let d = 0; d <= 4; d++) { const c = out["m" + d + "D"]; if (c && ["z1", "z3", "z4"].indexOf(c.id) >= 0) n++; }
          max = Math.max(max, n); if (n === 2) atCap++;
        }
        return { max, atCap };
      }, MULBERRY);
      assert(res.max <= 2, "long schnitzel dinners (35/45/33 hands-on) must cap at 2, max seen " + res.max);
      assert(res.atCap > 50, "the cap should actually bind in some weeks, at-cap weeks " + res.atCap + "/500");
      await page.close();
    });

    await test("r13.long.threshold-adjustable-via-longmin", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((mulberrySrc) => {
        const mulberry = eval(mulberrySrc);
        const ctx = { week: "2026-10-18", today: "2026-10-18", rest: {}, pre: {} };
        let ge3at45 = 0, maxLong20 = 0;
        for (let s = 1; s <= 500; s++) {
          const o45 = PLAN_ENGINE.generate(ctx, { pro: ["schnitzel", "chicken"], longMin: 45 }, mulberry(s));
          let n = 0;
          for (let d = 0; d <= 4; d++) { const c = o45["m" + d + "D"]; if (c && c.id && c.id.charAt(0) === "z") n++; }
          if (n >= 3) ge3at45++;
          const o20 = PLAN_ENGINE.generate(ctx, { pro: ["schnitzel", "chicken", "gbeef"], longMin: 20 }, mulberry(s));
          let nl = 0;
          for (let d = 0; d <= 4; d++) { const c = o20["m" + d + "D"]; if (c && c.id && PLAN_ENGINE.handsOn(PLAN_DATA.MEALS[c.id]) >= 20) nl++; }
          maxLong20 = Math.max(maxLong20, nl);
        }
        return { ge3at45, maxLong20, def: PLAN_ENGINE.longMinOf({}), bad: PLAN_ENGINE.longMinOf({ longMin: "x" }) };
      }, MULBERRY);
      assert(res.ge3at45 > 50, "at longMin 45 only z3 is long, so 3+ schnitzel dinners should occur, got " + res.ge3at45 + "/500");
      assert(res.maxLong20 <= 2, "at longMin 20 the cap must bind all hands-on>=20 dinners, max seen " + res.maxLong20);
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
          const cells = { pro: ["stew", "chicken"], m0D: { id: "s1" }, m0L: { id: "c6" }, m1L: { lo: 1 }, m1D: { id: "c1" }, m2D: { id: "c4" }, m2L: { id: "c3" } };
          const out = PLAN_ENGINE.generate(ctx, cells, mulberry(s + 31));
          const ds = [out.m3D, out.m4D].filter((c) => c && c.id).map((c) => c.id);
          if (ds.some((x) => x === "s3" || x === "s4")) hit++;
        }
        return { hit };
      }, MULBERRY);
      assert(res.hit > 40, "after a past s1 dinner + its leftover lunch, Wed/Thu should still be able to serve s3/s4 (old rules: budget spent twice, 0), got " + res.hit + "/200");
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
} finally {
  await browser.close();
}
console.log(passed + " passed, " + failed + " failed @ " + WIDTH + "px");
if (failed) process.exit(1);
