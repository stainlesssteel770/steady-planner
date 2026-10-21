// Batch 3 tests for Steady PWA: lastCleared in backup/restore + dice Undo
// toast through the REAL buttons. Usage: node test-r8.mjs [backup|dice|all]
// WIDTH env overrides the default viewport width.
import puppeteer from "puppeteer-core";
import fs from "node:fs";

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
  page.__dialogs = [];
  page.on("pageerror", (e) => page.__errs.push(e.message));
  page.on("dialog", async (d) => { page.__dialogs.push(d.message()); try { await d.accept(); } catch (e) {} });
  await page.setViewport({ width: width || DW, height: 844 });
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
const setParkRaw = (page, map) => page.evaluate((map) => {
  if (map) localStorage.setItem("steady.lastCleared", JSON.stringify(map));
  else localStorage.removeItem("steady.lastCleared");
}, map);
const parkDoc = { f: { m1D: { v: { id: "c1" }, ts: 5 } } };

async function restoreFrom(page, obj, fname) {
  const path = "/tmp/testbed/" + fname;
  fs.writeFileSync(path, JSON.stringify(obj));
  const input = await page.$("#restoreInput");
  assert(input, "restore input missing");
  await input.uploadFile(path);
  await wait(700);
}

const filter = process.argv[2] || "all";
const run = (id) => filter === "all" || filter === id;

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ================= Item 1: lastCleared travels with the backup ================= */
  if (run("backup")) {
    await test("r8.backup.park-included-in-download", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await setParkRaw(page, { [tw]: { doc: parkDoc, at: 123 } });
      await page.evaluate(() => {
        window.__cap = null;
        URL.createObjectURL = (b) => { window.__cap = b; return "data:application/json,{}"; };
        openSettings();
      });
      await wait(200);
      // The button's centre is covered by the dialog's sticky .dlg-actions
      // bar, so a coordinate click lands on the bar; activate the real
      // button element itself (its real handler runs either way).
      await page.evaluate(() => document.getElementById("backupBtn").click());
      await wait(300);
      const text = await page.evaluate(() => window.__cap ? window.__cap.text() : null);
      assert(text, "backup blob was not captured");
      const payload = JSON.parse(text);
      assert(payload.lastCleared && payload.lastCleared[tw], "backup has no lastCleared entry for the parked week");
      assert(payload.lastCleared[tw].doc.f.m1D.v.id === "c1", "parked doc did not survive into the backup");
      await page.close();
    });

    await test("r8.backup.restore-brings-park-back", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await restoreFrom(page, {
        settings: { f: {} }, days: {}, plans: {},
        lastCleared: { [tw]: { doc: parkDoc, at: 999 } }
      }, "r8-with-park.json");
      const got = await page.evaluate((tw) => {
        const m = JSON.parse(localStorage.getItem("steady.lastCleared") || "null");
        const e = readLastCleared(tw);
        return { stored: m, restorable: !!(e && e.doc && e.doc.f.m1D) };
      }, tw);
      assert(got.stored && got.stored[tw], "restored backup did not store the parked plan");
      assert(got.restorable, "readLastCleared does not see the restored park");
      await page.close();
    });

    await test("r8.backup.old-format-leaves-parks-untouched", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await setParkRaw(page, { [tw]: { doc: parkDoc, at: 42 } });
      await restoreFrom(page, { settings: { f: {} }, days: {}, plans: {} }, "r8-old-format.json");
      const still = await page.evaluate((tw) => {
        const m = JSON.parse(localStorage.getItem("steady.lastCleared") || "null");
        return !!(m && m[tw]);
      }, tw);
      assert(still, "old-format restore wiped the phone's existing park");
      await page.close();
    });

    await test("r8.backup.malformed-lastCleared-dropped-and-counted", async () => {
      const page = await freshPage(browser);
      const { tw } = await weeks(page);
      await restoreFrom(page, {
        settings: { f: {} }, days: {}, plans: {},
        lastCleared: { [tw]: { doc: parkDoc, at: 7 }, "2099-01-03": { doc: "nope" }, "2099-01-10": 42 }
      }, "r8-malformed.json");
      const got = await page.evaluate((tw) => {
        const m = JSON.parse(localStorage.getItem("steady.lastCleared") || "null");
        return m ? Object.keys(m) : null;
      }, tw);
      assert(got && got.length === 1 && got[0] === tw, "expected only the valid park to survive, got: " + JSON.stringify(got));
      const alertMsg = page.__dialogs.find((m) => /Backup restored/.test(m)) || "";
      assert(/2 bad values were ignored/.test(alertMsg), "expected the 2 dropped entries counted in the alert, got: " + alertMsg);
      await page.close();
    });
  }

  /* ================= Item 2: dice Undo toast + wiring, real button ================= */
  if (run("dice")) {
    const toastText = (page) => page.evaluate(() => {
      const t = document.querySelector(".undo-toast span");
      return t ? t.textContent : null;
    });
    const cellVal = (page, week, k) => page.evaluate((week, k) => {
      const c = planCells(week)[k];
      return c === undefined ? null : c;
    }, week, k);

    await test("r8.dice.toast-and-undo-restores", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page); // next week: every day is in the future, so every card renders its dice
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt"], m1D: { id: "c1" }, m2L: { lo: 1 }, m2D: { id: "y3" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      await page.click('[data-act="shuffle-one"][data-k="m1D"]');
      await wait(350);
      const after = await cellVal(page, nw, "m1D");
      assert(after && after.id && after.id !== "c1", "dice did not change Monday dinner: " + JSON.stringify(after));
      const txt = await toastText(page);
      assert(txt && /^Changed Monday dinner\./.test(txt), "expected the dice Undo toast, got: " + txt);
      await page.click(".undo-toast button");
      await wait(300);
      const back = await cellVal(page, nw, "m1D");
      assert(back && back.id === "c1", "Undo did not restore Monday dinner: " + JSON.stringify(back));
      assert(page.__errs.length === 0, "page errors: " + page.__errs.join(" | "));
      await page.close();
    });

    await test("r8.dice.forward-ui-meat-lo-before-dairy", async () => {
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt"], m1D: { id: "c1" }, m2L: { lo: 1 }, m2D: { id: "y3" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      let landed = 0, suffixSeen = false;
      for (let i = 0; i < 40 && !landed; i++) {
        // restore the scenario before each real click: Tue lunch = Mon leftovers
        await page.evaluate((nw) => {
          state.plans[nw].f.m2L = { v: { lo: 1 }, ts: Date.now() };
          saveLocal(); render(true);
        }, nw);
        await wait(60);
        await page.click('[data-act="shuffle-one"][data-k="m1D"]');
        await wait(200);
        const r = await page.evaluate((nw) => {
          const cells = planCells(nw);
          const M = PLAN_DATA.MEALS;
          const d = cells.m1D && cells.m1D.id ? M[cells.m1D.id] : null;
          const t = document.querySelector(".undo-toast span");
          return { meatLo: !!(d && d.t === "M" && d.lo), lunch: cells.m2L === undefined ? null : cells.m2L, toast: t ? t.textContent : null };
        }, nw);
        if (r.meatLo) {
          landed++;
          assert(!(r.lunch && r.lunch.lo), "FORWARD: meat leftovers lunch kept against Tuesday's dairy dinner");
          if (r.toast && /Tuesday's lunch updated too\./.test(r.toast)) suffixSeen = true;
        }
      }
      assert(landed >= 1, "sanity: meat-lo dinner never landed in 40 real dice clicks");
      assert(suffixSeen, "the knock-on toast suffix 'Tuesday's lunch updated too.' never appeared");
      await page.close();
    });

    await test("r8.dice.reverse-ui-no-dairy-under-meat-leftovers", async () => {
      // UPDATED with the user's approval for Batch 4 item 1: the dinner
      // dice hard-filters against the same-day lunch, so through the real
      // button a dairy dinner can NEVER land under Tuesday's meat
      // leftovers lunch (previously: land dairy, then re-pick the lunch).
      const page = await freshPage(browser);
      const { nw } = await weeks(page);
      await seed(page, nw, { pro: ["chicken", "salmon", "yogurt"], m1D: { id: "c1" }, m2L: { lo: 1 }, m2D: { id: "c4" } });
      await gotoPlan(page, nw, "week");
      await wait(200);
      let dairy = 0, changes = 0, prev = "c4";
      for (let i = 0; i < 40; i++) {
        await page.click('[data-act="shuffle-one"][data-k="m2D"]');
        await wait(200);
        const r = await page.evaluate((nw) => {
          const cells = planCells(nw);
          const M = PLAN_DATA.MEALS;
          const d = cells.m2D && cells.m2D.id ? M[cells.m2D.id] : null;
          return { tag: d ? d.t : null, id: d ? d.id : null, lunchLo: !!(cells.m2L && cells.m2L.lo) };
        }, nw);
        assert(r.lunchLo, "the meat leftovers lunch changed on roll " + i);
        if (r.tag === "D") dairy++;
        if (r.id !== prev) { changes++; prev = r.id; }
      }
      assert(changes >= 5, "sanity: dinner barely changed across 40 rolls (" + changes + ")");
      assert(dairy === 0, "dairy dinner landed under meat leftovers lunch in " + dairy + "/40 real rolls");
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("\n==== R8 suite (" + filter + ", width " + DW + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
