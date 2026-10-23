/* Steady BETA BATCH 2 (steady-v20) suite — real buttons throughout.
   Sections: install (item 1) | testmode (item 2) | legend (item 3) |
             fade (item 4) | dots (item 5) | variety (item 6)
   Usage: node test-r11.mjs [section|all]   (WIDTH env, default 390) */
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
async function freshPage(browser, preHook) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 844 });
  page.on("dialog", (d) => d.accept());
  if (preHook) await preHook(page);
  await page.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => window.PLAN_ENGINE && window.PLAN_DATA && document.getElementById("main"));
  await wait(350);
  return page;
}
const clickBtn = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.click();
  return true;
}, sel);
const fireInstallPrompt = (page, outcome) => page.evaluate((outcome) => {
  window.__promptCalls = 0;
  const ev = new Event("beforeinstallprompt");
  ev.__stub = true;
  ev.prompt = () => { window.__promptCalls++; };
  ev.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(ev);
}, outcome);
/* Headless Chrome fires a REAL beforeinstallprompt for this installable
   app; intercept it before app.js loads so the stub controls timing. */
const blockRealPrompt = async (p) => {
  await p.evaluateOnNewDocument(() => {
    window.addEventListener("beforeinstallprompt", (e) => { if (!e.__stub) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  });
};

const section = process.argv[2] || "all";
const run = (s) => section === "all" || section === s;
const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  /* ================= Item 1: install button + banner ================= */
  if (run("install")) {
    await test("r11.install.prompt-flow-banner-and-settings", async () => {
      const page = await freshPage(browser, blockRealPrompt);
      await page.evaluate(() => { localStorage.removeItem("steady.installAccepted"); localStorage.removeItem("steady.installDismissed"); refreshInstallUI(); });
      // No prompt captured yet and not iOS: banner and settings row stay hidden.
      let vis = await page.evaluate(() => ({
        banner: !document.getElementById("installBanner").hidden,
        fld: !document.getElementById("installFld").hidden,
      }));
      assert(!vis.banner && !vis.fld, "before any prompt, install UI should be hidden: " + JSON.stringify(vis));
      await fireInstallPrompt(page, "accepted");
      await wait(150);
      vis = await page.evaluate(() => ({
        banner: !document.getElementById("installBanner").hidden,
        fld: !document.getElementById("installFld").hidden,
      }));
      assert(vis.banner && vis.fld, "after beforeinstallprompt, banner + settings row should show: " + JSON.stringify(vis));
      assert(await clickBtn(page, "#installBtnBanner"), "banner Install button missing");
      await wait(300);
      const after = await page.evaluate(() => ({
        calls: window.__promptCalls,
        accepted: localStorage.getItem("steady.installAccepted"),
        banner: !document.getElementById("installBanner").hidden,
      }));
      assert(after.calls === 1, "the browser prompt should have fired once, got " + after.calls);
      assert(after.accepted === "1" && !after.banner, "accepted should hide the banner and persist: " + JSON.stringify(after));
      await page.reload({ waitUntil: "networkidle0" });
      await wait(350);
      const still = await page.evaluate(() => ({
        banner: !document.getElementById("installBanner").hidden,
        fld: !document.getElementById("installFld").hidden,
      }));
      assert(!still.banner && !still.fld, "after acceptance + reload, install UI stays hidden: " + JSON.stringify(still));
      await page.close();
    });

    await test("r11.install.ios-steps-and-dismiss", async () => {
      const page = await freshPage(browser, blockRealPrompt);
      await page.evaluate(() => { localStorage.removeItem("steady.installAccepted"); localStorage.removeItem("steady.installDismissed"); refreshInstallUI(); });
      await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
      await page.reload({ waitUntil: "networkidle0" });
      await wait(350);
      let vis = await page.evaluate(() => !document.getElementById("installBanner").hidden);
      assert(vis, "iPhone (no prompt event) should still get the banner");
      assert(await clickBtn(page, "#installBtnBanner"), "banner Install button missing (iOS)");
      await wait(200);
      const steps = await page.evaluate(() => !document.getElementById("iosStepsBanner").hidden);
      assert(steps, "iOS Install should reveal the Share > Add to Home Screen steps");
      assert(await clickBtn(page, "#installDismiss"), "banner dismiss button missing");
      await wait(200);
      vis = await page.evaluate(() => !document.getElementById("installBanner").hidden);
      assert(!vis, "dismiss should hide the banner");
      await page.reload({ waitUntil: "networkidle0" });
      await wait(350);
      const after = await page.evaluate(() => ({
        banner: !document.getElementById("installBanner").hidden,
        dismissed: localStorage.getItem("steady.installDismissed"),
        accepted: localStorage.getItem("steady.installAccepted"),
      }));
      assert(!after.banner && after.dismissed === "1" && !after.accepted, "dismissal persists across reload without pretending acceptance: " + JSON.stringify(after));
      await page.close();
    });

    await test("r11.install.standalone-hides-everything", async () => {
      const page = await freshPage(browser, async (p) => {
        await blockRealPrompt(p);
        await p.evaluateOnNewDocument(() => {
          const orig = window.matchMedia.bind(window);
          window.matchMedia = (q) => String(q).indexOf("display-mode") >= 0
            ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
            : orig(q);
        });
      });
      await page.evaluate(() => { localStorage.removeItem("steady.installAccepted"); localStorage.removeItem("steady.installDismissed"); refreshInstallUI(); });
      await fireInstallPrompt(page, "accepted");
      await wait(150);
      const vis = await page.evaluate(() => ({
        banner: !document.getElementById("installBanner").hidden,
        fld: !document.getElementById("installFld").hidden,
      }));
      assert(!vis.banner && !vis.fld, "standalone (already installed) should never show install UI: " + JSON.stringify(vis));
      await page.close();
    });
  }
  /* ================= Item 2: test mode (Act like Sunday) ================= */
  if (run("testmode")) {
    const storeMap = (page) => page.evaluate(() => {
      const m = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf("steady.") === 0) m[k] = localStorage.getItem(k); }
      return m;
    });
    const openSettings = async (page) => {
      assert(await clickBtn(page, "#gearBtn"), "gear button missing");
      await wait(400);
      const open = await page.evaluate(() => document.getElementById("settingsDlg").open);
      assert(open, "settings dialog should open");
    };
    const waitReload = async (page) => {
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {});
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(400);
    };

    await test("r11.testmode.on-off-restores-byte-for-byte", async () => {
      const page = await freshPage(browser);
      const prep = await page.evaluate(() => {
        ui.tab = "today"; saveUi();
        state.days = {}; state.days[todayStr] = { proteinB: 1 }; saveLocal();
        return { real: todayStr, fake: addDays(todayStr, (7 - dowOf(todayStr)) % 7) };
      });
      const before = await storeMap(page);
      await openSettings(page);
      assert(await clickBtn(page, "#tmToggle"), "test-mode toggle missing in Settings");
      await waitReload(page);
      const on = await page.evaluate(() => ({
        today: todayStr,
        tm: JSON.parse(localStorage.getItem("steady.testmode") || "null"),
        snap: JSON.parse(localStorage.getItem("steady.testsnap") || "null"),
        banner: !!document.querySelector(".testmode-banner"),
        bannerText: (document.querySelector(".testmode-banner") || {}).textContent || "",
      }));
      assert(on.today === prep.fake, "while on, today should be the coming Sunday (" + prep.fake + "), got " + on.today);
      assert(on.tm && on.tm.fake === prep.fake, "steady.testmode should record the fake Sunday");
      assert(on.snap, "a snapshot should exist while test mode is on");
      assert(!("steady.testmode" in on.snap) && !("steady.testsnap" in on.snap), "the snapshot must exclude the test-mode keys themselves");
      assert(JSON.stringify(on.snap) === JSON.stringify(before), "the snapshot should equal the pre-test data exactly");
      assert(on.banner && on.bannerText.indexOf("Test mode: acting as Sunday") === 0, "banner should show on Today: " + on.bannerText);
      // Banner on every screen: switch to Plan and check again.
      assert(await clickBtn(page, '#bottomNav button[data-tab="plan"]'), "plan nav missing");
      await wait(300);
      const onPlan = await page.evaluate(() => !!document.querySelector(".testmode-banner"));
      assert(onPlan, "banner should also show on the Plan tab");
      assert(await clickBtn(page, '#bottomNav button[data-tab="today"]'), "today nav missing");
      await wait(300);
      // A real change in test mode: tick a protein box on the fake Sunday.
      const ticked = await page.evaluate(() => {
        const h = [...document.querySelectorAll(".habit")].find((e) => (e.querySelector(".habit-title") || {}).textContent === "Protein at every meal");
        const b = h && h.querySelector('[data-act="tick"]');
        if (!b) return false;
        b.click();
        return true;
      });
      assert(ticked, "protein tick button missing in test mode");
      await wait(300);
      const changed = await page.evaluate((fake) => {
        const st = JSON.parse(localStorage.getItem("steady.state") || "{}");
        return !!(st.days && st.days[fake]);
      }, prep.fake);
      assert(changed, "the test-mode tick should land on the fake Sunday (" + prep.fake + ")");
      // Turn off from the banner (real button).
      assert(await clickBtn(page, '[data-act="tm-off"]'), "banner Turn off button missing");
      await waitReload(page);
      const after = await storeMap(page);
      assert(!("steady.testmode" in after), "turning off must leave no steady.testmode key");
      assert(!("steady.testsnap" in after), "turning off must leave no steady.testsnap key");
      assert(JSON.stringify(after) === JSON.stringify(before), "data after turn-off must equal the pre-test data byte-for-byte.\nbefore: " + JSON.stringify(before) + "\nafter:  " + JSON.stringify(after));
      const realAgain = await page.evaluate(() => todayStr);
      assert(realAgain === prep.real, "today should be the real day again, got " + realAgain);
      await page.close();
    });

    await test("r11.testmode.auto-off-after-12h-restores", async () => {
      const page = await freshPage(browser);
      await page.evaluate(() => {
        const uiNow = JSON.parse(localStorage.getItem("steady.ui") || "{}");
        uiNow.tab = "today";
        localStorage.setItem("steady.ui", JSON.stringify(uiNow));
        localStorage.setItem("steady.testsnap", JSON.stringify({ "steady.ui": JSON.stringify({ tab: "meals" }) }));
        localStorage.setItem("steady.testmode", JSON.stringify({ fake: "2030-01-06", lastSeen: Date.now() - 13 * 3600 * 1000 }));
      });
      await page.reload({ waitUntil: "networkidle0" });
      await wait(400);
      const after = await page.evaluate(() => ({
        tm: localStorage.getItem("steady.testmode"),
        snap: localStorage.getItem("steady.testsnap"),
        ui: JSON.parse(localStorage.getItem("steady.ui") || "{}"),
        today: todayStr,
      }));
      assert(!after.tm && !after.snap, "auto-off should clear both test-mode keys: " + JSON.stringify(after));
      assert(after.ui.tab === "meals", "auto-off should restore the snapshot (ui.tab back to meals), got " + after.ui.tab);
      assert(after.today !== "2030-01-06", "today should be real again after auto-off");
      await page.close();
    });

    await test("r11.testmode.snapshot-failure-blocks-turn-on", async () => {
      const page = await freshPage(browser, async (p) => {
        await p.evaluateOnNewDocument(() => {
          const orig = Storage.prototype.setItem;
          Storage.prototype.setItem = function (k, v) {
            if (k === "steady.testsnap") throw new Error("QuotaExceededError");
            return orig.call(this, k, v);
          };
        });
      });
      await page.evaluate(() => { window.__alive = 42; });
      await openSettings(page);
      assert(await clickBtn(page, "#tmToggle"), "test-mode toggle missing in Settings");
      await wait(500);
      const res = await page.evaluate(() => ({
        tm: localStorage.getItem("steady.testmode"),
        msg: document.getElementById("tmMsg").textContent,
        msgHidden: document.getElementById("tmMsg").hidden,
        alive: window.__alive,
      }));
      assert(!res.tm, "test mode must NOT turn on when the snapshot write fails");
      assert(!res.msgHidden && res.msg.length > 0, "a short message should explain the blocked turn-on");
      assert(res.alive === 42, "the page must not reload when turn-on is blocked");
      await page.close();
    });

    await test("r11.testmode.backup-disabled-while-on", async () => {
      const page = await freshPage(browser);
      await openSettings(page);
      assert(await clickBtn(page, "#tmToggle"), "test-mode toggle missing in Settings");
      await waitReload(page);
      await openSettings(page);
      const res = await page.evaluate(() => ({
        backup: document.getElementById("backupBtn").disabled,
        restore: document.getElementById("restoreBtn").disabled,
        note: !document.getElementById("tmBackupNote").hidden,
        toggleLabel: document.getElementById("tmToggle").textContent,
      }));
      assert(res.backup && res.restore, "Export and Restore should be disabled while test mode is on: " + JSON.stringify(res));
      assert(res.note, "a note should explain why backup is off in test mode");
      assert(res.toggleLabel.indexOf("Turn off") === 0, "the settings toggle should offer Turn off while on, got: " + res.toggleLabel);
      assert(await clickBtn(page, "#tmToggle"), "test-mode toggle missing (turn off)");
      await waitReload(page);
      const off = await page.evaluate(() => ({ tm: localStorage.getItem("steady.testmode"), snap: localStorage.getItem("steady.testsnap") }));
      assert(!off.tm && !off.snap, "cleanup: test mode off and no keys left behind");
      await page.close();
    });
  }
  /* ================= Item 3: meals legend wording ================= */
  if (run("legend")) {
    await test("r11.legend.fish-wording-same-meal", async () => {
      const page = await freshPage(browser);
      const txt = await page.evaluate(() => {
        ui.tab = "meals"; saveUi(); render(true);
        const l = document.querySelector(".legend");
        return l ? l.textContent : "";
      });
      assert(txt.indexOf("never in the same meal as meat") >= 0, "legend should say fish is never in the same meal as meat, got: " + txt);
      assert(txt.indexOf("never eaten with meat") < 0, "the old legend wording should be gone, got: " + txt);
      await page.close();
    });
  }
  /* ================= Item 4: step bar fade only when scrollable ================= */
  if (run("fade")) {
    const seedPlan = (page, week, cells) => page.evaluate((week, cells) => {
      state.plans[week] = { f: {} };
      Object.keys(cells).forEach((k) => { state.plans[week].f[k] = { v: cells[k], ts: 1000 }; });
      saveLocal();
    }, week, cells);
    const gotoPlan = (page, week, step) => page.evaluate((week, step) => {
      ui.tab = "plan"; ui.planWs = week; ui.planStep = step; saveUi(); render(true);
    }, week, step);
    const barInfo = (page) => page.evaluate(() => {
      const bar = document.querySelector(".stepper-bar");
      if (!bar) return null;
      return { sw: bar.scrollWidth, cw: bar.clientWidth, sl: bar.scrollLeft, more: bar.classList.contains("more") };
    });

    await test("r11.fade.only-when-more-to-scroll", async () => {
      // Wide (suite width): the bar fits, so no fade class.
      const page = await freshPage(browser);
      const { nw } = await page.evaluate(() => { const tw = weekSunday(todayStr); return { nw: addDays(tw, 7) }; });
      await seedPlan(page, nw, { pro: ["chicken", "salmon"], m0D: { id: "c1" } });
      await gotoPlan(page, nw, "week");
      await wait(250);
      let info = await barInfo(page);
      assert(info, "step bar missing on the plan tab");
      assert(info.sw <= info.cw + 1, "setup: at width " + WIDTH + " the step bar should fit (sw " + info.sw + " vs cw " + info.cw + ")");
      assert(!info.more, "no fade when there is nothing more to scroll");
      await page.close();

      // Narrow (320): the bar overflows -> fade on; scrolled to the end -> fade off.
      const page2 = await browser.newPage();
      await page2.setViewport({ width: 320, height: 844 });
      page2.on("dialog", (d) => d.accept());
      await page2.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0", timeout: 90000 });
      await page2.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(350);
      const nw2 = await page2.evaluate(() => addDays(weekSunday(todayStr), 7));
      await seedPlan(page2, nw2, { pro: ["chicken", "salmon"], m0D: { id: "c1" } });
      await gotoPlan(page2, nw2, "week");
      await wait(250);
      info = await barInfo(page2);
      assert(info, "step bar missing at 320");
      assert(info.sw > info.cw + 1, "setup: at 320 the step bar should overflow (sw " + info.sw + " vs cw " + info.cw + ")");
      assert(info.more, "fade should show while there is more to scroll right");
      await page2.evaluate(() => { const bar = document.querySelector(".stepper-bar"); bar.scrollLeft = bar.scrollWidth; bar.dispatchEvent(new Event("scroll")); });
      await wait(250);
      info = await barInfo(page2);
      assert(!info.more, "fade should disappear once scrolled to the end: " + JSON.stringify(info));
      await page2.close();
    });
  }
  /* ================= Item 5: week dots fit at 320px ================= */
  if (run("dots")) {
    await test("r11.dots.fit-at-320-no-overflow", async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: 320, height: 844 });
      page.on("dialog", (d) => d.accept());
      await page.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0", timeout: 90000 });
      await page.waitForFunction(() => window.PLAN_ENGINE && document.getElementById("main"));
      await wait(350);
      const m = await page.evaluate(() => {
        ui.tab = "today"; saveUi(); render(true);
        const row = document.querySelector(".weekdots");
        const dots = [...document.querySelectorAll(".dot")].map((d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right }; });
        return {
          docSW: document.documentElement.scrollWidth, iw: window.innerWidth,
          rowSW: row ? row.scrollWidth : null, rowCW: row ? row.clientWidth : null,
          dots,
        };
      });
      assert(m.dots.length === 7, "expected 7 week dots, got " + m.dots.length);
      assert(m.docSW <= m.iw + 1, "page overflows horizontally at 320 (" + m.docSW + " > " + m.iw + ")");
      assert(m.rowSW <= m.rowCW + 1, "week-dots row content is wider than the row (" + m.rowSW + " > " + m.rowCW + ")");
      m.dots.forEach((d, i) => assert(d.left >= 0 && d.right <= m.iw + 1, "dot " + i + " outside the viewport: " + JSON.stringify(d)));
      await page.close();
    });
  }
  /* ================= Item 6: variety counts past days ================= */
  if (run("variety")) {
    const CTX6 = { week: "2026-10-18", today: "2026-10-21", rest: {}, pre: {} }; // Wed Oct 21 2026

    await test("r11.variety.past-dinners-not-repeated", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((ctx) => {
        const cells = { pro: ["chicken"], m0D: { id: "c1" }, m1D: { id: "c2" }, m2D: { id: "c4" } };
        const pastIds = ["c1", "c2", "c4"];
        let repeats = 0, pastChanged = 0, filled = 0;
        for (let i = 0; i < 30; i++) {
          const out = ENGINE.generate(ctx, JSON.parse(JSON.stringify(cells)), Math.random);
          ["m3D", "m4D"].forEach((k) => { // no Friday dinner slot (Shabbos)
            if (out[k] && out[k].id) { filled++; if (pastIds.indexOf(out[k].id) >= 0) repeats++; }
          });
          if (!out.m0D || out.m0D.id !== "c1" || !out.m1D || out.m1D.id !== "c2" || !out.m2D || out.m2D.id !== "c4") pastChanged++;
        }
        return { repeats, pastChanged, filled };
      }, CTX6);
      assert(res.filled === 60, "every generate should fill Wed+Thu dinners (60 slots), got " + res.filled);
      assert(res.repeats === 0, "Wed+Thu must not repeat a meal eaten Sun-Tue, got " + res.repeats + " repeats in 30 builds");
      assert(res.pastChanged === 0, "past days must pass through untouched");
      await page.close();
    });

    await test("r11.variety.past-long-meals-count-toward-cap", async () => {
      const page = await freshPage(browser);
      const res = await page.evaluate((ctx) => {
        // Batch 4 item 5 migrated this test to the hands-on definition:
        // Sun+Mon were the two long schnitzel dinners (z1: 35 hands-on,
        // z3: 45). The week's long-meal cap (2) is already spent, so
        // Wed+Thu must not get z4 (33) while other proteins exist. (The
        // old fixtures were the stew pots s1/s2 — 15-20 hands-on, no
        // longer "long" under the new definition. z5 at 28 is also not
        // long and may appear.)
        const cells = { pro: ["schnitzel", "chicken", "salmon"], m0D: { id: "z1" }, m1D: { id: "z3" }, m2D: { id: "c5" } };
        let longs = 0, filled = 0;
        for (let i = 0; i < 30; i++) {
          const out = ENGINE.generate(ctx, JSON.parse(JSON.stringify(cells)), Math.random);
          ["m3D", "m4D"].forEach((k) => { // no Friday dinner slot (Shabbos)
            if (out[k] && out[k].id) { filled++; if (out[k].id === "z4") longs++; }
          });
        }
        return { longs, filled };
      }, CTX6);
      assert(res.filled === 60, "every generate should fill Wed+Thu dinners, got " + res.filled);
      assert(res.longs === 0, "no long schnitzel dinner (z4) should appear Wed+Thu once two past longs spent the cap, got " + res.longs);
      await page.close();
    });

    await test("r11.variety.ui-shuffle-all-avoids-past-meals", async () => {
      const page = await freshPage(browser);
      const setup = await page.evaluate(() => {
        const tw = weekSunday(todayStr);
        const dow = dowOf(todayStr);
        const cells = { pro: ["chicken"] };
        const pastIds = [];
        const rotation = ["c1", "c2", "c4"];
        for (let d = 0; d < dow && d <= 5; d++) { cells["m" + d + "D"] = { id: rotation[d % 3] }; pastIds.push(rotation[d % 3]); }
        state.plans[tw] = { f: {} };
        Object.keys(cells).forEach((k) => { state.plans[tw].f[k] = { v: cells[k], ts: 1000 }; });
        saveLocal();
        ui.tab = "plan"; ui.planWs = tw; ui.planStep = "week"; saveUi(); render(true);
        return { tw, dow, pastIds };
      });
      if (setup.pastIds.length) {
        const btn = await page.$('button[data-act="shuffle-all"]');
        assert(btn, "Shuffle all button missing");
        await btn.click();
        await wait(400);
        const after = await page.evaluate((tw) => planCells(tw), setup.tw);
        for (let d = setup.dow; d <= 5; d++) {
          const c = after["m" + d + "D"];
          if (c && c.id) assert(setup.pastIds.indexOf(c.id) < 0, "day " + d + " dinner repeats a past meal (" + c.id + ") after Shuffle all");
        }
        for (let d = 0; d < setup.dow && d <= 5; d++) {
          const c = after["m" + d + "D"];
          assert(c && c.id === setup.pastIds[d], "past day " + d + " must be untouched by Shuffle all");
        }
      }
      await page.close();
    });
  }
} finally {
  await browser.close();
}
console.log("\n==== R11 suite (" + section + ", width " + WIDTH + "): " + passed + " passed, " + failed + " failed ====");
process.exit(failed ? 1 : 0);
