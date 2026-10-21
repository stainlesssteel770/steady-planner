/* Steady app.js — UI + local state. Local-only: data lives in this browser's
   localStorage and is never uploaded. No external calls beyond own origin. */
"use strict";
var STEADY = window.STEADY, PD = window.PLAN_DATA, ENGINE = window.PLAN_ENGINE;

/* Local-only app: no key, no account, no server. All data lives in this
   browser's localStorage and is never uploaded. */

/* ---------------- storage ---------------- */
function lsGet(k, dflt) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
var state = lsGet("steady.state", null) || { settings: { f: {} }, favorites: { items: {} }, days: {}, grocery: { f: {} }, plans: {} };
if (!state.settings) state.settings = { f: {} };
if (!state.days) state.days = {};
if (!state.plans) state.plans = {};
if (!state.grocery) state.grocery = { f: {} };
if (!state.favorites) state.favorites = { items: {} };
var ui = lsGet("steady.ui", {}) || {};
if (!ui.tab) ui.tab = "today";
if (ui.tab === "grocery") { ui.tab = "plan"; ui.planStep = "shop"; }
if (!ui.rounds) ui.rounds = {};
if (!ui.mealOpen) ui.mealOpen = "breakfast";
function saveLocal() { lsSet("steady.state", state); }
function saveUi() { lsSet("steady.ui", ui); }

/* ---------------- dates ---------------- */
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function fmtDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function todayStrFn() { var d = new Date(Date.now() - 4 * 3600 * 1000); return fmtDate(d); }
var todayStr = todayStrFn();
function parseLocal(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
function dowOf(s) { return parseLocal(s).getDay(); }
function addDays(s, n) { var d = parseLocal(s); d.setDate(d.getDate() + n); return fmtDate(d); }
var MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(s) { var p = s.split("-"); return MON3[+p[1] - 1] + " " + (+p[2]); }
function longDate(s) { var dw = dowOf(s); return (dw === 6 ? "Shabbos" : ENGINE.DAYN[dw]) + ", " + shortDate(s); }
function weekSunday(s) { return addDays(s, -dowOf(s)); }

/* ---------------- calendar / rest days ---------------- */
var YOMTOV = {};
function prettifyName(name) {
  var n = String(name);
  n = n.replace(/Sukkot/g, "Sukkos").replace(/Shmini Atzeret/g, "Shemini Atzeres")
       .replace(/Simchat Torah/g, "Simchas Torah").replace(/Shavuot/g, "Shavuos")
       .replace(/Rosh Hashana \d+/g, "Rosh Hashana");
  return n;
}
function loadCalendar() {
  return fetch("calendar.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (j && j.events) j.events.forEach(function (e) { if (e.k === "yomtov") YOMTOV[e.d] = e.t; });
  }).catch(function () {});
}
function dayDoc(date) { return state.days[date] || { f: {} }; }
function getDayF(date, field) { var d = state.days[date]; if (!d || !d.f || !d.f[field]) return undefined; return d.f[field].v; }
function restName(date) {
  var ov = getDayF(date, "restOverride");
  if (ov === "normal") return null;
  if (YOMTOV[date]) return prettifyName(YOMTOV[date]);
  if (dowOf(date) === 6) return "Shabbos";
  if (ov === "rest") return "Rest day";
  return null;
}
function isRest(date) { return !!restName(date); }
function isPreRest(date) { return !isRest(date) && isRest(addDays(date, 1)); }
function planCtx(week) {
  var rest = {}, pre = {};
  for (var d = 0; d <= 6; d++) { var n = restName(addDays(week, d)); if (n) rest[d] = n; }
  for (var d2 = 0; d2 <= 5; d2++) { if (!rest[d2] && rest[d2 + 1]) pre[d2] = true; }
  return { week: week, today: todayStr, rest: rest, pre: pre };
}

/* ---------------- settings ---------------- */
var SETTING_DEFAULTS = { stepGoal: 7500, workoutTarget: 3, workoutLevel: 0, workoutRounds: 3, prepDay: 0 };
function getSetting(name) {
  var c = state.settings && state.settings.f ? state.settings.f[name] : null;
  return c && c.v !== null && c.v !== undefined ? c.v : SETTING_DEFAULTS[name];
}

/* ---------------- local writes (op format kept for the state mirror) ---------------- */
var lastTs = Date.now();
function tsNow() { var t = Date.now(); if (t <= lastTs) t = lastTs + 1; lastTs = t; return t; }
var settleTimer = null;
function setStatus(text) {
  var el = document.getElementById("syncStatus");
  if (el) el.textContent = text;
}
function statusAfterEdit() {
  setStatus("Saved on this phone");
  clearTimeout(settleTimer);
  settleTimer = setTimeout(function () { setStatus(""); }, 2000);
}
function applyCells(doc, f, cleared) {
  if (!doc.f) doc.f = {};
  Object.keys(f || {}).forEach(function (k) {
    var inc = f[k]; if (!inc) return;
    if (cleared && inc.ts <= cleared) return;
    var cur = doc.f[k];
    if (!cur || inc.ts >= cur.ts) doc.f[k] = { v: inc.v, ts: inc.ts };
  });
}
function applyOp(st, op) {
  if (!op) return;
  if (op.type === "day") {
    var d = st.days[op.date] || (st.days[op.date] = { f: {} });
    applyCells(d, op.f, 0);
    if (op.foods) { d.foods = d.foods || {}; Object.keys(op.foods).forEach(function (id) { d.foods[id] = op.foods[id]; }); }
  } else if (op.type === "settings") {
    if (!st.settings) st.settings = { f: {} };
    applyCells(st.settings, op.f, 0);
  } else if (op.type === "plan") {
    var p = st.plans[op.week] || (st.plans[op.week] = { f: {} });
    if (op.clear) {
      if (!p.cleared || op.clear > p.cleared) {
        p.cleared = op.clear;
        Object.keys(p.f || {}).forEach(function (k) { if (p.f[k].ts <= op.clear) delete p.f[k]; });
      }
    }
    applyCells(p, op.f, p.cleared || 0);
  } else if (op.type === "grocery") {
    if (!st.grocery) st.grocery = { f: {} };
    applyCells(st.grocery, op.f, 0);
  } else if (op.type === "fav") {
    if (!st.favorites) st.favorites = { items: {} };
    st.favorites.items = st.favorites.items || {};
    Object.keys(op.items || {}).forEach(function (id) { st.favorites.items[id] = op.items[id]; });
  }
}
function queueOp(op, opts) {
  applyOp(state, op);
  saveLocal();
  if (!opts || !opts.silent) { statusAfterEdit(); if (!opts || opts.render !== false) render(); }
}
function opDay(date, field, value) { var f = {}; f[field] = { v: value, ts: tsNow() }; queueOp({ type: "day", date: date, f: f }); }
function opDaySilent(date, field, value, opts) { var f = {}; f[field] = { v: value, ts: tsNow() }; queueOp({ type: "day", date: date, f: f }, opts); }
function opSettings(field, value) { var f = {}; f[field] = { v: value, ts: tsNow() }; queueOp({ type: "settings", f: f }); }
function planDoc(week) { return state.plans[week] || { f: {} }; }
function planCells(week) { return ENGINE.cellVals(planDoc(week)); }
function opPlan(week, cell, value, opts) { var f = {}; f[cell] = { v: value, ts: tsNow() }; queueOp({ type: "plan", week: week, f: f }, opts); }

/* ---------------- scoring (1.3) ---------------- */
function scoreDay(date) {
  if (isRest(date)) return null;
  var pre = isPreRest(date);
  var g = function (f) { return !!getDayF(date, f); };
  var items = {};
  items.protein = pre ? (g("proteinB") && g("proteinL")) : (g("proteinB") && g("proteinL") && g("proteinD"));
  items.veg = pre ? g("vegL") : (g("vegL") && g("vegD"));
  items.mealsPlan = pre ? null : g("mealsPlan");
  items.treat = pre ? null : g("treat");
  items.kitchenClosed = pre ? null : g("kitchenClosed");
  items.drinks = g("drinks");
  items.noAlcohol = g("noAlcohol");
  var steps = getDayF(date, "steps");
  items.steps = typeof steps === "number" && steps >= getSetting("stepGoal");
  items.workout = g("workout") || g("workoutOff");
  items.bed = pre ? null : g("bed");
  var score = 0, of = 0;
  Object.keys(items).forEach(function (k) { if (items[k] !== null) { of++; if (items[k]) score++; } });
  var logged = ["proteinB", "proteinL", "proteinD", "vegL", "vegD", "mealsPlan", "treat", "kitchenClosed", "drinks", "noAlcohol", "bed", "workout", "workoutOff"].some(g)
    || (typeof steps === "number" && steps > 0);
  return { score: score, of: of, items: items, logged: logged, ratio: of ? score / of : 0, preRest: pre };
}
function workoutsInWeek(anyDate) {
  var sun = weekSunday(anyDate), n = 0;
  for (var i = 0; i < 7; i++) if (getDayF(addDays(sun, i), "workout")) n++;
  return n;
}
function streakCount() {
  var cur = todayStr, guard = 0;
  while (isRest(cur) && guard++ < 14) cur = addDays(cur, -1);
  var s0 = scoreDay(cur);
  if (!s0 || s0.ratio < 0.7) { cur = addDays(cur, -1); guard = 0; while (isRest(cur) && guard++ < 14) cur = addDays(cur, -1); }
  var n = 0; guard = 0;
  while (guard++ < 400) {
    if (isRest(cur)) { cur = addDays(cur, -1); continue; }
    var s = scoreDay(cur);
    if (s && s.ratio >= 0.7) { n++; cur = addDays(cur, -1); } else break;
  }
  return n;
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function buzz(x) { try { if (navigator.vibrate) navigator.vibrate(x); } catch (e) {} }
function tagPill(t) {
  var names = { M: "Meat", D: "Dairy", P: "Pareve", F: "Fish · pareve", "?": "Check label" };
  var cls = t === "?" ? "Q" : t;
  return '<span class="tag ' + cls + '">' + (names[t] || t) + "</span>";
}

/* ---------------- rendering shell ---------------- */
var selDate = todayStr;
var mainEl = function () { return document.getElementById("main"); };
function render(force) {
  var ae = document.activeElement;
  if (!force && ae && ae.tagName === "INPUT" && ae.getAttribute("data-keep") !== null && mainEl().contains(ae)) { syncNav(); return; }
  syncNav();
  var html = "";
  if (ui.tab === "today") html = renderToday();
  else if (ui.tab === "workout") html = renderWorkout();
  else if (ui.tab === "plan") html = renderPlan();
  else html = renderMeals();
  mainEl().innerHTML = html;
  if (ui.tab === "plan") scheduleSnap();
}
function syncNav() {
  var btns = document.querySelectorAll("#bottomNav button");
  btns.forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === ui.tab); });
}
function gotoTab(tab, planStep) {
  ui.tab = tab;
  if (planStep) ui.planStep = planStep;
  saveUi();
  render(true);
  window.scrollTo(0, 0);
}

/* ---------------- Today tab (1.3) ---------------- */
function sparklineSVG(entries, key, color) {
  if (entries.length < 2) return "";
  var pts = entries.slice(-16);
  var first = pts[0].date, lastD = pts[pts.length - 1].date;
  var spanDays = Math.max(1, Math.round((parseLocal(lastD) - parseLocal(first)) / 86400000));
  var vals = pts.map(function (e) { return e[key]; });
  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), range = (max - min) || 1;
  var coords = pts.map(function (e) {
    var x = 6 + (Math.round((parseLocal(e.date) - parseLocal(first)) / 86400000) / spanDays) * 248;
    var y = 6 + (1 - (e[key] - min) / range) * 36;
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  return '<svg width="260" height="48" viewBox="0 0 260 48" role="img"><polyline points="' + coords.join(" ") + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function checkinEntries() {
  var out = [];
  Object.keys(state.days).forEach(function (d) {
    var w = getDayF(d, "weight"), wa = getDayF(d, "waist");
    if (typeof w === "number" || typeof wa === "number") out.push({ date: d, weight: w, waist: wa });
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return out;
}
function renderToday() {
  var date = selDate, rest = restName(date), pre = !rest && isPreRest(date);
  var sc = rest ? null : scoreDay(date);
  var h = "";
  // Hero
  h += '<section class="card hero"><div class="daynav">' +
    '<button class="nav-arrow" data-act="day-prev" aria-label="Previous day">‹</button>' +
    '<div><div class="day-title">' + (date === todayStr ? "Today" : date === addDays(todayStr, -1) ? "Yesterday" : ENGINE.DAYN[dowOf(date)]) + '</div>' +
    '<div class="day-sub">' + esc(longDate(date)) + '</div></div>' +
    '<button class="nav-arrow" data-act="day-next" aria-label="Next day"' + (date >= todayStr ? " disabled" : "") + '>›</button></div>';
  if (rest) h += '<div class="rest-score">✦ no tracking today</div>';
  else {
    h += '<div class="score-big">' + sc.score + ' <span class="score-of">/ ' + sc.of + '</span></div>' +
      '<div class="score-label">habits' + (pre ? ' · <span>daytime only</span>' : "") + '</div>';
  }
  // Week dots
  var sun = weekSunday(date), letters = ["S", "M", "T", "W", "T", "F", "Sh"];
  h += '<div class="weekdots">';
  for (var i = 0; i < 7; i++) {
    var d = addDays(sun, i), rn = restName(d), future = d > todayStr;
    var cls = "dot", content = "";
    if (rn) { cls += " restd"; content = "✦"; }
    else if (!future) { var ds = scoreDay(d); if (ds && ds.logged) { content = String(ds.score); cls += ds.ratio >= 0.7 ? " good" : ds.ratio >= 0.4 ? " mid" : " low"; } }
    if (d === date) cls += " sel";
    if (future) cls += " future";
    var label = longDate(d) + (rn ? " · " + rn : future ? "" : " · " + (scoreDay(d) ? scoreDay(d).score + " of " + scoreDay(d).of : ""));
    h += '<div class="dotwrap"><button class="' + cls + '" data-act="dot" data-date="' + d + '"' + (future ? " disabled" : "") + ' aria-label="' + esc(label) + '">' + content + '</button>' +
      '<span class="dot-l"' + (d === todayStr ? ' style="color:var(--accent);font-weight:800"' : "") + '>' + letters[i] + '</span></div>';
  }
  h += '</div>';
  h += '<div class="stats-line"><b>' + workoutsInWeek(date) + '/' + getSetting("workoutTarget") + '</b> workouts this week · <b>' + streakCount() + '</b> day streak (7+)</div>';
  h += '</section>';

  if (rest) {
    var isYt = !!YOMTOV[date];
    h += '<section class="card"><h2>' + (isYt ? "Gut Yom Tov" : "Good Shabbos") + '</h2>' +
      '<p><b>' + esc(rest) + '</b>: nothing to track. Enjoy it.</p>' +
      '<p class="muted">Seconds are fine here: the seudos, kiddush, Friday-night snackies. One plate at kiddush, and seltzer with lime for the l\'chaims.</p>' +
      '<button class="btn" data-act="shabbos-tips">Shabbos tips</button></section>';
    return h;
  }
  // Never miss twice
  if (date === todayStr) {
    var pd = addDays(date, -1), skips = 0;
    while (isRest(pd) && skips < 10) { pd = addDays(pd, -1); skips++; }
    var entriesAll = checkinEntries();
    var anyLogged = Object.keys(state.days).some(function (dd) { var s2 = scoreDay(dd); return s2 && s2.logged; });
    var firstLogged = Object.keys(state.days).filter(function (dd) { var s2 = scoreDay(dd); return s2 && s2.logged; }).sort()[0];
    var ps = scoreDay(pd);
    if (anyLogged && firstLogged && pd >= firstLogged && ps && ps.ratio < 0.5) {
      var when = pd === addDays(todayStr, -1) && skips === 0 ? "Yesterday" : ENGINE.DAYN[dowOf(pd)];
      h += '<div class="banner nudge"><b>Never miss twice.</b> ' + when + ' was a light one (' + ps.score + '/' + ps.of + '). That\'s fine. Today is the one that counts, even a few ticks.</div>';
    }
  }
  if (date < todayStr) {
    h += '<div class="banner">Editing ' + esc(longDate(date)) + '. <button class="link-btn" data-act="goto-today">Back to today</button></div>';
  }
  if (pre) {
    h += '<div class="banner prerest"><b>' + (dowOf(addDays(date, 1)) === 6 ? "Shabbos" : "Yom Tov") + ' starts tonight.</b> Only the daytime habits count today, so there\'s nothing to log after candle lighting.</div>';
  }
  if (sc.score === sc.of && sc.of > 0) h += '<div class="banner full">All ' + sc.of + '. That\'s a full day.</div>';

  // Habits
  h += '<section class="card">';
  STEADY.habits.forEach(function (hab, idx) {
    var greyed = pre && hab.evening;
    h += '<div class="habit' + (hab.good ? " good" : "") + (greyed ? " greyed" : "") + '">' +
      '<div class="habit-num">' + (idx + 1) + '</div><div class="habit-body">' +
      '<div class="habit-title">' + esc(hab.title) + '</div><div class="habit-sub">' + esc(hab.sub) + '</div>';
    if (greyed) {
      h += '<div class="habit-sub">Not counted tonight</div>';
    } else if (hab.ticks) {
      h += '<div class="ticks">';
      hab.ticks.forEach(function (tk) {
        var f = tk[0], dis = pre && (f === "proteinD" || f === "vegD");
        h += '<button class="tick' + (getDayF(date, f) ? " on" : "") + '" data-act="tick" data-f="' + f + '"' + (dis ? " disabled" : "") + '>' + esc(tk[1]) + '</button>';
      });
      h += '</div>';
    } else if (hab.kind === "steps") {
      var steps = getDayF(date, "steps"), goal = getSetting("stepGoal");
      var val = typeof steps === "number" ? steps : "";
      var pct = typeof steps === "number" ? Math.min(100, Math.round(steps / goal * 100)) : 0;
      h += '<input class="steps-input" id="stepsInput" data-keep type="number" inputmode="numeric" min="0" max="100000" placeholder="Steps" value="' + val + '" aria-label="Steps">' +
        '<div class="progress"><div style="width:' + pct + '%"></div></div>' +
        '<div class="habit-sub">' + (typeof steps === "number" ? steps.toLocaleString("en-US") + " of " : "Goal ") + goal.toLocaleString("en-US") + '</div>';
    } else if (hab.kind === "workout") {
      var wo = !!getDayF(date, "workout"), woff = !!getDayF(date, "workoutOff");
      h += '<div class="habit-sub">' + workoutsInWeek(date) + '/' + getSetting("workoutTarget") + ' this week · 20 min at home</div><div class="ticks">' +
        '<button class="tick' + (wo ? " on" : "") + '" data-act="goto-workout">' + (wo ? "Done ✓" : "Start routine") + '</button>' +
        '<button class="tick' + (woff ? " on" : "") + '" data-act="tick" data-f="workoutOff"' + (wo ? " disabled" : "") + '>Rest day</button></div>';
    } else if (hab.field) {
      h += '<div class="ticks"><button class="tick' + (getDayF(date, hab.field) ? " on" : "") + '" data-act="tick" data-f="' + hab.field + '">' + (getDayF(date, hab.field) ? "✓ Done" : "Tap when done") + '</button></div>';
    }
    h += '</div>';
    var done = sc.items[hab.id];
    h += '<div class="done-dot">' + (done ? "✓" : "") + '</div></div>';
  });
  h += '</section>';

  // On the plan
  var wk = weekSunday(date), cells = planCells(wk);
  if (Object.keys(cells).some(function (k) { return /^m\d[LD]$/.test(k) && cells[k]; })) {
    var ctx = planCtx(wk), lines = "";
    ["L", "D"].forEach(function (sl) {
      var r = ENGINE.resolve(ctx, cells, "m" + dowOf(date) + sl);
      if (r && r.meal) lines += '<p><b>' + (sl === "L" ? "Lunch" : "Dinner") + ':</b> ' + (r.lo ? "Leftovers: " : "") + esc(r.meal.n) + '</p>';
    });
    if (lines) h += '<section class="card"><h3>On the plan</h3>' + lines + '<button class="link-btn" data-act="goto-plan-week">Week →</button></section>';
  }
  // Prep day card
  if (date === todayStr && dowOf(date) === getSetting("prepDay") && dowOf(date) <= 5) {
    var twk = weekSunday(todayStr), tcells = planCells(twk), tctx = planCtx(twk);
    var prep = ENGINE.prep(tctx, tcells, getSetting("prepDay"));
    if (prep.steps.length) {
      var allTicks = [];
      prep.steps.forEach(function (s) { allTicks.push("t_" + s.tick); });
      prep.fridge.concat(prep.freezer, prep.midweekPortions).forEach(function (p) { allTicks.push("t_" + p.tick); });
      prep.midweek.tasks.forEach(function (t) { allTicks.push("t_" + t.tick); });
      prep.midweek.thaws.forEach(function (t) { allTicks.push("t_" + t.tick); });
      var doneN = allTicks.filter(function (t) { return tcells[t]; }).length;
      var titles = prep.steps.filter(function (s) { return s.id !== "setup" && s.id !== "pack"; }).slice(0, 4).map(function (s) { return s.title; });
      h += '<section class="card"><h3>Prep day · ' + doneN + ' of ' + allTicks.length + ' done</h3>' +
        '<p class="muted">About ' + prep.durText + ': ' + esc(titles.join(", ")) + '…</p>' +
        '<button class="btn" data-act="goto-plan-prep">Open the prep checklist</button></section>';
    }
  }
  // Seconds
  var secCount = 0, ssun = weekSunday(date);
  for (var si = 0; si < 7; si++) if (getDayF(addDays(ssun, si), "seconds")) secCount++;
  h += '<section class="card"><div class="row spread"><div><b>Had seconds</b><div class="habit-sub">' + secCount + ' this week. About 2 a week is fine, mostly Shabbos (that one needs no logging).</div></div>' +
    '<button class="tick' + (getDayF(date, "seconds") ? " on" : "") + '" data-act="tick" data-f="seconds">' + (getDayF(date, "seconds") ? "✓" : "Yes") + '</button></div></section>';

  // Weekly check-in
  var entries = checkinEntries();
  var thisWeekEntry = null;
  entries.forEach(function (e) { if (e.date >= weekSunday(todayStr) && e.date <= todayStr) thisWeekEntry = e; });
  var status = thisWeekEntry ? "Done this week ✓" : entries.length ? "Last: " + shortDate(entries[entries.length - 1].date) : "Not yet";
  h += '<details class="card" id="weighDetails"' + (ui.weighOpen ? " open" : "") + '><summary>Weekly check-in · optional <span class="muted small">' + status + '</span></summary>' +
    '<p class="muted">Once a week if you feel like it: same morning, after the bathroom, before eating. It\'s just for the trend.</p>';
  if (!isRest(todayStr)) {
    h += '<div class="row wrap"><label>Weight (lb)<br><input class="checkin-num" id="ciWeight" data-keep type="number" step="0.1" min="50" max="700" inputmode="decimal" value="' + (thisWeekEntry && typeof thisWeekEntry.weight === "number" ? thisWeekEntry.weight : "") + '"></label>' +
      '<label>Waist (in)<br><input class="checkin-num" id="ciWaist" data-keep type="number" step="0.01" min="10" max="90" inputmode="decimal" value="' + (thisWeekEntry && typeof thisWeekEntry.waist === "number" ? thisWeekEntry.waist : "") + '"></label></div>' +
      '<p><button class="btn primary" data-act="checkin-save">Save check-in</button></p>';
  }
  var wEntries = entries.filter(function (e) { return typeof e.weight === "number"; });
  var waEntries = entries.filter(function (e) { return typeof e.waist === "number"; });
  if (wEntries.length >= 2) {
    var wf = wEntries[Math.max(0, wEntries.length - 16)], wl = wEntries[wEntries.length - 1];
    var ch = wl.weight - wf.weight;
    h += sparklineSVG(wEntries, "weight", "#2f6f5e") + '<p class="muted small">Weight: ' + wl.weight + ' lb (' + (ch > 0 ? "+" : ch < 0 ? "−" : "") + Math.abs(ch).toFixed(1) + ' since ' + shortDate(wf.date) + ')</p>';
  } else if (wEntries.length === 1) {
    h += '<p class="muted small">One weigh-in so far (' + wEntries[0].weight + ' lb, ' + shortDate(wEntries[0].date) + '). The trend line shows up after the second.</p>';
  }
  if (waEntries.length >= 2) {
    var af = waEntries[Math.max(0, waEntries.length - 16)], al = waEntries[waEntries.length - 1];
    var ch2 = al.waist - af.waist;
    h += sparklineSVG(waEntries, "waist", "#5b5f97") + '<p class="muted small">Waist: ' + al.waist + ' in (' + (ch2 > 0 ? "+" : ch2 < 0 ? "−" : "") + Math.abs(ch2).toFixed(2) + ' since ' + shortDate(af.date) + ')</p>';
  }
  h += '</details>';
  return h;
}

/* ---------------- Workout tab (1.4) ---------------- */
var restTimer = { end: 0, int: null, doneUntil: 0 };
function stopRestTimer() { if (restTimer.int) clearInterval(restTimer.int); restTimer.int = null; restTimer.end = 0; }
function startRestTimer() {
  stopRestTimer();
  restTimer.end = Date.now() + 60000;
  restTimer.int = setInterval(function () {
    var left = Math.max(0, Math.round((restTimer.end - Date.now()) / 1000));
    var el = document.getElementById("restTimerLabel");
    if (left <= 0) {
      stopRestTimer();
      buzz([250, 120, 250]);
      restTimer.doneUntil = Date.now() + 4000;
      render(true);
      setTimeout(function () { render(true); }, 4100);
      return;
    }
    if (el) el.textContent = "Rest " + Math.floor(left / 60) + ":" + pad2(left % 60) + " · tap to stop";
  }, 250);
  render(true);
}
function moveAmount(mv, L) {
  if (mv.secs) return (mv.secs + 5 * L) + " sec";
  if (mv.repsHi) return (mv.reps + L) + "–" + (mv.repsHi + L) + " reps";
  return (mv.reps + L) + " " + mv.unit;
}
function renderWorkout() {
  var date = selDate, L = getSetting("workoutLevel"), rounds = getSetting("workoutRounds");
  var rest = restName(date);
  var h = '<section class="card"><h2>20-minute home workout</h2>' +
    '<p class="muted">' + rounds + ' rounds of the 5 moves. Rest 1 minute between rounds. No gym needed.</p>' +
    '<p><b>' + workoutsInWeek(date) + '/' + getSetting("workoutTarget") + '</b> this week' + (date !== todayStr ? ' · for ' + esc(longDate(date)) : "") + '</p>';
  var marks = (ui.rounds[date] || []).slice();
  h += '<div class="chips">';
  for (var i = 0; i < rounds; i++) h += '<button class="chip' + (marks[i] ? " on" : "") + '" data-act="round" data-i="' + i + '">Round ' + (i + 1) + (marks[i] ? " ✓" : "") + '</button>';
  h += '</div>';
  var timerLabel = "Start 1:00 rest";
  if (restTimer.end) { var left = Math.max(0, Math.round((restTimer.end - Date.now()) / 1000)); timerLabel = "Rest " + Math.floor(left / 60) + ":" + pad2(left % 60) + " · tap to stop"; }
  else if (Date.now() < restTimer.doneUntil) timerLabel = "Rest done. Next round!";
  h += '<button class="btn timer-btn" data-act="rest-timer"><span id="restTimerLabel">' + timerLabel + '</span></button></section>';

  h += '<details class="card" id="warmDetails"' + (ui.warmOpen ? " open" : "") + '><summary>Warm-up · 2 min (optional)</summary><ul>';
  STEADY.warmup.forEach(function (w) { h += '<li><b>' + esc(w[0]) + '</b> — ' + esc(w[1]) + '</li>'; });
  h += '</ul></details>';

  STEADY.moves.forEach(function (mv, idx) {
    h += '<section class="card"><div class="move"><div class="habit-num">' + (idx + 1) + '</div><div class="grow">' +
      '<div class="row spread"><b>' + esc(mv.name) + '</b><span class="move-amt">' + moveAmount(mv, L) + '</span></div>' +
      (mv.note ? '<div class="habit-sub">' + esc(mv.note) + '</div>' : "") +
      '<ul>' + mv.cues.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join("") + '</ul>' +
      '</div></div></section>';
  });

  h += '<section class="card"><h3>Progression</h3><p class="muted">Add 1–2 reps a week (plank: +5 sec). When 3 rounds feel easy, go to 4.</p>' +
    '<div class="row spread"><div class="stepper"><button data-act="level" data-d="-1"' + (L <= 0 ? " disabled" : "") + ' aria-label="Level down">−</button><b>+' + L + '</b><button data-act="level" data-d="1" aria-label="Level up">+</button></div>' +
    '<div class="seg"><button data-act="rounds-set" data-n="3" class="' + (rounds === 3 ? "on" : "") + '">3 rounds</button><button data-act="rounds-set" data-n="4" class="' + (rounds === 4 ? "on" : "") + '">4 rounds</button></div></div></section>';

  if (rest) h += '<section class="card"><p><b>' + esc(rest) + '</b>: no logging today.</p></section>';
  else {
    var wo = !!getDayF(date, "workout");
    var lbl = wo ? "Workout logged ✓ · tap to undo" : "Done: log " + (date === todayStr ? "today's" : ENGINE.DAYN[dowOf(date)] + "'s") + " workout";
    h += '<button class="btn primary big" data-act="workout-done">' + lbl + '</button>';
  }
  return h;
}

/* ---------------- Meals tab (1.5) ---------------- */
function renderMeals() {
  var h = '<div class="chip-scroll">' +
    [["sec-day", "Day plan"], ["sec-week", "Week plan"], ["sec-kosher", "Meat · dairy"], ["sec-shabbos", "Shabbos"], ["sec-tips", "Tips"]].map(function (c) {
      return '<button class="chip" data-act="meals-jump" data-t="' + c[0] + '">' + c[1] + '</button>';
    }).join("") + '</div>';
  h += '<section class="card" id="sec-day"><h2>Your day</h2><p class="muted">Pick one option per slot. Same breakfast and lunch most days is the easy win.</p>';
  STEADY.day.forEach(function (slot) {
    var open = ui.mealOpen === slot.key;
    h += '<div class="accordion"><button class="acc-head" data-act="acc" data-k="' + slot.key + '"><span>' + esc(slot.time) + ' · ' + esc(slot.slot) + '</span><span>' + (open ? "▾" : "▸") + '</span></button>';
    if (open) {
      h += '<div class="acc-body">' + (slot.plate ? '<p class="muted small">' + esc(slot.plate) + '</p>' : "");
      (STEADY.meals[slot.key] || []).forEach(function (idea) {
        h += '<div class="idea">' + tagPill(idea[0]) + ' ' + esc(idea[1]) + (idea[2] ? '<span class="note">' + esc(idea[2]) + '</span>' : "") + '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
  });
  h += '<p class="legend">Tags: <b>M</b> Meat · <b>D</b> Dairy · <b>P</b> Pareve · <b>F</b> Fish (pareve, never eaten with meat) · <b>?</b> Check the label for its hechsher and status.</p></section>';

  h += '<section class="card" id="sec-kosher"><h2>Keeping it kosher</h2><ul>' +
    STEADY.kashrusNotes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join("") + '</ul></section>';

  h += '<section class="card" id="sec-week"><h2>Plan the week</h2>' +
    '<p class="muted">The Plan tab builds the week from two to four proteins: lunches and dinners, a shopping list built from the plan, and one prep session that does most of the cooking.</p>' +
    '<div class="row wrap"><button class="btn primary" data-act="goto-plan-pro">Plan my week</button><button class="btn" data-act="goto-plan-prep">Prep day</button></div></section>';

  h += '<section class="card" id="shabbosCard"><h2>Shabbos</h2>';
  STEADY.shabbos.forEach(function (t) { h += '<p><b>' + esc(t[0]) + '</b><br><span class="muted">' + esc(t[1]) + '</span></p>'; });
  h += '</section>';

  h += '<section class="card" id="sec-tips"><h2>What makes it stick</h2>';
  STEADY.tips.forEach(function (t) { h += '<p><b>' + esc(t[0]) + '</b><br><span class="muted">' + esc(t[1]) + '</span></p>'; });
  h += '</section>';
  return h;
}

/* ---------------- Plan tab (1.6) ---------------- */
function planHasMeals(week) {
  var cells = planCells(week);
  return Object.keys(cells).some(function (k) { return /^m\d[LD]$/.test(k) && cells[k]; });
}
function currentPlanWeek() {
  var tw = weekSunday(todayStr), nw = addDays(tw, 7);
  if (ui.planWs === tw || ui.planWs === nw) return ui.planWs;
  if (planHasMeals(tw)) return tw;
  if (planHasMeals(nw) || dowOf(todayStr) >= 4) return nw;
  return tw;
}
function planStepDefault(week) {
  var cells = planCells(week);
  var pros = ENGINE.proteinsOf(cells);
  if (pros.length >= 2 && planHasMeals(week)) return "week";
  return "pro";
}
function renderPlan() {
  var week = currentPlanWeek();
  var tw = weekSunday(todayStr);
  var cells = planCells(week), ctx = planCtx(week);
  var step = ui.planStep || planStepDefault(week);
  var pros = ENGINE.proteinsOf(cells);
  var h = '<section class="card"><div class="row spread"><div><h2 style="margin:0">Meal plan</h2>' +
    '<div class="muted small">' + shortDate(week) + ' – ' + shortDate(addDays(week, 5)) + ' · Sunday to Friday</div></div>' +
    '<div class="week-toggle seg"><button data-act="plan-week" data-w="' + tw + '" class="' + (week === tw ? "on" : "") + '">This week</button>' +
    '<button data-act="plan-week" data-w="' + addDays(tw, 7) + '" class="' + (week === addDays(tw, 7) ? "on" : "") + '">Next week</button></div></div>';
  // stepper completion
  var shop = ENGINE.shopping(ctx, cells);
  var totalLines = shop.sections.reduce(function (n, s) { return n + s.lines.length; }, 0) + shop.customs.length;
  var tickedLines = shop.sections.reduce(function (n, s) { return n + s.lines.filter(function (l) { return cells["g_" + l.id]; }).length; }, 0) +
    shop.customs.filter(function (c) { return cells["g_c_" + c.id]; }).length;
  var prepR = ENGINE.prep(ctx, cells, getSetting("prepDay"));
  var prepTickIds = [];
  prepR.steps.forEach(function (s) { prepTickIds.push("t_" + s.tick); });
  prepR.fridge.concat(prepR.freezer, prepR.midweekPortions).forEach(function (p) { prepTickIds.push("t_" + p.tick); });
  prepR.midweek.tasks.forEach(function (t) { prepTickIds.push("t_" + t.tick); });
  prepR.midweek.thaws.forEach(function (t) { prepTickIds.push("t_" + t.tick); });
  var stepDone = {
    pro: pros.length >= 2,
    week: planHasMeals(week),
    shop: totalLines > 0 && tickedLines >= totalLines,
    prep: prepTickIds.length > 0 && prepTickIds.every(function (t) { return cells[t]; })
  };
  var stepsMeta = [["pro", "Proteins"], ["week", "Week"], ["shop", "Shop"], ["prep", "Prep"]];
  h += '<div class="stepper-bar">' + stepsMeta.map(function (sm, i) {
    return '<button class="step-btn' + (step === sm[0] ? " on" : "") + '" data-act="plan-step" data-s="' + sm[0] + '">' + (stepDone[sm[0]] ? "✓" : (i + 1)) + ' ' + sm[1] + '</button>';
  }).join("") + '</div></section>';
  if (step === "pro") h += planProHTML(week, cells, ctx, pros);
  else if (step === "week") h += planWeekHTML(week, cells, ctx);
  else if (step === "shop") h += planShopHTML(week, cells, ctx, shop, tickedLines, totalLines);
  else h += planPrepHTML(week, cells, ctx, prepR);
  return h;
}
function planProHTML(week, cells, ctx, pros) {
  var h = '<section class="card"><h3>Pick this week\'s proteins</h3><div class="pgrid">';
  PD.PROTEINS.forEach(function (p) {
    var picked = pros.indexOf(p[0]) >= 0;
    var dis = !picked && pros.length >= 4;
    h += '<button class="chip protein-chip' + (picked ? " on" : "") + '" data-act="pro" data-id="' + p[0] + '"' + (dis ? " disabled" : "") + '>' +
      '<span>' + tagPill(p[2]) + ' <b>' + esc(p[1]) + '</b></span><span class="hint">' + esc(p[3]) + '</span></button>';
  });
  h += '</div><p class="muted">' + pros.length + ' picked · ' + (pros.length >= 4 ? "that\'s the max" : pros.length >= 2 ? "ready when you are" : "pick at least 2") + '</p>';
  var toggles = [
    ["on5L", "Friday lunch", cells.on5L !== false],
    ["on5D", "Friday night dinner", cells.on5D === true],
    ["lo", "Leftover lunches", cells.lo !== false]
  ];
  toggles.forEach(function (t) {
    h += '<div class="toggle-row"><div><b>' + t[1] + '</b>' + (t[0] === "on5D" ? '<div class="habit-sub">That\'s the Shabbos meal</div>' : t[0] === "lo" ? '<div class="habit-sub">Cook dinner ×2 and pack the second portion for the next day\'s lunch</div>' : "") + '</div>' +
      '<button class="switch' + (t[2] ? " on" : "") + '" data-act="ptoggle" data-k="' + t[0] + '" role="switch" aria-checked="' + t[2] + '" aria-label="' + t[1] + '"></button></div>';
  });
  var skipNames = [];
  for (var d = 0; d <= 5; d++) if (ctx.rest[d]) skipNames.push(ctx.rest[d]);
  h += '<p class="muted small">Sunday–Friday lunches and Sunday–Thursday dinners. Shabbos and Yom Tov aren\'t planned' +
    (skipNames.length ? ', so this week skips ' + esc(skipNames.join(", ")) + '.' : '.') + '</p>';
  var built = planHasMeals(week);
  h += '<button class="btn primary big" data-act="build"' + (pros.length < 2 || pros.length > 4 ? " disabled" : "") + '>' + (built ? "Rebuild the week (locked meals stay)" : "Build my week") + '</button>';
  if (built) h += '<p style="text-align:center"><button class="link-btn" data-act="plan-step" data-s="week">See this week\'s plan</button></p>';
  h += '</section>';
  return h;
}
function mealCardHTML(ctx, cells, key) {
  var r = ENGINE.resolve(ctx, cells, key);
  if (!r) return "";
  var slotName = r.slot === "L" ? "Lunch ~1pm" : "Dinner ~8pm";
  var h = '<div class="meal-card"><div class="row spread"><span class="slot-label">' + slotName + '</span>' +
    '<span class="meal-actions"><button class="mini-btn" data-act="shuffle-one" data-k="' + key + '"' + (r.locked ? " disabled" : "") + ' aria-label="Shuffle this meal">🔀</button>' +
    '<button class="mini-btn" data-act="lock" data-k="' + key + '" aria-label="Lock this meal">' + (r.locked ? "🔒" : "🔓") + '</button></span></div>';
  if (!r.meal) { h += '<div class="meal-name muted">Nothing planned yet</div></div>'; return h; }
  var hint = r.lo ? "reheat" : r.meal.min >= 90 ? "prep-day pot" : r.meal.min + " min";
  h += '<div class="meal-name">' + tagPill(r.meal.t) + ' ' + (r.lo ? "Leftovers: " : "") + esc(r.meal.n) + ' <span class="muted small">· ' + hint + '</span></div>' +
    '<div class="meal-how">' + (r.lo ? "Second portion of last night's dinner, packed on the night." : esc(r.meal.how)) + '</div>';
  if (r.slot === "D") {
    var nx = ENGINE.resolve(ctx, cells, "m" + (r.dow + 1) + "L");
    if (nx && nx.lo && nx.meal && nx.meal.id === r.meal.id) h += '<div class="kv">Cook ×2: tomorrow\'s lunch</div>';
  }
  h += '</div>';
  return h;
}
function planWeekHTML(week, cells, ctx) {
  var h = "";
  var pair = ENGINE.breakfastPair(cells);
  var bdays = ENGINE.breakfastDays(ctx, cells);
  h += '<section class="card"><div class="row spread"><h3 style="margin:0">Breakfast</h3><button class="mini-btn" data-act="bk-shuffle" aria-label="Shuffle breakfasts">🔀</button></div>';
  [0, 1].forEach(function (pi) {
    var days = bdays.filter(function (b) { return b.bkId === pair[pi]; }).map(function (b) { return ENGINE.DAY3[b.dow]; });
    var bk = PD.BK[pair[pi]];
    if (bk) h += '<p><b>' + esc(days.join(" · ")) + '</b> — ' + tagPill(bk.t) + ' ' + esc(bk.n) + '</p>';
  });
  h += '</section>';
  var slotKeys = {};
  ENGINE.slots(ctx, cells).forEach(function (s) { slotKeys[s.key] = true; });
  for (var d = 0; d <= 6; d++) {
    var date = addDays(week, d);
    if (ctx.rest[d]) {
      h += '<div class="rest-row">✦ ' + ENGINE.DAYN[d] + ', ' + shortDate(date) + ' · ' + esc(ctx.rest[d]) + ': not planned here</div>';
      continue;
    }
    if (d > 5) continue;
    if (date < todayStr) {
      var parts = [];
      ["L", "D"].forEach(function (sl) {
        var r = ENGINE.resolve(ctx, cells, "m" + d + sl);
        if (r && r.meal) parts.push((r.lo ? "Leftovers: " : "") + r.meal.n);
      });
      h += '<div class="past-line"><b>' + ENGINE.DAY3[d] + '</b>  ' + esc(parts.join(" · ") || "—") + '</div>';
      continue;
    }
    h += '<section class="card"><div class="day-head">' + ENGINE.DAYN[d] + ', ' + shortDate(date) + (date === todayStr ? ' · <span style="color:var(--accent)">today</span>' : "") + '</div>';
    if (slotKeys["m" + d + "L"]) h += mealCardHTML(ctx, cells, "m" + d + "L");
    if (slotKeys["m" + d + "D"]) h += mealCardHTML(ctx, cells, "m" + d + "D");
    var rl = ENGINE.resolve(ctx, cells, "m" + d + "L"), rd = ENGINE.resolve(ctx, cells, "m" + d + "D");
    if (rl && rl.meal && rd && rd.meal && rl.meal.t === "M" && rd.meal.t === "D") {
      h += '<p class="warn">Meat lunch, dairy dinner: about 7 hours apart. Fine if that fits your waiting time; otherwise shuffle one.</p>';
    }
    if (d === 5 && !slotKeys["m5D"]) h += '<p class="muted">Friday night is Shabbos.</p>';
    if (ctx.pre[d]) h += '<p class="muted">Tonight is Yom Tov: dinner isn\'t planned.</p>';
    h += '</section>';
  }
  h += '<section class="card"><div class="row wrap"><button class="btn" data-act="shuffle-all">🔀 Shuffle all unlocked</button>' +
    '<button class="btn primary" data-act="plan-step" data-s="shop">Next: shopping list</button></div>' +
    '<p><button class="danger-link" data-act="week-clear">Start this week over</button></p></section>';
  return h;
}
function planShopHTML(week, cells, ctx, shop, ticked, total) {
  var h = '<section class="card"><h3>Shopping list</h3>' +
    '<p class="muted">Built from this week\'s plan (meals still ahead), sized for one, plus your everyday snacks and treats.</p>' +
    '<div class="progress"><div style="width:' + (total ? Math.round(ticked / total * 100) : 0) + '%"></div></div>' +
    '<p class="muted small">' + ticked + ' of ' + total + ' · Look for a reliable hechsher on everything packaged. Meat and poultry from a kosher butcher.</p></section>';
  shop.sections.forEach(function (sec) {
    if (sec.key === "mine") {
      h += '<section class="card"><h3>Your items</h3>';
      shop.customs.forEach(function (c) {
        var on = !!cells["g_c_" + c.id];
        h += '<div class="shop-line' + (on ? " done" : "") + '"><input type="checkbox" data-act="gtick" data-cid="' + c.id + '"' + (on ? " checked" : "") + ' aria-label="' + esc(c.n) + '">' +
          '<span class="grow nm">' + esc(c.n) + '</span>' + (c.q ? '<span class="qty">' + esc(c.q) + '</span>' : "") +
          '<button class="x-btn" data-act="custom-del" data-cell="' + c.cell + '" aria-label="Remove item">×</button></div>';
      });
      h += '<div class="add-row"><input id="customAdd" data-keep maxlength="60" placeholder="Add an item (snacks, treats…)" aria-label="Add an item"><button class="btn" data-act="custom-add">Add</button></div></section>';
      return;
    }
    if (!sec.lines.length) return;
    h += '<section class="card"><h3>' + esc(sec.name) + '</h3>';
    sec.lines.forEach(function (l) {
      var on = !!cells["g_" + l.id];
      h += '<div class="shop-line' + (on ? " done" : "") + '"><input type="checkbox" data-act="gtick" data-id="' + l.id + '"' + (on ? " checked" : "") + ' aria-label="' + esc(l.name) + '">' +
        '<span class="grow"><span class="nm">' + esc(l.name) + '</span>' + (l.why ? '<br><span class="kv">' + esc(l.why) + '</span>' : "") + '</span>' +
        (l.qty ? '<span class="qty">' + esc(l.qty) + '</span>' : '<span class="kv">check you have</span>') +
        (l.stapleOnly ? '<button class="x-btn" data-act="hide-staple" data-id="' + l.id + '" title="Not this week" aria-label="Not this week">×</button>' : "") + '</div>';
    });
    h += '</section>';
  });
  if (shop.hidden.length) {
    h += '<section class="card"><h3>Hidden this week</h3>' + shop.hidden.map(function (hd) {
      return '<div class="row spread"><span class="muted">' + esc(hd.name) + '</span><button class="link-btn" data-act="unhide" data-id="' + hd.id + '">Put back</button></div>';
    }).join("") + '</section>';
  }
  h += '<section class="card"><div class="row wrap"><button class="btn" data-act="uncheck-all">Uncheck all</button>' +
    '<button class="btn primary" data-act="plan-step" data-s="prep">Next: prep day</button></div></section>';
  return h;
}
function planPrepHTML(week, cells, ctx, prep) {
  var saved = getSetting("prepDay");
  var h = '<section class="card"><h3>Your prep day</h3>' +
    '<p class="muted">Your prep day, saved for every week. Pick any day; Shabbos is off the list.</p><div class="day-picker">';
  for (var d = 0; d <= 5; d++) {
    h += '<button class="chip' + (saved === d ? " on" : "") + '" data-act="prepday" data-d="' + d + '"' + (ctx.rest[d] ? " disabled" : "") + '>' + ENGINE.DAY3[d] + '</button>';
  }
  h += '</div>';
  if (prep.note) h += '<p class="warn">' + esc(prep.note) + '</p>';
  h += '<p><b>' + ENGINE.DAYN[prep.prepDay] + '</b> · about ' + prep.durText + ' · ' + prep.containers + ' containers</p>';
  var allT = [];
  prep.steps.forEach(function (s) { allT.push("t_" + s.tick); });
  prep.fridge.concat(prep.freezer, prep.midweekPortions).forEach(function (p) { allT.push("t_" + p.tick); });
  prep.midweek.tasks.forEach(function (t) { allT.push("t_" + t.tick); });
  prep.midweek.thaws.forEach(function (t) { allT.push("t_" + t.tick); });
  var doneT = allT.filter(function (t) { return cells[t]; }).length;
  if (allT.length) h += '<div class="progress"><div style="width:' + Math.round(doneT / allT.length * 100) + '%"></div></div><p class="muted small">' + doneT + ' of ' + allT.length + ' done</p>';
  if (prep.long) h += '<p class="warn">Long one because of a slow pot. Start the pot first and do everything else while it simmers, or start it in a slow cooker the night before.</p>';
  h += '</section>';
  if (prep.before.length) {
    h += '<section class="card"><h3>Before ' + ENGINE.DAYN[prep.prepDay] + '</h3>' +
      prep.before.map(function (b) { return '<p><b>' + ENGINE.DAY3[b.dow] + '</b> ' + (b.slot === "L" ? "Lunch" : "Dinner") + ': ' + esc(b.name) + '</p>'; }).join("") +
      '<p class="muted small">Cook them on the day, or pick an earlier prep day.</p></section>';
  }
  if (prep.empty) {
    h += '<section class="card"><p>Nothing to batch-cook from ' + ENGINE.DAYN[prep.prepDay] + ' on: those meals are quick, cook-fresh ones.</p></section>';
  } else {
    h += '<section class="card"><h3>The session</h3>';
    prep.steps.forEach(function (s) {
      var on = !!cells["t_" + s.tick];
      h += '<div class="prep-step"><input type="checkbox" data-act="ttick" data-id="t_' + s.tick + '"' + (on ? " checked" : "") + ' aria-label="' + esc(s.title) + '">' +
        '<span class="clock">' + ENGINE.clock(s.start) + '</span><div class="grow"><b>' + esc(s.title) + '</b>' +
        (s.amount ? ' · ' + esc(s.amount) : "") + (s.meat ? ' ' + tagPill("M") : "") +
        '<div class="meal-how">' + esc(s.how) + '</div>' +
        (s.feeds && s.feeds.length ? '<div class="kv">For: ' + esc(s.feeds.join(", ")) + '</div>' : "") +
        (s.keep ? '<div class="kv">Keeps: ' + esc(s.keep) + '</div>' : "") +
        (s.ready ? '<div class="kv">Ready around ' + s.ready + '</div>' : "") + '</div></div>';
    });
    h += '</section>';
  }
  function portionLines(list) {
    return list.map(function (p) {
      var on = !!cells["t_" + p.tick];
      return '<div class="prep-step"><input type="checkbox" data-act="ttick" data-id="t_' + p.tick + '"' + (on ? " checked" : "") + ' aria-label="' + esc(p.name) + '">' +
        '<div><b>' + ENGINE.DAY3[p.dow] + '</b> ' + (p.slot === "L" ? "Lunch" : "Dinner") + ': ' + esc(p.name) + '</div></div>';
    }).join("");
  }
  if (prep.fridge.length || prep.freezer.length) {
    h += '<section class="card"><h3>Portion &amp; store</h3>';
    if (prep.fridge.length) h += '<h4>Fridge · eat by ' + ENGINE.DAYN[dowOf(prep.eatBy)] + ', ' + shortDate(prep.eatBy) + '</h4>' + portionLines(prep.fridge);
    if (prep.freezer.length) h += '<h4>Freezer · day 4 and later</h4>' + portionLines(prep.freezer);
    h += '</section>';
  }
  if (prep.cookFresh.length) {
    h += '<section class="card"><h3>Cook fresh that day</h3>' +
      prep.cookFresh.map(function (c) {
        return '<p><b>' + ENGINE.DAY3[c.dow] + '</b> ' + (c.slot === "L" ? "Lunch" : "Dinner") + ': ' + esc(c.name) +
          (c.freezerPart ? '<br><span class="kv">Part of it is in the freezer — move it to the fridge the night before.</span>' : "") + '</p>';
      }).join("") +
      '<p class="muted small">Fish: keep raw fish in the fridge and cook within 1–2 days of buying, or buy frozen and thaw overnight.</p></section>';
  }
  if (prep.midweek.tasks.length || prep.midweek.thaws.length || prep.midweekPortions.length) {
    h += '<section class="card"><h3>Mid-week</h3><p class="muted">' + ENGINE.DAYN[prep.midweek.day] + ' night top-up · about ' + prep.midweek.durText + '</p>';
    prep.midweek.tasks.forEach(function (t) {
      var on = !!cells["t_" + t.tick];
      h += '<div class="prep-step"><input type="checkbox" data-act="ttick" data-id="t_' + t.tick + '"' + (on ? " checked" : "") + ' aria-label="' + esc(t.title) + '">' +
        '<div class="grow"><b>' + esc(t.title) + '</b>' + (t.amount ? ' · ' + esc(t.amount) : "") + (t.meat ? ' ' + tagPill("M") : "") +
        '<div class="meal-how">' + esc(t.how) + '</div>' +
        (t.feeds.length ? '<div class="kv">For: ' + esc(t.feeds.join(", ")) + '</div>' : "") + '</div></div>';
    });
    if (prep.midweekPortions.length) h += '<h4>Portions from the top-up</h4>' + portionLines(prep.midweekPortions);
    if (prep.midweek.thaws.length) {
      h += '<h4>Thaw reminders</h4>' + prep.midweek.thaws.map(function (t) {
        var on = !!cells["t_" + t.tick];
        return '<div class="prep-step"><input type="checkbox" data-act="ttick" data-id="t_' + t.tick + '"' + (on ? " checked" : "") + ' aria-label="' + esc(t.text) + '"><div>' + esc(t.text) + ' — the night before</div></div>';
      }).join("");
    }
    h += '</section>';
  }
  h += '<details class="card"><summary>How long things keep</summary>' +
    PD.STORAGE.map(function (s) { return '<p><b>' + esc(s[0]) + '</b><br><span class="muted">' + esc(s[1]) + '</span></p>'; }).join("") + '</details>';
  h += '<section class="card"><p class="muted">Meat in meat pans and containers, dairy in dairy. Rice, veg and eggs in pareve pots go with anything. Label every container M / D / P.</p>' +
    (doneT > 0 ? '<button class="btn" data-act="prep-clear">Clear prep ticks</button>' : "") + '</section>';
  return h;
}

/* ---------------- readable snap (1.6) ---------------- */
var snapTimer = null;
function scheduleSnap() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(function () {
    var week = currentPlanWeek();
    var cells = planCells(week), ctx = planCtx(week);
    if (!planHasMeals(week)) return;
    var meals = [];
    ENGINE.slots(ctx, cells).forEach(function (s) {
      var r = ENGINE.resolve(ctx, cells, s.key);
      if (r && r.meal) meals.push({ day: ENGINE.DAYN[s.dow], date: s.date, slot: s.slot === "L" ? "Lunch" : "Dinner", name: (r.lo ? "Leftovers: " : "") + r.meal.n, tag: r.meal.t, protein: r.meal.p, leftovers: !!r.lo, locked: !!r.locked, past: !!s.past });
    });
    var shop = ENGINE.shopping(ctx, cells);
    var shoppingList = [];
    shop.sections.forEach(function (sec) { sec.lines.forEach(function (l) { shoppingList.push({ name: l.name, qty: l.qty, done: !!cells["g_" + l.id], section: sec.name }); }); });
    shop.customs.forEach(function (c) { shoppingList.push({ name: c.n, qty: c.q, done: !!cells["g_c_" + c.id], section: "Your items" }); });
    var prep = ENGINE.prep(ctx, cells, getSetting("prepDay"));
    var snap = {
      proteins: ENGINE.proteinsOf(cells),
      breakfast: ENGINE.breakfastPair(cells).map(function (id) { return PD.BK[id] ? PD.BK[id].n : id; }),
      meals: meals,
      shopping: shoppingList,
      prep: {
        day: ENGINE.DAYN[prep.prepDay], duration: prep.durText,
        steps: prep.steps.map(function (s) { return { title: s.title, done: !!cells["t_" + s.tick] }; }),
        fridge: prep.fridge.map(function (p) { return p.name; }),
        freezer: prep.freezer.map(function (p) { return p.name; }),
        cookFresh: prep.cookFresh.map(function (c) { return c.name; }),
        midweek: prep.midweek.tasks.map(function (t) { return t.title; })
      }
    };
    var cur = cells.snap;
    if (JSON.stringify(cur || null) !== JSON.stringify(snap)) opPlan(week, "snap", snap, { silent: true });
  }, 2500);
}

/* ---------------- actions ---------------- */
function writeCells(week, newCells, onlyKeys) {
  var cur = planCells(week);
  var keys = onlyKeys || Object.keys(newCells);
  keys.forEach(function (k) {
    if (JSON.stringify(cur[k] === undefined ? null : cur[k]) !== JSON.stringify(newCells[k] === undefined ? null : newCells[k])) {
      opPlan(week, k, newCells[k] === undefined ? null : newCells[k], { silent: true });
    }
  });
}
function buildWeek(week) {
  var cells = planCells(week);
  var hasC = Object.keys(cells).some(function (k) { return k.indexOf("c_") === 0; });
  var hasH = Object.keys(cells).some(function (k) { return k.indexOf("h_") === 0; });
  if (!hasC || !hasH || !cells.bk) {
    var earlier = Object.keys(state.plans).filter(function (w) { return w < week && planHasMeals(w); }).sort();
    if (earlier.length) {
      var src = planCells(earlier[earlier.length - 1]);
      Object.keys(src).forEach(function (k) {
        if (!hasC && k.indexOf("c_") === 0 && src[k]) opPlan(week, k, src[k], { silent: true });
        if (!hasH && k.indexOf("h_") === 0 && src[k]) opPlan(week, k, src[k], { silent: true });
      });
      if (!cells.bk && src.bk) opPlan(week, "bk", src.bk, { silent: true });
      cells = planCells(week);
    }
  }
  var ctx = planCtx(week);
  var gen = ENGINE.generate(ctx, cells, Math.random);
  var keys = Object.keys(gen).concat(Object.keys(cells).filter(function (k) { return /^m\d[LD]$/.test(k); }));
  writeCells(week, gen, keys.filter(function (k, i) { return keys.indexOf(k) === i; }));
  ui.planStep = "week"; saveUi();
  buzz(15);
  saveLocal();
  statusAfterEdit();
  render(true);
}

var stepsSaveTimer = null;
function saveSteps(input, immediate) {
  var save = function () {
    var raw = input.value.trim();
    var n = raw === "" ? null : Math.round(Number(raw));
    if (raw !== "" && (!isFinite(n) || n === null)) return;
    if (typeof n === "number") n = Math.max(0, Math.min(100000, n));
    if (getDayF(selDate, "steps") === (n === null ? undefined : n) || (n === null && getDayF(selDate, "steps") === undefined)) { if (immediate) render(true); return; }
    opDaySilent(selDate, "steps", n, { render: immediate });
    if (immediate) render(true);
  };
  if (immediate) { clearTimeout(stepsSaveTimer); save(); }
  else { clearTimeout(stepsSaveTimer); stepsSaveTimer = setTimeout(save, 700); }
}

document.addEventListener("click", function (ev) {
  var el = ev.target.closest ? ev.target.closest("[data-act]") : null;
  if (!el) return;
  var act = el.getAttribute("data-act");
  // tabs
  if (act === "tab") { ui.tab = el.getAttribute("data-tab"); saveUi(); render(true); window.scrollTo(0, 0); return; }
  if (act === "goto-workout") { gotoTab("workout"); return; }
  if (act === "goto-plan-week") { ui.planWs = weekSunday(selDate); gotoTab("plan", "week"); return; }
  if (act === "goto-plan-prep") { gotoTab("plan", "prep"); return; }
  if (act === "goto-plan-pro") { gotoTab("plan", "pro"); return; }
  if (act === "shabbos-tips") { ui.tab = "meals"; saveUi(); render(true); setTimeout(function () { var c = document.getElementById("shabbosCard"); if (c) c.scrollIntoView({ behavior: "smooth" }); }, 60); return; }
  if (act === "meals-jump") { var t = document.getElementById(el.getAttribute("data-t")); if (t) t.scrollIntoView({ behavior: "smooth" }); return; }
  if (act === "acc") { ui.mealOpen = ui.mealOpen === el.getAttribute("data-k") ? "" : el.getAttribute("data-k"); saveUi(); render(true); return; }
  // today
  if (act === "day-prev") { selDate = addDays(selDate, -1); render(true); return; }
  if (act === "day-next") { if (selDate < todayStr) selDate = addDays(selDate, 1); render(true); return; }
  if (act === "dot") { selDate = el.getAttribute("data-date"); render(true); return; }
  if (act === "goto-today") { selDate = todayStr; render(true); return; }
  if (act === "tick") {
    var f = el.getAttribute("data-f");
    if (isRest(selDate)) return;
    var now = !getDayF(selDate, f);
    if (now) buzz(12);
    opDay(selDate, f, now);
    return;
  }
  if (act === "checkin-save") {
    var wIn = document.getElementById("ciWeight"), waIn = document.getElementById("ciWaist");
    var wRaw = wIn ? wIn.value.trim() : "", waRaw = waIn ? waIn.value.trim() : "";
    var w = wRaw === "" ? null : Number(wRaw), wa = waRaw === "" ? null : Number(waRaw);
    if (w !== null && (!(w >= 50 && w <= 700))) { wIn.focus(); return; }
    if (wa !== null && (!(wa >= 10 && wa <= 90))) { waIn.focus(); return; }
    var entries = checkinEntries(), target = todayStr;
    entries.forEach(function (e) { if (e.date >= weekSunday(todayStr) && e.date <= todayStr) target = e.date; });
    if (w !== null) opDaySilent(target, "weight", Math.round(w * 10) / 10, { silent: true });
    if (wa !== null) opDaySilent(target, "waist", Math.round(wa * 100) / 100, { silent: true });
    saveLocal(); statusAfterEdit(); render(true);
    return;
  }
  // workout
  if (act === "round") {
    var date = selDate, i = +el.getAttribute("data-i");
    var arr = (ui.rounds[date] || []).slice();
    arr[i] = !arr[i];
    ui.rounds[date] = arr;
    Object.keys(ui.rounds).forEach(function (d) { if (d < addDays(todayStr, -7)) delete ui.rounds[d]; });
    saveUi();
    if (arr[i] && i < getSetting("workoutRounds") - 1 && !restTimer.end) startRestTimer(); else render(true);
    return;
  }
  if (act === "rest-timer") {
    if (restTimer.end) { stopRestTimer(); render(true); } else startRestTimer();
    return;
  }
  if (act === "level") { opSettings("workoutLevel", Math.max(0, getSetting("workoutLevel") + (+el.getAttribute("data-d")))); return; }
  if (act === "rounds-set") { opSettings("workoutRounds", +el.getAttribute("data-n")); return; }
  if (act === "workout-done") {
    var wo = !!getDayF(selDate, "workout");
    if (wo) { opDay(selDate, "workout", false); return; }
    var f2 = {};
    f2.workout = { v: true, ts: tsNow() };
    f2.workoutOff = { v: false, ts: tsNow() };
    f2.workoutNote = { v: getSetting("workoutRounds") + " rounds, reps +" + getSetting("workoutLevel"), ts: tsNow() };
    queueOp({ type: "day", date: selDate, f: f2 });
    buzz(20);
    return;
  }
  // plan
  if (act === "plan-week") { ui.planWs = el.getAttribute("data-w"); saveUi(); render(true); return; }
  if (act === "plan-step") { ui.planStep = el.getAttribute("data-s"); saveUi(); render(true); return; }
  if (act === "pro") {
    var week = currentPlanWeek(), cells = planCells(week), id = el.getAttribute("data-id");
    var pros = ENGINE.proteinsOf(cells), ix = pros.indexOf(id);
    if (ix >= 0) pros.splice(ix, 1); else if (pros.length < 4) pros.push(id);
    opPlan(week, "pro", pros);
    return;
  }
  if (act === "ptoggle") {
    var week2 = currentPlanWeek(), cells2 = planCells(week2), k = el.getAttribute("data-k");
    var cur = k === "on5D" ? cells2[k] === true : cells2[k] !== false;
    opPlan(week2, k, !cur);
    return;
  }
  if (act === "build") { buildWeek(currentPlanWeek()); return; }
  if (act === "shuffle-all") {
    var week3 = currentPlanWeek(), ctx3 = planCtx(week3);
    var gen = ENGINE.generate(ctx3, planCells(week3), Math.random);
    writeCells(week3, gen, Object.keys(gen));
    saveLocal(); statusAfterEdit(); render(true);
    return;
  }
  if (act === "shuffle-one") {
    var week4 = currentPlanWeek(), ctx4 = planCtx(week4), key = el.getAttribute("data-k");
    var out = ENGINE.shuffleOne(ctx4, planCells(week4), key, Math.random);
    var keys = [key];
    if (key.slice(-1) === "D") keys.push("m" + (+key.charAt(1) + 1) + "L");
    writeCells(week4, out, keys);
    saveLocal(); statusAfterEdit(); render(true);
    return;
  }
  if (act === "lock") {
    var week5 = currentPlanWeek(), cells5 = planCells(week5), key5 = el.getAttribute("data-k");
    var cur5 = cells5[key5];
    if (cur5) { var copy = JSON.parse(JSON.stringify(cur5)); if (copy.k) delete copy.k; else copy.k = true; opPlan(week5, key5, copy); }
    return;
  }
  if (act === "bk-shuffle") {
    var week6 = currentPlanWeek(), ids = Object.keys(PD.BK);
    var a = ids[Math.floor(Math.random() * ids.length)], b = a;
    while (b === a) b = ids[Math.floor(Math.random() * ids.length)];
    opPlan(week6, "bk", [a, b]);
    return;
  }
  if (act === "week-clear") {
    if (!window.confirm("Start this week over? This clears the meals, list ticks and prep ticks for this week.")) return;
    var week7 = currentPlanWeek();
    queueOp({ type: "plan", week: week7, clear: tsNow(), f: {} });
    ui.planStep = "pro"; saveUi();
    return;
  }
  if (act === "gtick") {
    var week8 = currentPlanWeek();
    var cell = el.getAttribute("data-cid") ? "g_c_" + el.getAttribute("data-cid") : "g_" + el.getAttribute("data-id");
    opPlan(week8, cell, !!el.checked);
    return;
  }
  if (act === "ttick") {
    opPlan(currentPlanWeek(), el.getAttribute("data-id"), !!el.checked);
    return;
  }
  if (act === "hide-staple") { opPlan(currentPlanWeek(), "h_" + el.getAttribute("data-id"), true); return; }
  if (act === "unhide") { opPlan(currentPlanWeek(), "h_" + el.getAttribute("data-id"), false); return; }
  if (act === "custom-add") {
    var inp = document.getElementById("customAdd");
    var name = inp ? inp.value.trim().slice(0, 60) : "";
    if (!name) return;
    var cid = Date.now().toString(36);
    opPlan(currentPlanWeek(), "c_" + cid, { n: name, at: Date.now() });
    return;
  }
  if (act === "custom-del") { opPlan(currentPlanWeek(), el.getAttribute("data-cell"), null); return; }
  if (act === "uncheck-all") {
    if (!window.confirm("Uncheck the whole list?")) return;
    var week9 = currentPlanWeek(), cells9 = planCells(week9);
    Object.keys(cells9).forEach(function (k) { if (k.indexOf("g_") === 0 && cells9[k]) opPlan(week9, k, false, { silent: true }); });
    saveLocal(); statusAfterEdit(); render(true);
    return;
  }
  if (act === "prepday") { opSettings("prepDay", +el.getAttribute("data-d")); return; }
  if (act === "prep-clear") {
    var weekA = currentPlanWeek(), cellsA = planCells(weekA);
    Object.keys(cellsA).forEach(function (k) { if (k.indexOf("t_") === 0 && cellsA[k]) opPlan(weekA, k, false, { silent: true }); });
    saveLocal(); statusAfterEdit(); render(true);
    return;
  }
  // settings dialog buttons
  if (act === "rest-set") {
    var mode = el.getAttribute("data-m");
    opDay(selDate, "restOverride", mode === "clear" ? null : mode);
    setTimeout(openSettings, 50);
    return;
  }
});
document.addEventListener("input", function (ev) {
  if (ev.target && ev.target.id === "stepsInput") saveSteps(ev.target, false);
});
document.addEventListener("change", function (ev) {
  if (ev.target && ev.target.id === "stepsInput") saveSteps(ev.target, true);
});
document.addEventListener("toggle", function (ev) {
  if (ev.target && ev.target.id === "weighDetails") { ui.weighOpen = ev.target.open; saveUi(); }
  if (ev.target && ev.target.id === "warmDetails") { ui.warmOpen = ev.target.open; saveUi(); }
}, true);
document.addEventListener("keydown", function (ev) {
  if (ev.key !== "Enter") return;
  if (ev.target && ev.target.id === "customAdd") { ev.preventDefault(); var b = document.querySelector('[data-act="custom-add"]'); if (b) b.click(); }
});

/* ---------------- settings dialog (1.8) ---------------- */
function openSettings() {
  var dlg = document.getElementById("settingsDlg");
  document.getElementById("setStepGoal").value = getSetting("stepGoal");
  document.getElementById("setWorkoutTarget").value = getSetting("workoutTarget");
  var rn = restName(selDate), ov = getDayF(selDate, "restOverride");
  document.getElementById("setRestLabel").textContent = "Rest day for " + longDate(selDate) + ": " + (rn || "Normal day");
  var ctl = "";
  if (ov !== "normal") ctl += '<button class="btn" data-act="rest-set" data-m="normal">Track this day anyway</button>';
  if (ov !== "rest") ctl += '<button class="btn" data-act="rest-set" data-m="rest">Mark as a rest day</button>';
  if (ov) ctl += '<button class="btn" data-act="rest-set" data-m="clear">Reset to calendar</button>';
  document.getElementById("setRestCtl").innerHTML = ctl;
  if (typeof dlg.showModal === "function" && !dlg.open) dlg.showModal();
}
document.getElementById("gearBtn").addEventListener("click", openSettings);
document.getElementById("setSave").addEventListener("click", function () {
  var sg = Number(document.getElementById("setStepGoal").value);
  var wt = Number(document.getElementById("setWorkoutTarget").value);
  if (sg >= 1000 && sg <= 40000 && sg !== getSetting("stepGoal")) opSettings("stepGoal", sg);
  if (wt >= 1 && wt <= 7 && wt !== getSetting("workoutTarget")) opSettings("workoutTarget", Math.round(wt));
});

/* ---------------- backup / restore ---------------- */
document.getElementById("backupBtn").addEventListener("click", function () {
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "steady-backup-" + todayStrFn() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
});
document.getElementById("restoreBtn").addEventListener("click", function () {
  document.getElementById("restoreInput").click();
});
document.getElementById("restoreInput").addEventListener("change", function (ev) {
  var file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var parsed = null;
    try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== "object" || !("days" in parsed || "plans" in parsed || "settings" in parsed)) {
      window.alert("That file doesn't look like a Steady backup.");
      return;
    }
    if (!window.confirm("Restore this backup? It replaces everything Steady has saved on this phone.")) return;
    state = {
      settings: parsed.settings && parsed.settings.f ? parsed.settings : { f: {} },
      favorites: parsed.favorites && parsed.favorites.items ? parsed.favorites : { items: {} },
      days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
      grocery: parsed.grocery && parsed.grocery.f ? parsed.grocery : { f: {} },
      plans: parsed.plans && typeof parsed.plans === "object" ? parsed.plans : {}
    };
    saveLocal();
    var dlg = document.getElementById("settingsDlg");
    if (dlg && dlg.open) dlg.close();
    setStatus("Saved on this phone");
    render(true);
  };
  reader.readAsText(file);
});

/* ---------------- lifecycle ---------------- */
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible") return;
  var nt = todayStrFn();
  if (nt !== todayStr) { if (selDate === todayStr) selDate = nt; todayStr = nt; }
  render();
});

/* ---------------- boot ---------------- */
document.querySelectorAll("#bottomNav button").forEach(function (b) { b.setAttribute("data-act", "tab"); });
try { localStorage.removeItem("steady.queue"); } catch (e) {}
if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {} }
render(true);
loadCalendar().then(function () { render(true); });
