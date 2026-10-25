import { launch, seed, openPicker, planWeekCells, weekKeys, C, sleep, makeReporter } from "./r2help.mjs";
const { check, done } = makeReporter();
const { nextSun } = weekKeys();
const PRO = C(["chicken", "salmon", "yogurt", "eggs", "gbeef"]);
const base = { pro: PRO };
const uiWeek = { tab: "plan", planStep: "week", planWs: nextSun };

const { browser, page } = await launch(390);
await page.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0" });
await sleep(500);

// ---------- Bugs 1+2: picker rules ----------
async function scenario(cells) { await seed(page, { [nextSun]: { f: { ...base, ...cells } } }, uiWeek); }

// A: dairy dinner Monday -> lunch picker hides meat + leftovers (last night meat), shows dairy lunch, hint
await scenario({ m0D: C({ id: "c1" }), m1D: C({ id: "y3" }), m1L: C({ id: "y1" }) });
let pk = await openPicker(page, "m1L");
check("A picker opens", pk.open);
// Batch 4 item 3 (Tab-approved, Oct 22): blocked meals are no longer hidden — they
// appear in the marked "not usually allowed" override section. The generator still
// never picks them (covered by r13 kashrus/mdgap engine tests).
// Row text carries the tag-pill prefix ("Meat"), so match "Leftovers:" anywhere in the row,
// not just at the start — the tag pill has always prefixed picker rows.
check("A meat Leftovers row offered only in override section", pk.blocked.some(r => r.includes("Leftovers:")) && !pk.normal.some(r => r.includes("Leftovers:")), pk.blocked.join(" | "));
check("A meat library lunches shown only in override section", !pk.normal.some(r => /Chicken|shawarma/i.test(r) && !r.startsWith("Leftovers")) && pk.blocked.some(r => /Chicken|shawarma/i.test(r)), pk.blocked.slice(0, 3).join(" | "));
check("A dairy lunch shown", pk.rows.some(r => /Parfait/.test(r)), pk.rows.join(" | "));
check("A hint mentions dairy dinner", /dairy dinner/.test(pk.hint), pk.hint);
await page.keyboard.press("Escape"); await sleep(300);
check("A Esc closes picker", await page.evaluate(() => !document.getElementById("mealPickerDlg").open));

// B: meat dinner Monday -> dairy lunch VISIBLE (planner allows dairy lunch + meat dinner)
await scenario({ m1D: C({ id: "c2" }), m1L: C({ id: "c3" }) });
pk = await openPicker(page, "m1L");
check("B dairy lunch shown before meat dinner", pk.rows.some(r => /Parfait/.test(r)), pk.rows.join(" | "));
check("B no dairy-dinner hint (dairy lunch not blocked)", !/dairy dinner/.test(pk.hint), pk.hint || "(no hint)");
await page.evaluate(() => document.getElementById("mpClose").click()); await sleep(300);

// C: dairy lunch -> dinner picker SHOWS meat dinners
await scenario({ m2L: C({ id: "y1" }), m2D: C({ id: "y3" }) });
pk = await openPicker(page, "m2D");
check("C meat dinners shown after dairy lunch", pk.rows.some(r => /Shawarma/.test(r)), pk.rows.slice(0, 5).join(" | "));
await page.evaluate(() => document.getElementById("mpClose").click()); await sleep(300);

// D: meat lunch -> dinner picker hides dairy dinners, hint explains
await scenario({ m2L: C({ id: "c3" }), m2D: C({ id: "c1" }) });
pk = await openPicker(page, "m2D");
check("D dairy dinners shown only in override section", !pk.normal.some(r => /Parfait/.test(r)) && pk.blocked.some(r => /Parfait/.test(r)), pk.blocked.join(" | "));
check("D hint mentions meat lunch", /lunch today is meat/.test(pk.hint), pk.hint);
check("D meat dinners still shown", pk.rows.some(r => /Shawarma/.test(r)));
await page.evaluate(() => document.getElementById("mpClose").click()); await sleep(300);

// E: fish and meat on the same DAY are allowed (Beta batch 1 item 4,
// user-approved rewrite) — only meat/dairy is blocked, never fish/meat.
await scenario({ m3D: C({ id: "c1" }), m3L: C({ id: "e4" }) });
pk = await openPicker(page, "m3L");
check("E fish lunch shown on meat-dinner day", pk.rows.some(r => /Salmon over greens/.test(r)), pk.rows.join(" | "));
check("E no fish+meat hint", !/Fish and meat/.test(pk.hint), pk.hint);
await page.evaluate(() => document.getElementById("mpClose").click()); await sleep(300);
await scenario({ m3D: C({ id: "sa1" }), m3L: C({ id: "e4" }) });
pk = await openPicker(page, "m3L");
check("E2 meat lunch shown on fish-dinner day", pk.rows.some(r => /Chicken hummus wrap/.test(r)), pk.rows.join(" | "));
await page.evaluate(() => document.getElementById("mpClose").click()); await sleep(300);

// Add 2: picker row flags
await scenario({ m4D: C({ id: "c2" }) });
pk = await openPicker(page, "m4D");
check("Add2 row shows 'leftovers OK'", pk.rows.some(r => /leftovers OK/.test(r)), pk.rows.filter(r => /leftovers OK/.test(r)).join(" | "));
check("Add2 row shows 'cook fresh'", pk.rows.some(r => /cook fresh/.test(r)), pk.rows.filter(r => /cook fresh/.test(r)).join(" | "));

// Bug 5: picker reopens scrolled to top
await page.evaluate(() => { document.getElementById("mpList").scrollTop = 300; });
const scrolled = await page.evaluate(() => document.getElementById("mpList").scrollTop);
await page.evaluate(() => document.getElementById("mpClose").click()); await sleep(300);
pk = await openPicker(page, "m4D");
const topAfter = await page.evaluate(() => document.getElementById("mpList").scrollTop);
check("Bug5 picker scrolled while open (setup)", scrolled > 0, "scrollTop was " + scrolled);
check("Bug5 picker reopens at top", topAfter === 0, "scrollTop=" + topAfter);

// Bug 3: Back with picker open closes only the picker
const tabBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("steady.ui")).tab);
await page.goBack(); await sleep(400);
const afterBack = await page.evaluate(() => ({ open: document.getElementById("mealPickerDlg").open, tab: JSON.parse(localStorage.getItem("steady.ui")).tab, step: document.querySelector(".step-btn.on") ? document.querySelector(".step-btn.on").textContent : "" }));
check("Bug3 Back closes picker", afterBack.open === false);
check("Bug3 Back with picker open does not navigate", afterBack.tab === tabBefore && /Week/.test(afterBack.step), JSON.stringify(afterBack));
await page.evaluate(() => document.getElementById("mpClose").click()); await sleep(200);

// ---------- Bug 6: dinner pick knock-on ----------
await scenario({ m1D: C({ id: "c1" }), m2L: C({ lo: 1 }) });
pk = await openPicker(page, "m1D");
check("Bug6 picker for dinner opens", pk.open && pk.rows.some(r => /salmon/i.test(r)), pk.rows.slice(0, 3).join(" | "));
await page.evaluate(() => {
  const row = [...document.querySelectorAll("#mpList .mp-opt")].find(e => /Dry Rubbed Roasted Salmon/.test(e.textContent));
  row.click();
});
await sleep(500);
let cells = await planWeekCells(page, nextSun);
let toastTxt = await page.evaluate(() => (document.querySelector(".undo-toast") || {}).textContent || "");
let toastInfo = await page.evaluate(() => { const t = document.querySelector(".undo-toast"); return { span: t && t.querySelector("span") ? t.querySelector("span").textContent : "", btn: t ? !!t.querySelector("button") : false, day: PLAN_ENGINE.DAYN[1] }; });
check("Bug6 non-lo dinner replaces tomorrow's lo lunch", !!cells.m2L && !cells.m2L.lo && !!cells.m2L.id, JSON.stringify(cells.m2L));
check("Bug6 lunch replaced + Undo offered", toastInfo.span.indexOf("Changed " + toastInfo.day + " dinner.") === 0 && toastInfo.btn, toastInfo.span);
// lo-friendly dinner keeps the leftovers lunch, no message
await scenario({ m1D: C({ id: "sa3" }), m2L: C({ lo: 1 }) });
await openPicker(page, "m1D");
await page.evaluate(() => {
  const row = [...document.querySelectorAll("#mpList .mp-opt")].find(e => /Grandma's Meatballs/.test(e.textContent));
  row.click();
});
await sleep(500);
cells = await planWeekCells(page, nextSun);
toastTxt = await page.evaluate(() => (document.querySelector(".undo-toast") || {}).textContent || "");
check("Bug6 lo-friendly dinner keeps lo lunch", !!cells.m2L && cells.m2L.lo === 1, JSON.stringify(cells.m2L));
check("Bug6 no message when lunch kept", !/leftovers lunch was updated/.test(toastTxt), toastTxt || "(none)");

// ---------- Bug 3: Settings dialog + Back; Bug 4: tab re-tap ----------
await page.evaluate(() => { localStorage.setItem("steady.ui", JSON.stringify({ tab: "today" })); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(500);
const len0 = await page.evaluate(() => history.length);
await page.click('#bottomNav button[data-tab="today"]'); await sleep(300);
const len1 = await page.evaluate(() => history.length);
check("Bug4 re-tapping current tab pushes nothing", len1 === len0, len0 + " -> " + len1);
await page.click("#gearBtn"); await sleep(400);
const setOpen = await page.evaluate(() => document.getElementById("settingsDlg").open);
const dlgState = await page.evaluate(() => (history.state && history.state.dlg) || null);
check("Bug3 Settings opens (dialog history entry on top)", setOpen && dlgState === "settings", "state.dlg=" + dlgState);
await page.goBack(); await sleep(400);
const setAfter = await page.evaluate(() => ({ open: document.getElementById("settingsDlg").open, tab: JSON.parse(localStorage.getItem("steady.ui")).tab }));
check("Bug3 Back closes Settings only", setAfter.open === false && setAfter.tab === "today", JSON.stringify(setAfter));

// ---------- Bug 10: toast width; Bug 9: share fallback ----------
await scenario({ m0D: C({ id: "c1" }), m1D: C({ id: "sa1" }) });
await page.evaluate(() => { const ui = JSON.parse(localStorage.getItem("steady.ui")); ui.planStep = "shop"; localStorage.setItem("steady.ui", JSON.stringify(ui)); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(500);
await page.evaluate(() => { document.querySelector('button[data-act="uncheck-all"]'); });
await page.evaluate(() => {
  window.__clip = null;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } });
  Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.reject(new Error("share blew up")) });
});
await page.click('button[data-act="share-shop"]'); await sleep(400);
const clip1 = await page.evaluate(() => window.__clip);
check("Bug9 share non-Abort rejection falls back to clipboard", typeof clip1 === "string" && /Shopping list/.test(clip1), clip1 ? clip1.slice(0, 40) : "null");
await page.evaluate(() => {
  window.__clip = null;
  Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })) });
});
await page.click('button[data-act="share-shop"]'); await sleep(400);
const clip2 = await page.evaluate(() => window.__clip);
check("Bug9 AbortError does NOT fall back", clip2 === null);
// toast width (uncheck all -> toast)
await page.click('button[data-act="uncheck-all"]'); await sleep(300);
const tw = await page.evaluate(() => { const t = document.querySelector(".undo-toast"); return t ? t.getBoundingClientRect().width : 0; });
check("Bug10 toast width >= 340 @390", tw >= 340, "width=" + tw);
// Bug 8a: toast dismissed on tab change
await page.click('#bottomNav button[data-tab="meals"]'); await sleep(300);
const toastGone = await page.evaluate(() => !document.querySelector(".undo-toast"));
check("Bug8 toast dismissed on tab change", toastGone);

await browser.close();
process.exit(done("R2 suite A (390px)") ? 1 : 0);
