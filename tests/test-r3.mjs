// Round 3 tests for Steady PWA. Usage: node test-r3.mjs [b1|b2|...|all]
// WIDTH env overrides the default viewport width for tests that don't pin one.
import puppeteer from "puppeteer-core";
import fs from "fs";

const CHROME = process.env.CHROME_PATH || "/home/hatch/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome";
const URL = "http://localhost:8899/steady-planner/";
const DW = parseInt(process.env.WIDTH || "390", 10);
const DH = parseInt(process.env.HEIGHT || "844", 10); // sweep support: 667
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "  — " + e.message); }
}

async function freshPage(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width: width || DW, height: height || DH });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await wait(350); // let calendar fetch settle
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
async function buildViaUI(page, week) {
  await gotoPlan(page, week, "pro");
  // el.click() on the live node: each chip click re-renders the step, and a
  // puppeteer click racing that re-render can land on a detached node.
  const clickSel = async (sel) => {
    await page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error("missing " + s); el.click(); }, sel);
    await wait(150);
  };
  await clickSel('.protein-chip[data-id="chicken"]');
  await clickSel('.protein-chip[data-id="eggs"]');
  await clickSel('[data-act="build"]');
  await wait(250);
}
const getLC = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("steady.lastCleared") || "null"); } catch (e) { return null; } });
const lcHasMeals = (lc) => !!lc && !!lc.doc && !!lc.doc.f && Object.keys(lc.doc.f).some((k) => /^m\d[LD]$/.test(k) && lc.doc.f[k] && lc.doc.f[k].v);

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ---------------- Bug 1: picker flags squeeze minutes off the row ---------------- */
  if (run("b1")) await test("r3.b1.minutes-visible-360", async () => {
    const page = await freshPage(browser, 360, 740);
    const { tw } = await weeks(page);
    await seed(page, tw, { pro: ["salmon", "chicken"] });
    await gotoPlan(page, tw, "week");
    await page.evaluate(() => openMealPicker("m3L"));
    await page.waitForSelector('.mp-opt[data-id="sa2"]', { timeout: 5000 });
    const res = await page.evaluate(() => {
      const row = document.querySelector('.mp-opt[data-id="sa2"]');
      const min = row.querySelector(".mp-min");
      const rb = row.getBoundingClientRect(), mb = min.getBoundingClientRect();
      return { flags: row.querySelectorAll(".mp-flag").length, rowL: rb.left, rowR: rb.right, minL: mb.left, minR: mb.right, minW: mb.width, vw: window.innerWidth, scrollW: row.scrollWidth, clientW: row.clientWidth };
    });
    assert(res.flags >= 1, "expected flag pills on salmon row, got " + JSON.stringify(res));
    assert(res.minW > 0 && res.minR <= res.rowR + 0.6 && res.minR <= res.vw && res.minL >= res.rowL - 0.6,
      "minutes column squeezed off row: " + JSON.stringify(res));
    await page.close();
  });

  /* ---------------- Bug 2: #setError below sticky footer ---------------- */
  if (run("b2")) await test("r3.b2.seterror-scrolls-into-view", async () => {
    const page = await freshPage(browser, 390, 560);
    await page.click("#gearBtn");
    await page.waitForFunction(() => document.getElementById("settingsDlg").open, { timeout: 5000 });
    await page.evaluate(() => { document.getElementById("setStepGoal").value = "500"; });
    await page.evaluate(() => { document.getElementById("setSave").click(); }); // programmatic: no scroll-into-view masking the bug
    await wait(200);
    const res = await page.evaluate(() => {
      const dlg = document.getElementById("settingsDlg");
      const err = document.getElementById("setError");
      const inner = dlg.querySelector(".dlg-inner");
      const er = err.getBoundingClientRect(), ir = inner.getBoundingClientRect();
      return { open: dlg.open, hidden: err.hidden, text: err.textContent, errTop: er.top, errBottom: er.bottom, inTop: ir.top, inBottom: ir.bottom };
    });
    assert(res.open, "dialog should stay open on invalid save");
    assert(!res.hidden && /Step goal/.test(res.text), "error should be shown: " + JSON.stringify(res));
    assert(res.errBottom <= res.inBottom + 1 && res.errTop >= res.inTop - 1,
      "error not within the dialog's visible rect: " + JSON.stringify(res));
    await page.close();
  });

  /* ---------------- Bug 3: null tombstone counted as bad ---------------- */
  if (run("b3")) await test("r3.b3.null-tombstone-not-counted", async () => {
    const page = await freshPage(browser, 390, 844);
    const dialogs = [];
    page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
    const { tw } = await weeks(page);
    const backup = { settings: { f: {} }, favorites: { items: {} }, days: {}, grocery: { f: {} },
      plans: { [tw]: { f: {
        pro: { v: ["chicken", "yogurt"], ts: 111 },
        m1D: { v: { id: "y4" }, ts: 112 },
        m2L: { v: null, ts: 113 }
      } } } };
    fs.writeFileSync("/tmp/testbed/backup-r3.json", JSON.stringify(backup));
    const input = await page.$("#restoreInput");
    await input.uploadFile("/tmp/testbed/backup-r3.json");
    await page.waitForFunction(() => false, { timeout: 1 }).catch(() => {});
    for (let i = 0; i < 30 && dialogs.length < 2; i++) await wait(150);
    assert(dialogs.length >= 2, "expected confirm + alert dialogs, got " + JSON.stringify(dialogs));
    const alertMsg = dialogs[dialogs.length - 1];
    assert(!/bad value/.test(alertMsg), "alert should report 0 bad values, got: " + alertMsg);
    await page.close();
  });

  /* ---------------- Bug 4: engine lunch picks vs dairy/meat dinners ---------------- */
  if (run("b4")) {
    await test("r3.b4.repick-never-meat-before-dairy-when-alternative", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const ctx = planCtx(weekSunday(todayStr));
        const cells = { pro: ["chicken", "yogurt", "eggs"], m3D: { id: "y4" }, m3L: { id: "e4" } };
        let meat = 0, total = 0;
        for (let i = 0; i < 40; i++) {
          const out = ENGINE.shuffleOne(ctx, cells, "m3L", Math.random);
          const v = out && out.m3L;
          if (v && v.id) { total++; if (PLAN_DATA.MEALS[v.id].t === "M") meat++; }
        }
        return { meat, total };
      });
      assert(res.total >= 20, "shuffle should produce lunches, got " + JSON.stringify(res));
      assert(res.meat === 0, "meat lunch picked before a dairy dinner despite alternatives: " + JSON.stringify(res));
      await page.close();
    });
    await test("r3.b4.only-meat-fallback-allowed", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate(() => {
        const ctx = planCtx(weekSunday(todayStr));
        const cells = { pro: ["chicken"], m3D: { id: "y4" }, m3L: { id: "c3" } };
        let meat = 0, total = 0;
        for (let i = 0; i < 20; i++) {
          const out = ENGINE.shuffleOne(ctx, cells, "m3L", Math.random);
          const v = out && out.m3L;
          if (v && v.id) { total++; if (PLAN_DATA.MEALS[v.id].t === "M") meat++; }
        }
        return { meat, total };
      });
      assert(res.total >= 10 && res.meat === res.total, "only-meat fallback should still return a meat lunch: " + JSON.stringify(res));
      await page.close();
    });
    /* r3.b4 (replacement-never-fish-before-meat-dinner) was DELETED in
       Beta batch 1 item 4 (user-approved): fish before a meat dinner is
       allowed now. The positive check lives in test-r10 (fish section). */
  }

  /* ---------------- Bug 5: meat-lo lunch kept before tomorrow's dairy dinner ---------------- */
  if (run("b5")) await test("r3.b5.meat-lo-before-dairy-dinner-repicked", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await seed(page, tw, { pro: ["chicken", "yogurt", "eggs"], m3L: { lo: 1 }, m3D: { id: "y4" } });
    await gotoPlan(page, tw, "week");
    await page.evaluate(() => openMealPicker("m2D"));
    await page.waitForSelector('.mp-opt[data-id="c1"]', { timeout: 5000 });
    await page.click('.mp-opt[data-id="c1"]');
    await wait(300);
    const res = await page.evaluate(() => {
      const cells = planCells(weekSunday(todayStr));
      const v = cells.m3L;
      const toast = document.querySelector(".undo-toast");
      return { m2D: cells.m2D || null, m3L: v || null, tag: v && v.id ? PLAN_DATA.MEALS[v.id].t : null, span: toast && toast.querySelector("span") ? toast.querySelector("span").textContent : null, btn: toast ? !!toast.querySelector("button") : false, day: PLAN_ENGINE.DAYN[2] };
    });
    assert(res.m2D && res.m2D.id === "c1", "dinner pick should have landed: " + JSON.stringify(res));
    assert(res.m3L && res.m3L.id && res.tag !== "M", "tomorrow's lunch should be re-picked (not meat leftovers): " + JSON.stringify(res));
    assert(res.span && res.span.indexOf("Changed " + res.day + " dinner.") === 0 && res.btn, "expected the Undo toast for the dinner pick: " + JSON.stringify(res));
    await page.close();
  });

  /* ---------------- Bug 6: week-clear on empty week clobbers park ---------------- */
  if (run("b6")) {
    let page, tw, nw;
    await test("r3.b6.empty-week-keeps-park", async () => {
      page = await freshPage(browser);
      ({ tw, nw } = await weeks(page));
      await buildViaUI(page, tw);
      await page.click('[data-act="week-clear"]');
      await wait(150);
      await page.click('#bottomNav button[data-tab="today"]'); // dismiss undo toast via tab change
      await wait(150);
      let lc = await getLC(page);
      assert(!!lc && lcHasMeals(lc[tw]), "park should hold the cleared week's meals in the per-week map: " + JSON.stringify(lc && Object.keys(lc)));
      await gotoPlan(page, nw, "week");
      const btn = await page.$('[data-act="week-clear"]');
      assert(!btn, '"Start this week over" should be hidden on an empty week');
      lc = await getLC(page);
      assert(!!lc && lcHasMeals(lc[tw]), "park must survive viewing the empty week: " + JSON.stringify(lc && Object.keys(lc)));
    });
    await test("r3.b6.restore-still-works", async () => {
      assert(page, "needs b6 page");
      // Fresh clear inside this test, mirroring the real user flow: build a
      // full week via the UI, open the week view, then tap "Start this week
      // over". Fixture: park the page at scroll top and fire a DOM click
      // (no puppeteer auto-scroll — a real tap never re-scrolls the page).
      // On the pre-v23 tree the viewport stays at the top and the restore
      // card renders below the fold (measured: top 805–902 at scroll 0);
      // the v23 app scrolls it to the viewport centre instead. The assertion
      // runs immediately after, with NO test-side scrolling and NO
      // navigation in between — navigating (tab change / gotoPlan) resets
      // scroll state and would not exercise the app's scroll. Mark's
      // decision via Tab (issue #1, v23): right after Clear, the Restore
      // control must be fully visible with no scrolling. Assert the button's
      // rect is fully inside the viewport AND near the viewport centre
      // (the app uses block:"center", so centring proves the app did the
      // scrolling — it also fails the pre-v23 tree at sizes where the card
      // happens to fall just inside the viewport), then the guard per Tab's
      // approval: document.elementFromPoint at its centre must return the
      // button (or a child of it) — not the sticky header, the undo toast at
      // bottom:84, or the tab bar. "out-of-viewport"/"not-centred" fail on
      // the pre-v23 tree; "covered" fails on any fixed element covering it.
      await buildViaUI(page, tw);
      await gotoPlan(page, tw, "week");
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('[data-act="week-clear"]').click(); });
      await page.waitForSelector('[data-act="restore-cleared"]', { timeout: 5000 });
      // DOM click (not a puppeteer coordinate click): the Restore button
      // only renders after a re-render.
      const restoreRes = await page.evaluate(async () => {
        const b = document.querySelector('[data-act="restore-cleared"]');
        if (!b) return { res: "missing", measure: "none" };
        await new Promise(r => requestAnimationFrame(r));
        const r = b.getBoundingClientRect();
        const measure = "width=" + innerWidth + " top=" + Math.round(r.top) + " bottom=" + Math.round(r.bottom) + " innerHeight=" + innerHeight;
        if (r.width <= 0 || r.height <= 0) return { res: "invisible", measure };
        if (r.top < 0 || r.bottom > innerHeight) return { res: "out-of-viewport", measure };
        var centerOff = Math.abs((r.top + r.bottom) / 2 - innerHeight / 2);
        if (centerOff > 80) return { res: "not-centred:off=" + Math.round(centerOff), measure };
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (el !== b && !b.contains(el)) return { res: "covered:" + (el ? el.tagName : "none"), measure };
        b.click();
        return { res: "ok", measure };
      });
      console.log("[restore-measure] r3.b6 " + restoreRes.measure);
      // Tab (issue #1): also write the measurement to the CI step summary so
      // it is readable on the run page without admin log access.
      { const ghs = process.env.GITHUB_STEP_SUMMARY; if (ghs) { try { fs.appendFileSync(ghs, "[restore-measure] r3.b6 " + restoreRes.measure + "\n"); } catch (e) {} } }
      assert(restoreRes.res === "ok", "Restore button visible + hit-testable, got: " + restoreRes.res + " [" + restoreRes.measure + "]");
      await wait(200);
      const res = await page.evaluate((w) => ({ has: planHasMeals(w) }), tw);
      assert(res.has, "restore should bring the meals back");
      const lc = await getLC(page);
      assert(!lc, "park should be consumed by restore");
      await page.close();
    });
  }

  /* ---------------- Bug 7: buildWeek removes other weeks' parks ---------------- */
  if (run("b7")) await test("r3.b7.build-other-week-keeps-park", async () => {
    const page = await freshPage(browser);
    const { tw, nw } = await weeks(page);
    await buildViaUI(page, nw);
    await page.click('[data-act="week-clear"]');
    await wait(150);
    await page.click('#bottomNav button[data-tab="today"]');
    await wait(150);
    let lc = await getLC(page);
    assert(!!lc && lcHasMeals(lc[nw]), "setup: park should hold next week in the per-week map: " + JSON.stringify(lc && Object.keys(lc)));
    await buildViaUI(page, tw);
    lc = await getLC(page);
    assert(!!lc && lcHasMeals(lc[nw]), "building THIS week must not delete NEXT week's park: " + JSON.stringify(lc && Object.keys(lc)));
    await buildViaUI(page, nw);
    lc = await getLC(page);
    assert(!lc || !lc[nw], "building the parked week itself should clear its park");
    await page.close();
  });
} finally {
  await browser.close();
}
console.log("\n==== R3 suite (" + filter + ", width " + DW + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
