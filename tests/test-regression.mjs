// Reconstructed regression suite for Steady rounds 1+2 behaviours.
// NOTE: the original round-1 (test.mjs/test2.mjs/test3.mjs) and round-2
// (test-r2a/b/c.mjs) files were lost when /tmp was wiped between sessions.
// This suite re-covers the behaviours those rounds shipped, prioritising
// everything that shares code paths with the Round 3 changes.
import puppeteer from "puppeteer-core";
import fs from "fs";

const CHROME = process.env.CHROME_PATH || "/home/hatch/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome";
const URL = "http://localhost:8899/steady-planner/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e) { failed++; console.log("FAIL  " + name + "  — " + e.message); }
}
async function freshPage(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width: width || 390, height: height || 844 });
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
const clickSel = async (page, sel) => {
  await page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error("missing " + s); el.click(); }, sel);
  await wait(150);
};
async function buildViaUI(page, week) {
  await gotoPlan(page, week, "pro");
  await clickSel(page, '.protein-chip[data-id="chicken"]');
  await clickSel(page, '.protein-chip[data-id="eggs"]');
  await clickSel(page, '[data-act="build"]');
  await wait(250);
}

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* Round 2: picker rule directions + leftovers row + hint */
  await test("reg.picker-rule-directions", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    // lunch picker with a MEAT dinner tonight: dairy lunches must SHOW
    await seed(page, tw, { pro: ["chicken", "yogurt"], m3D: { id: "c4" } });
    await gotoPlan(page, tw, "week");
    await page.evaluate(() => openMealPicker("m3L"));
    await page.waitForSelector(".mp-opt", { timeout: 5000 });
    let ids = await page.evaluate(() => Array.from(document.querySelectorAll('.mp-opt[data-id]')).map((e) => e.getAttribute("data-id")));
    assert(ids.some((i) => i === "y1" || i === "y2"), "dairy lunch should show before meat dinner: " + ids.join(","));
    await page.evaluate(() => closeMealPicker());
    // dinner picker with a DAIRY lunch today: meat dinners must SHOW
    await seed(page, tw, { pro: ["chicken", "yogurt"], m3L: { id: "y1" } });
    await page.evaluate(() => { render(true); openMealPicker("m3D"); });
    await page.waitForSelector(".mp-opt", { timeout: 5000 });
    ids = await page.evaluate(() => Array.from(document.querySelectorAll('.mp-opt[data-id]')).map((e) => e.getAttribute("data-id")));
    assert(ids.some((i) => i === "c4" || i === "c1"), "meat dinner should show after dairy lunch: " + ids.join(","));
    assert(ids.some((i) => i === "y3" || i === "y5" || i === "y6"), "dairy dinner should also show after dairy lunch: " + ids.join(","));
    await page.evaluate(() => closeMealPicker());
    // dinner picker with a MEAT lunch today: dairy dinners move to the
    // batch-4 item-3 override section (shown, marked, still pickable)
    await seed(page, tw, { pro: ["chicken", "yogurt"], m3L: { id: "c3" } });
    await page.evaluate(() => { render(true); openMealPicker("m3D"); });
    await page.waitForSelector(".mp-opt", { timeout: 5000 });
    const r = await page.evaluate(() => ({
      ids: Array.from(document.querySelectorAll('.mp-opt[data-id]')).map((e) => e.getAttribute("data-id")),
      blockedIds: Array.from(document.querySelectorAll('.mp-opt-blocked[data-id]')).map((e) => e.getAttribute("data-id")),
      hint: (document.querySelector(".mp-hint") || {}).textContent || ""
    }));
    const dairyShown = r.ids.filter((i) => ["y3", "y4", "y5", "y6"].indexOf(i) >= 0);
    assert(dairyShown.length > 0, "dairy dinners should show in the override section after meat lunch: " + r.ids.join(","));
    assert(dairyShown.every((i) => r.blockedIds.indexOf(i) >= 0), "every dairy dinner must be marked not-usually-allowed: " + r.blockedIds.join(","));
    assert(/Not usually allowed/.test(r.hint), "hint should explain the override section: " + r.hint);
    await page.close();
  });

  await test("reg.picker-leftovers-row-blocked", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    // meat leftover lunch (of Mon dinner c1) before a DAIRY dinner Tue: the
    // row moves to the batch-4 item-3 override section (shown, marked)
    await seed(page, tw, { pro: ["chicken", "yogurt"], m1D: { id: "c1" }, m2D: { id: "y4" } });
    await gotoPlan(page, tw, "week");
    await page.evaluate(() => openMealPicker("m2L"));
    await page.waitForSelector(".mp-opt", { timeout: 5000 });
    const lo = await page.evaluate(() => {
      const b = document.querySelector('[data-act="mp-lo"]');
      return b ? { found: true, blocked: b.classList.contains("mp-opt-blocked") } : { found: false, blocked: false };
    });
    assert(lo.found && lo.blocked, "meat leftovers row must show in the override section before a dairy dinner: " + JSON.stringify(lo));
    await page.close();
  });

  /* Round 2 bug 6 (original): non-lo dinner pick replaces tomorrow's lo lunch */
  await test("reg.dinner-pick-replaces-lo-lunch", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await seed(page, tw, { pro: ["salmon", "chicken"], m2D: { id: "c1" }, m3L: { lo: 1 } });
    await gotoPlan(page, tw, "week");
    await page.evaluate(() => openMealPicker("m2D"));
    await page.waitForSelector('.mp-opt[data-id="sa3"]', { timeout: 5000 });
    await page.click('.mp-opt[data-id="sa3"]');
    await wait(300);
    const res = await page.evaluate(() => {
      const cells = planCells(weekSunday(todayStr));
      const toast = document.querySelector(".undo-toast");
      return { m3L: cells.m3L || null, span: toast && toast.querySelector("span") ? toast.querySelector("span").textContent : null, btn: toast ? !!toast.querySelector("button") : false, day: PLAN_ENGINE.DAYN[2] };
    });
    assert(res.m3L && res.m3L.id, "lo lunch should be replaced with a real meal: " + JSON.stringify(res));
    assert(res.span && res.span.indexOf("Changed " + res.day + " dinner.") === 0 && res.btn, "Undo toast expected: " + JSON.stringify(res));
    await page.close();
  });

  /* Round 2: surgical undo (Uncheck all) */
  await test("reg.surgical-undo-uncheck-all", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.shop-line input[data-act="gtick"][data-id]')).slice(0, 2).map((e) => e.getAttribute("data-id")));
    assert(ids.length >= 2, "need at least 2 shop lines");
    await clickSel(page, '.shop-line input[data-id="' + ids[0] + '"]');
    await clickSel(page, '[data-act="uncheck-all"]');
    await page.waitForSelector(".undo-toast button", { timeout: 5000 });
    await clickSel(page, '.shop-line input[data-id="' + ids[1] + '"]'); // edit inside the window
    await clickSel(page, ".undo-toast button");
    await wait(200);
    const res = await page.evaluate((a, b) => {
      const cells = planCells(weekSunday(todayStr));
      return { a: !!cells["g_" + a], b: !!cells["g_" + b] };
    }, ids[0], ids[1]);
    assert(res.a === true, "unchecked item should be restored by undo: " + JSON.stringify(res));
    assert(res.b === true, "item ticked during the window must survive undo: " + JSON.stringify(res));
    await page.close();
  });

  /* Round 2: dialog history — Back closes dialog only; tab re-tap pushes nothing */
  await test("reg.dialog-back-and-retap", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await page.evaluate(() => openMealPicker("m3L"));
    await page.waitForFunction(() => document.getElementById("mealPickerDlg").open, { timeout: 5000 });
    await page.goBack();
    await wait(250);
    let st = await page.evaluate(() => ({ dlg: document.getElementById("mealPickerDlg").open, tab: ui.tab }));
    assert(!st.dlg && st.tab === "plan", "Back should close only the picker: " + JSON.stringify(st));
    await page.click("#gearBtn");
    await page.waitForFunction(() => document.getElementById("settingsDlg").open, { timeout: 5000 });
    await page.goBack();
    await wait(250);
    st = await page.evaluate(() => ({ dlg: document.getElementById("settingsDlg").open, tab: ui.tab }));
    assert(!st.dlg && st.tab === "plan", "Back should close only Settings: " + JSON.stringify(st));
    const len = await page.evaluate(() => history.length);
    await page.click('#bottomNav button[data-tab="plan"]'); // re-tap current tab
    await wait(150);
    const len2 = await page.evaluate(() => history.length);
    assert(len2 === len, "re-tapping the current tab must not push history: " + len + " -> " + len2);
    await page.close();
  });

  /* Round 2: picker opens scrolled to top */
  await test("reg.picker-scroll-top", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await seed(page, tw, { pro: ["salmon", "tuna", "chicken", "eggs"] });
    await gotoPlan(page, tw, "week");
    await page.evaluate(() => openMealPicker("m3L"));
    await page.waitForSelector(".mp-opt", { timeout: 5000 });
    await page.evaluate(() => { document.getElementById("mpList").scrollTop = 250; });
    await page.click("#mpClose");
    await wait(150);
    await page.evaluate(() => openMealPicker("m3L"));
    await wait(300);
    const top = await page.evaluate(() => document.getElementById("mpList").scrollTop);
    assert(top === 0, "picker should reopen at scrollTop 0, got " + top);
    await page.close();
  });

  /* Round 2: toast width + dismissed on tab change */
  await test("reg.toast-width-and-tab-dismiss", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await clickSel(page, '[data-act="week-clear"]');
    await page.waitForSelector(".undo-toast", { timeout: 5000 });
    const w = await page.evaluate(() => document.querySelector(".undo-toast").getBoundingClientRect().width);
    assert(w >= 340, "toast width at 390 should be >= 340, got " + w);
    await page.click('#bottomNav button[data-tab="today"]');
    await wait(200);
    const gone = await page.evaluate(() => !document.querySelector(".undo-toast"));
    assert(gone, "undo toast should be dismissed on tab change");
    await page.close();
  });

  /* Round 2: share fallback on non-Abort rejection; Abort does nothing */
  await test("reg.share-fallback", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    await page.evaluate(() => {
      window.__copied = null;
      try { Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) {}
      if (!navigator.clipboard || !navigator.clipboard.writeText) navigator.__noClip = true;
      navigator.share = () => Promise.reject(Object.assign(new Error("nope"), { name: "NotAllowedError" }));
    });
    await clickSel(page, '[data-act="share-shop"]');
    await wait(300);
    let res = await page.evaluate(() => ({ copied: window.__copied, noClip: !!navigator.__noClip, btn: (document.querySelector('[data-act="share-shop"]') || {}).textContent }));
    assert(res.copied || /Copied/.test(res.btn || ""), "non-Abort share rejection should fall back to copy: " + JSON.stringify(res));
    await page.evaluate(() => { window.__copied = null; navigator.share = () => Promise.reject(Object.assign(new Error("cancel"), { name: "AbortError" })); });
    await clickSel(page, '[data-act="share-shop"]');
    await wait(300);
    res = await page.evaluate(() => ({ copied: window.__copied }));
    assert(!res.copied, "AbortError must not fall back to copy");
    await page.close();
  });

  /* Round 2 add 3: Copy unticked only */
  await test("reg.copy-unticked-only", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    await page.evaluate(() => {
      window.__copied = null;
      try { Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) {}
      navigator.share = undefined;
    });
    const lines = await page.evaluate(() => Array.from(document.querySelectorAll('.shop-line input[data-act="gtick"][data-id]')).slice(0, 2).map((e) => ({ id: e.getAttribute("data-id"), name: e.getAttribute("aria-label") })));
    assert(lines.length >= 2, "need 2 shop lines");
    await clickSel(page, '.shop-line input[data-id="' + lines[0].id + '"]');
    await clickSel(page, '[data-act="share-shop-unticked"]');
    await wait(300);
    const txt = await page.evaluate(() => window.__copied);
    assert(typeof txt === "string" && txt.length > 0, "unticked copy should produce text");
    assert(txt.indexOf(lines[0].name) < 0, "ticked item must be excluded: " + lines[0].name);
    assert(txt.indexOf(lines[1].name) >= 0, "unticked item must be included: " + lines[1].name);
    await page.close();
  });

  /* Round 1: Enter-to-add custom shop item */
  await test("reg.enter-adds-custom-item", async () => {
    const page = await freshPage(browser);
    const { tw } = await weeks(page);
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    await page.click("#customAdd");
    await page.type("#customAdd", "Zebra snacks");
    await page.keyboard.press("Enter");
    await wait(250);
    const found = await page.evaluate(() => Array.from(document.querySelectorAll(".shop-line .nm")).some((e) => e.textContent === "Zebra snacks"));
    assert(found, "custom item should appear after Enter");
    await page.close();
  });

  /* Round 1: weekly check-in inline error */
  await test("reg.checkin-inline-error", async () => {
    const page = await freshPage(browser);
    await page.evaluate(() => { document.getElementById("weighDetails").open = true; });
    await page.evaluate(() => { document.getElementById("ciWeight").value = "999"; });
    await clickSel(page, '[data-act="checkin-save"]');
    await wait(200);
    const res = await page.evaluate(() => {
      const e = document.getElementById("ciError");
      return { hidden: !e || e.hidden, text: e ? e.textContent : "" };
    });
    assert(!res.hidden && /[Ww]eight/.test(res.text), "check-in error should show inline: " + JSON.stringify(res));
    await page.close();
  });

  /* Round 2/3 boundary: pluralization with exactly 1 genuinely bad value (+ null tombstone valid) */
  await test("reg.pluralize-one-bad-value", async () => {
    const page = await freshPage(browser);
    const dialogs = [];
    page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
    const { tw } = await weeks(page);
    const backup = { settings: { f: {} }, favorites: { items: {} }, days: {}, grocery: { f: {} },
      plans: { [tw]: { f: {
        pro: { v: ["chicken", "yogurt"], ts: 111 },
        m1D: { v: { id: 123 }, ts: 112 },
        m2L: { v: null, ts: 113 }
      } } } };
    fs.writeFileSync("/tmp/testbed/backup-reg.json", JSON.stringify(backup));
    const input = await page.$("#restoreInput");
    await input.uploadFile("/tmp/testbed/backup-reg.json");
    for (let i = 0; i < 30 && dialogs.length < 2; i++) await wait(150);
    const alertMsg = dialogs[dialogs.length - 1] || "";
    assert(alertMsg === "Backup restored — 1 bad value was ignored.", "expected singular message, got: " + alertMsg);
    await page.close();
  });

  /* 360px: cooking-for one line + no horizontal overflow on main views */
  await test("reg.cooking-for-and-overflow-360", async () => {
    const page = await freshPage(browser, 360, 740);
    const { tw } = await weeks(page);
    const wToday = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(wToday <= 360, "Today overflows at 360: " + wToday);
    await gotoPlan(page, tw, "pro");
    const srv = await page.evaluate(() => Array.from(document.querySelectorAll(".srv-val")).map((e) => e.offsetHeight));
    assert(srv.length === 4 && srv.every((h) => h <= 30), "cooking-for values should be one line at 360: " + JSON.stringify(srv));
    await buildViaUI(page, tw);
    await gotoPlan(page, tw, "shop");
    const wShop = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(wShop <= 360, "Shop overflows at 360: " + wShop);
    await page.click('#bottomNav button[data-tab="workout"]');
    await wait(200);
    const wWo = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(wWo <= 360, "Workout overflows at 360: " + wWo);
    await page.close();
  });
} finally {
  await browser.close();
}
console.log("\n==== Regression suite (reconstructed rounds 1+2): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
