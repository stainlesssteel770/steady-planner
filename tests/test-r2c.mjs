import { launch, seed, weekKeys, C, sleep, makeReporter } from "./r2help.mjs";
const { check, done } = makeReporter();
const { nextSun } = weekKeys();
const PRO = C(["chicken", "salmon", "yogurt", "eggs"]);

const { browser, page } = await launch(360);
await page.goto("http://localhost:8899/steady-planner/", { waitUntil: "networkidle0" });
await sleep(500);
const sw = () => page.evaluate(() => document.scrollingElement.scrollWidth);
check("360 Today no horizontal overflow", (await sw()) <= 360, "scrollWidth=" + (await sw()));

// Cooking-for rows at 360 on Proteins step
await seed(page, { [nextSun]: { f: { pro: PRO, m0D: C({ id: "c1" }) } } }, { tab: "plan", planStep: "pro", planWs: nextSun });
const srv = await page.evaluate(() => [...document.querySelectorAll(".srv-row")].map(r => {
  const v = r.querySelector(".srv-val");
  const cs = getComputedStyle(v);
  return { h: v.offsetHeight, lh: parseFloat(cs.lineHeight) || 20, text: v.textContent };
}));
check("360 three srv rows present", srv.length === 3, "rows=" + srv.length);
check("Bug12 srv values are one line @360", srv.every(r => r.h <= Math.max(30, r.lh * 1.4)), JSON.stringify(srv));
check("360 Plan/Proteins no horizontal overflow", (await sw()) <= 360, "scrollWidth=" + (await sw()));

// Shop at 360
await page.evaluate(() => { const ui = JSON.parse(localStorage.getItem("steady.ui")); ui.planStep = "shop"; localStorage.setItem("steady.ui", JSON.stringify(ui)); });
await page.reload({ waitUntil: "networkidle0" }); await sleep(500);
check("360 Shop no horizontal overflow", (await sw()) <= 360, "scrollWidth=" + (await sw()));

// Toast width at 360 should still be 100vw-24=336 and not 195
await page.click('button[data-act="uncheck-all"]'); await sleep(300);
const tw = await page.evaluate(() => { const t = document.querySelector(".undo-toast"); return t ? t.getBoundingClientRect().width : 0; });
check("360 toast width is viewport-based (>=330)", tw >= 330, "width=" + tw);

await browser.close();
process.exit(done("R2 suite C (360px)") ? 1 : 0);
