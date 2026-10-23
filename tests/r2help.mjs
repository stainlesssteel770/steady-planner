import puppeteer from "puppeteer-core";
export const EXE = process.env.CHROME_PATH || "/home/hatch/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome";
export const URL = "http://localhost:8899/steady-planner/";
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function makeReporter() {
  const results = [];
  const check = (name, ok, extra = "") => { results.push([name, ok]); console.log((ok ? "PASS" : "FAIL") + "  " + name + (extra ? "  — " + extra : "")); };
  const done = label => { const f = results.filter(r => !r[1]).length; console.log("\n==== " + label + ": " + (results.length - f) + "/" + results.length + " passed ===="); return f; };
  return { check, done };
}
export async function launch(width) {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
  page.on("pageerror", e => console.log("PAGE ERROR:", e.message));
  return { browser, page };
}
function fmt(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
export function weekKeys() {
  const now = new Date(Date.now() - 4 * 3600 * 1000);
  const sun = new Date(now); sun.setDate(now.getDate() - now.getDay());
  const next = new Date(sun); next.setDate(sun.getDate() + 7);
  return { today: fmt(now), thisSun: fmt(sun), nextSun: fmt(next) };
}
export const C = v => ({ v, ts: 1000 });
export async function seed(page, plans, ui) {
  await page.evaluate((arg) => {
    localStorage.setItem("steady.state", JSON.stringify({ settings: { f: {} }, favorites: { items: {} }, days: {}, grocery: { f: {} }, plans: arg.plans }));
    localStorage.setItem("steady.ui", JSON.stringify(arg.ui));
  }, { plans, ui });
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(500);
}
export async function openPicker(page, key) {
  await page.evaluate((k) => {
    const card = document.querySelector('.meal-card[data-k="' + k + '"]');
    if (!card) throw new Error("no meal card " + k);
    card.querySelector(".meal-name, .meal-how, .slot-label").click();
  }, key);
  await sleep(400);
  return page.evaluate(() => {
    const dlg = document.getElementById("mealPickerDlg");
    const els = [...document.querySelectorAll("#mpList .mp-opt")];
    const txt = e => e.textContent.replace(/\s+/g, " ").trim();
    const rows = els.map(txt);
    const normal = els.filter(e => !e.classList.contains("mp-opt-blocked")).map(txt);
    const blocked = els.filter(e => e.classList.contains("mp-opt-blocked")).map(txt);
    const hint = (document.querySelector("#mpList .mp-hint") || {}).textContent || "";
    return { open: !!dlg.open, rows, normal, blocked, hint };
  });
}
export async function planWeekCells(page, week) {
  return page.evaluate((w) => {
    const st = JSON.parse(localStorage.getItem("steady.state"));
    const doc = (st.plans || {})[w] || { f: {} };
    const out = {};
    for (const k in doc.f || {}) out[k] = doc.f[k].v;
    return out;
  }, week);
}
