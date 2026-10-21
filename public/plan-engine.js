/* plan-engine.js — pure planner functions for Steady. window.PLAN_ENGINE.
   No DOM, no storage, no network. All randomness flows through an optional
   seeded rand() so tests can be deterministic. */
(function (root) {
  "use strict";
  var PD = root.PLAN_DATA || (typeof PLAN_DATA !== "undefined" ? PLAN_DATA : null);
  var MEALS = PD.MEALS, BK = PD.BK, ITEMS = PD.ITEMS, COMP = PD.COMP;

  var DAYN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* ---------- dates ---------- */
  function parseD(s) { var p = String(s).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function fmtD(d) {
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate());
  }
  function addDays(s, n) { var d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); }
  function dowOf(s) { return parseD(s).getUTCDay(); }

  /* ---------- number text ---------- */
  var VULGAR = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾" };
  function frac(n) {
    var whole = Math.floor(n + 1e-9), rest = Math.round((n - whole) * 4) / 4;
    if (rest === 1) { whole += 1; rest = 0; }
    var f = VULGAR[rest] || "";
    if (whole === 0) return f || "0";
    return String(whole) + f;
  }
  function dur(mins) {
    var t = Math.round(mins / 5) * 5, h = Math.floor(t / 60), m = t % 60;
    if (h && m) return h + " hr " + m + " min";
    if (h) return h + " hr";
    return m + " min";
  }
  function clock(mins) {
    var h = Math.floor(mins / 60), m = Math.round(mins % 60);
    if (m === 60) { h += 1; m = 0; }
    return h + ":" + (m < 10 ? "0" : "") + m;
  }
  function qtyText(id, amount) {
    var it = ITEMS[id]; if (!it) return "";
    var unit = it[2];
    if (unit === "have") return "";
    if (unit === "lb") { var q = Math.max(0.25, Math.ceil(amount * 4 - 1e-9) / 4); return frac(q) + " lb"; }
    if (unit === "ct") { return String(Math.max(1, Math.ceil(amount - 0.05))); }
    if (unit === "can") { var c = Math.max(1, Math.ceil(amount - 1e-9)); return c + (c === 1 ? " can" : " cans"); }
    if (unit === "eggs") {
      var n = Math.max(6, Math.ceil(amount / 6) * 6);
      if (n % 12 === 0) return frac(n / 12) + " dozen";
      if (n > 12) return n + " (" + frac(n / 12) + " dozen)";
      return n + " eggs";
    }
    if (unit.indexOf("pk|") === 0) {
      var parts = unit.split("|"), per = parseFloat(parts[1]);
      var pk = Math.max(1, Math.ceil(amount / per - 0.02));
      return pk + " " + (pk === 1 ? parts[2] : parts[3]);
    }
    return "";
  }

  /* ---------- cells ---------- */
  // Accept either a plan doc ({f:{cell:{v,ts}}}) or a flat {cell: value} map.
  function cellVals(cells) {
    var out = {};
    if (!cells) return out;
    if (cells.f) { for (var k in cells.f) { var c = cells.f[k]; out[k] = c ? c.v : undefined; } return out; }
    for (var k2 in cells) out[k2] = cells[k2];
    return out;
  }
  function proteinsOf(cells) {
    var v = cellVals(cells).pro;
    return Array.isArray(v) ? v.slice() : [];
  }

  /* ---------- slots ---------- */
  function slots(ctx, cells) {
    var v = cellVals(cells), out = [];
    for (var d = 0; d <= 5; d++) {
      if (ctx.rest && ctx.rest[d]) continue;
      var date = addDays(ctx.week, d);
      var past = ctx.today ? date < ctx.today : false;
      if (d < 5 || v.on5L !== false) out.push({ dow: d, slot: "L", key: "m" + d + "L", date: date, past: past });
      var dinner = d === 5 ? v.on5D === true : !(ctx.pre && ctx.pre[d]);
      if (dinner) out.push({ dow: d, slot: "D", key: "m" + d + "D", date: date, past: past });
    }
    return out;
  }

  function resolve(ctx, cells, key) {
    var v = cellVals(cells);
    var m = /^m(\d)([LD])$/.exec(key); if (!m) return null;
    var dow = +m[1], slot = m[2], raw = v[key];
    var date = addDays(ctx.week, dow);
    var base = { key: key, dow: dow, slot: slot, date: date, past: ctx.today ? date < ctx.today : false, locked: !!(raw && raw.k), lo: false, meal: null, id: null };
    if (!raw) return base;
    if (raw.lo) {
      base.lo = true;
      var srcKey = "m" + (dow - 1) + "D", src = v[srcKey];
      if (src && src.id && MEALS[src.id]) { base.meal = MEALS[src.id]; base.id = src.id; base.srcKey = srcKey; }
      return base;
    }
    if (raw.id && MEALS[raw.id]) { base.meal = MEALS[raw.id]; base.id = raw.id; }
    return base;
  }

  /* ---------- family size: people per meal ---------- */
  // Cells srvB / srvL / srvD: how many people each meal is cooked for (default 1).
  function servingsOf(cells) {
    var v = cellVals(cells);
    function n(x) { x = Math.round(Number(x)); return isFinite(x) ? Math.max(1, Math.min(20, x)) : 1; }
    return { B: n(v.srvB), L: n(v.srvL), D: n(v.srvD) };
  }
  function peopleFor(srv, slot) { return slot === "L" ? srv.L : srv.D; }

  /* ---------- cooked: servings + eatings ---------- */
  function cooked(ctx, cells) {
    var srv = servingsOf(cells);
    var sl = slots(ctx, cells), eatings = [], servings = {}, bumped = [];
    sl.forEach(function (s) {
      var r = resolve(ctx, cells, s.key);
      if (!r || !r.meal) return;
      eatings.push({ key: s.key, dow: s.dow, slot: s.slot, date: s.date, past: s.past, lo: r.lo, meal: r.meal, mealId: r.meal.id, srcKey: r.srcKey || null, people: peopleFor(srv, s.slot) });
    });
    eatings.forEach(function (e) {
      if (e.past) return;
      if (e.lo) {
        var src = null;
        eatings.forEach(function (x) { if (x.key === e.srcKey) src = x; });
        if (src && !src.past) servings[e.mealId] = (servings[e.mealId] || 0) + e.people;
      } else {
        servings[e.mealId] = (servings[e.mealId] || 0) + e.people;
      }
    });
    Object.keys(servings).forEach(function (id) {
      var meal = MEALS[id];
      var isPot = (meal.prep || []).some(function (cid) { return COMP[cid] && COMP[cid].pot; });
      if (isPot && servings[id] < 2) { servings[id] = 2; bumped.push(id); }
    });
    return { servings: servings, eatings: eatings, bumped: bumped };
  }

  function breakfastPair(cells) {
    var v = cellVals(cells).bk;
    if (Array.isArray(v) && v.length === 2 && BK[v[0]] && BK[v[1]]) return v.slice();
    return PD.BREAKFAST_DEFAULT.slice();
  }
  function breakfastDays(ctx, cells) {
    var pair = breakfastPair(cells), out = [], idx = 0;
    for (var d = 0; d <= 5; d++) {
      if (ctx.rest && ctx.rest[d]) continue;
      var date = addDays(ctx.week, d);
      var id = pair[idx % 2]; idx++;
      out.push({ dow: d, date: date, bkId: id, bk: BK[id], past: ctx.today ? date < ctx.today : false });
    }
    return out;
  }

  /* ---------- generator ---------- */
  function shuffleArr(a, rand) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pickFrom(list, rand) { return list[Math.floor(rand() * list.length)]; }

  function candidates(P, slotLetter, used, longCount, relaxUsed, relaxLong) {
    return Object.keys(MEALS).map(function (id) { return MEALS[id]; }).filter(function (meal) {
      if (P.indexOf(meal.p) < 0) return false;
      if (meal.s.indexOf(slotLetter) < 0) return false;
      if (!relaxUsed && used[meal.id]) return false;
      if (!relaxLong && longCount >= 2 && meal.min >= 90) return false;
      return true;
    });
  }

  function generate(ctx, cells, rand) {
    rand = rand || Math.random;
    var v = cellVals(cells), out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k]; });
    var P = proteinsOf(cells);
    var sl = slots(ctx, cells);
    if (!P.length) return out;
    var rotation = shuffleArr(P.slice(), rand);
    var used = {}, longCount = 0, rotIdx = 0;
    // Locked slots are kept; their meals count as used.
    sl.forEach(function (s) {
      var raw = v[s.key];
      if (raw && raw.k) {
        var r = resolve(ctx, cells, s.key);
        if (r && r.meal) { used[r.meal.id] = true; if (r.meal.min >= 90) longCount++; }
      } else { delete out[s.key]; }
    });
    function prevDinnerProtein(dow) {
      for (var d = dow - 1; d >= 0; d--) {
        var cell = out["m" + d + "D"];
        if (cell && cell.id && MEALS[cell.id]) return MEALS[cell.id].p;
        if (cell && cell.lo) continue;
        // a dinner slot that exists in the slot list but is empty stops the scan only if it is a dinner day
        var has = sl.some(function (s) { return s.key === "m" + d + "D"; });
        if (has) return null;
      }
      return null;
    }
    function chooseMeal(slotLetter, proteinOrder, opts) {
      opts = opts || {};
      var relaxLevels = [[false, false], [true, false], [true, true]];
      for (var lvl = 0; lvl < relaxLevels.length; lvl++) {
        for (var pi = 0; pi < proteinOrder.length; pi++) {
          var p = proteinOrder[pi];
          var list = candidates([p], slotLetter, used, longCount, relaxLevels[lvl][0], relaxLevels[lvl][1]);
          if (opts.excludeTag) {
            var nonTag = list.filter(function (mm) { return mm.t !== opts.excludeTag; });
            if (opts.excludeTagHard || nonTag.length) list = nonTag;
          }
          if (opts.preferNotFresh) {
            var nf = list.filter(function (mm) { return !mm.fresh; });
            if (nf.length) list = nf;
          }
          if (list.length) return pickFrom(list, rand);
        }
      }
      return null;
    }
    // Dinners first, rotating proteins, skipping last night's protein.
    sl.filter(function (s) { return s.slot === "D"; }).forEach(function (s) {
      if (out[s.key]) return; // locked
      var prevP = prevDinnerProtein(s.dow);
      var order = [];
      for (var i = 0; i < rotation.length; i++) {
        var p = rotation[(rotIdx + i) % rotation.length];
        if (rotation.length > 1 && p === prevP) continue;
        order.push(p);
      }
      if (!order.length) order = rotation.slice();
      var meal = chooseMeal("D", order, {});
      if (meal) {
        out[s.key] = { id: meal.id };
        used[meal.id] = true;
        if (meal.min >= 90) longCount++;
        rotIdx = (rotation.indexOf(meal.p) + 1) % rotation.length;
      }
    });
    // Lunches next.
    var leftoverPlaced = false;
    sl.filter(function (s) { return s.slot === "L"; }).forEach(function (s) {
      if (out[s.key]) { var lr = resolve(ctx, out, s.key); if (lr && lr.lo) leftoverPlaced = true; return; }
      var d = s.dow;
      var tonight = out["m" + d + "D"], tonightMeal = tonight && tonight.id ? MEALS[tonight.id] : null;
      var prevD = d > 0 ? out["m" + (d - 1) + "D"] : null;
      var prevMeal = prevD && prevD.id ? MEALS[prevD.id] : null;
      var wantLo = v.lo !== false && d >= 1 && prevD && !prevD.lo && prevMeal && prevMeal.lo &&
        !(tonightMeal && tonightMeal.t === "D" && prevMeal.t === "M") &&
        (d % 2 === 1 || (!leftoverPlaced && d >= 2));
      if (wantLo) { out[s.key] = { lo: 1 }; leftoverPlaced = true; return; }
      var avoid = {};
      if (tonightMeal) avoid[tonightMeal.p] = true;
      if (prevMeal) avoid[prevMeal.p] = true;
      var order = rotation.filter(function (p) { return !avoid[p]; });
      if (!order.length) order = rotation.slice();
      // offset the lunch rotation from the dinners
      if (order.length > 1) { var sh = (rotIdx + d) % order.length; order = order.slice(sh).concat(order.slice(0, sh)); }
      var meal = chooseMeal("L", order, {
        excludeTag: tonightMeal && tonightMeal.t === "D" ? "M" : null,
        preferNotFresh: true
      });
      if (meal) { out[s.key] = { id: meal.id }; used[meal.id] = true; if (meal.min >= 90) longCount++; }
    });
    if (!out.bk) out.bk = PD.BREAKFAST_DEFAULT.slice();
    return out;
  }

  function pickLunchReplacement(ctx, out, dow, P, used, rand) {
    var tonight = out["m" + dow + "D"], tonightMeal = tonight && tonight.id ? MEALS[tonight.id] : null;
    var levels = [[false, false], [true, false], [true, true]];
    for (var lvl = 0; lvl < levels.length; lvl++) {
      var list = candidates(P, "L", used, 99, levels[lvl][0], levels[lvl][1]);
      if (tonightMeal) {
        var nonB = list.filter(function (mm) { return !pickerBlocked(mm.t, "L", tonightMeal.t); });
        if (nonB.length) list = nonB;
      }
      var nf = list.filter(function (mm) { return !mm.fresh; });
      if (nf.length) list = nf;
      if (list.length) return pickFrom(list, rand);
    }
    return null;
  }

  function shuffleOne(ctx, cells, key, rand) {
    rand = rand || Math.random;
    var v = cellVals(cells), out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k]; });
    var raw = v[key];
    if (!raw || raw.k) return out;
    var P = proteinsOf(cells); if (!P.length) return out;
    var cur = resolve(ctx, cells, key);
    var slotLetter = key.slice(-1);
    var used = {};
    slots(ctx, cells).forEach(function (s) {
      if (s.key === key) return;
      var r = resolve(ctx, cells, s.key);
      if (r && r.meal) used[r.meal.id] = true;
    });
    var all = candidates(P, slotLetter, {}, 99, true, true).filter(function (mm) { return !cur || !cur.meal || mm.id !== cur.meal.id; });
    if (slotLetter === "L") {
      var dnR = resolve(ctx, cells, "m" + key.charAt(1) + "D");
      var dnTag = dnR && dnR.meal ? dnR.meal.t : null;
      if (dnTag) {
        var okL = all.filter(function (mm) { return !pickerBlocked(mm.t, "L", dnTag); });
        if (okL.length) all = okL;
      }
    }
    var unused = all.filter(function (mm) { return !used[mm.id]; });
    var pool = unused.length ? unused : all;
    if (cur && cur.meal && P.length > 1) {
      var same = pool.filter(function (mm) { return mm.p === cur.meal.p; });
      var other = pool.filter(function (mm) { return mm.p !== cur.meal.p; });
      if (same.length && other.length) pool = rand() < 0.45 ? same : other;
      else if (same.length && rand() < 0.45) pool = same;
    }
    if (!pool.length) return out;
    var meal = pickFrom(pool, rand);
    out[key] = { id: meal.id };
    // Dinner shuffled: an unlocked leftover lunch tomorrow may need re-picking.
    if (slotLetter === "D") {
      var dow = +key.charAt(1), lk = "m" + (dow + 1) + "L", lv = out[lk];
      if (lv && lv.lo && !lv.k && !meal.lo) {
        var used2 = {};
        slots(ctx, out).forEach(function (s) { var r = resolve(ctx, out, s.key); if (r && r.meal) used2[r.meal.id] = true; });
        var rep = pickLunchReplacement(ctx, out, dow + 1, P, used2, rand);
        if (rep) out[lk] = { id: rep.id }; else delete out[lk];
      }
    }
    return out;
  }

  /* ---------- shopping ---------- */
  function shopping(ctx, cells) {
    var v = cellVals(cells);
    var ck = cooked(ctx, cells);
    var totals = {}, why = {}, fromStaple = {};
    function add(item, amt, name) {
      if (!ITEMS[item]) return;
      totals[item] = (totals[item] || 0) + amt;
      if (name) { why[item] = why[item] || []; if (why[item].indexOf(name) < 0) why[item].push(name); }
    }
    Object.keys(ck.servings).forEach(function (id) {
      var meal = MEALS[id], s = ck.servings[id];
      meal.ing.forEach(function (pair) { add(pair[0], pair[1] * s, meal.n); });
    });
    var srvS = servingsOf(cells);
    breakfastDays(ctx, cells).forEach(function (bd) {
      if (bd.past) return;
      bd.bk.ing.forEach(function (pair) { add(pair[0], pair[1] * srvS.B, bd.bk.n); });
    });
    var hidden = [];
    PD.STAPLES.forEach(function (pair) {
      var id = pair[0];
      if (v["h_" + id]) { hidden.push({ id: id, name: ITEMS[id] ? ITEMS[id][0] : id }); return; }
      fromStaple[id] = true;
      add(id, pair[1], null);
    });
    var sections = PD.SECTIONS.map(function (sec) {
      var lines = [];
      Object.keys(ITEMS).forEach(function (id) {
        if (ITEMS[id][1] !== sec[0] || !(id in totals)) return;
        var w = why[id] || [];
        var whyText = sec[0] === "pantry" ? "" : (w.slice(0, 2).join(", ") + (w.length > 2 ? " +" + (w.length - 2) : ""));
        lines.push({
          id: id, name: ITEMS[id][0], qty: qtyText(id, totals[id]), amount: totals[id],
          why: whyText, stapleOnly: !!fromStaple[id] && w.length === 0, staple: !!fromStaple[id],
          have: ITEMS[id][2] === "have"
        });
      });
      return { key: sec[0], name: sec[1], lines: lines };
    }).filter(function (sec) { return sec.lines.length || sec.key === "mine"; });
    var customs = [];
    Object.keys(v).forEach(function (k) {
      if (k.indexOf("c_") === 0 && v[k] && typeof v[k] === "object" && v[k].n) customs.push({ cell: k, id: k.slice(2), n: v[k].n, q: v[k].q || "", at: v[k].at || 0 });
    });
    customs.sort(function (a, b) { return a.at - b.at; });
    return { sections: sections, customs: customs, hidden: hidden, servings: srvS };
  }

  /* ---------- prep ---------- */
  function fridgeWindow(c) { return Math.min(c.k - 1, c.k >= 7 ? 6 : 3); }
  function fridgeOK(c, off) { return off <= fridgeWindow(c); }
  function amtOf(mealLike, itemId) {
    var total = 0;
    (mealLike.ing || []).forEach(function (pair) { if (pair[0] === itemId) total += pair[1]; });
    return total;
  }
  function amountText(c, amount) {
    if (amount == null || !c.u) return "";
    var whole = /egg|oz|pepper|cucumber|sweet potato|block/.test(c.u);
    var val = whole ? Math.max(1, Math.round(amount)) : Math.round(amount * 4) / 4;
    var txt = whole ? String(val) : frac(val);
    return txt + " " + c.u;
  }
  function keepText(c, frozenLater) {
    if (c.raw) return "raw: 1–2 days fridge, or freeze";
    if (frozenLater) return "fridge ≤" + (fridgeWindow(c) + 1) + " days · freeze the later portions";
    return "fridge " + c.k + " days";
  }

  function prep(ctx, cells, prepDaySetting) {
    var v = cellVals(cells);
    var savedDay = (typeof prepDaySetting === "number" && prepDaySetting >= 0 && prepDaySetting <= 5) ? prepDaySetting : 0;
    var eff = savedDay, note = "";
    if (ctx.rest && ctx.rest[eff]) {
      var orig = eff, guard = 0;
      do { eff = (eff + 1) % 6; guard++; } while (ctx.rest[eff] && guard < 6);
      note = DAYN[orig] + " is " + ctx.rest[orig] + " this week, so " + DAYN[eff] + " stands in.";
    }
    // Current week and the prep day already passed: start today.
    if (ctx.today && ctx.today >= ctx.week && ctx.today <= addDays(ctx.week, 6)) {
      var td = dowOf(ctx.today);
      if (td >= 0 && td <= 5 && td > eff) {
        note = DAYN[eff] + " already passed this week, so this is what's left to prep from today. Next week starts on " + DAYN[eff] + " again.";
        eff = td;
      }
    }
    var prepDate = addDays(ctx.week, eff);
    var ck = cooked(ctx, cells);
    var before = [], portions = [], cookFresh = [], thawMap = [];
    var batch = {};   // compId -> {amount, feeds:[], frozenLater:bool}
    var mid = {};      // compId -> {amount, feeds:[]}
    function feed(map, cid, mealLike, name, factor) {
      var c = COMP[cid]; if (!c) return;
      var e = map[cid] || (map[cid] = { amount: c.sz ? 0 : null, feeds: [] });
      if (c.sz) e.amount += amtOf(mealLike, c.sz) * (factor || 1);
      if (e.feeds.indexOf(name) < 0) e.feeds.push(name);
    }
    function classify(eating, mealLike, name, factor) {
      var off = eating.dow - eff;
      var comps = mealLike.prep || [];
      var allOK = true, freezableCover = true, anyFrozen = false;
      comps.forEach(function (cid) {
        var c = COMP[cid]; if (!c) return;
        if (!fridgeOK(c, off)) { allOK = false; if (c.z) anyFrozen = true; else freezableCover = false; }
      });
      comps.forEach(function (cid) {
        var c = COMP[cid]; if (!c) return;
        if (fridgeOK(c, off) || c.z) { feed(batch, cid, mealLike, name, factor); if (!fridgeOK(c, off)) batch[cid].frozenLater = true; }
        else feed(mid, cid, mealLike, name, factor);
      });
      return { allOK: allOK, anyFrozen: anyFrozen, freezableCover: freezableCover };
    }
    ck.eatings.forEach(function (e) {
      var label = (e.slot === "L" ? "Lunch" : "Dinner");
      if (e.date < prepDate) {
        before.push({ key: e.key, dow: e.dow, slot: e.slot, date: e.date, name: e.lo ? "Leftovers: " + e.meal.n : e.meal.n, lo: e.lo });
        return;
      }
      if (e.lo) {
        // The portion was packed from the source dinner's batch; still list it as a fridge portion.
        portions.push({ key: e.key, tick: "p" + e.key, dow: e.dow, slot: e.slot, date: e.date, name: "Leftovers: " + e.meal.n, where: "fridge", lo: true, people: e.people });
        return;
      }
      if (e.meal.fresh) {
        var r = classify(e, e.meal, e.meal.n, e.people);
        cookFresh.push({ key: e.key, dow: e.dow, slot: e.slot, date: e.date, name: e.meal.n, freezerPart: r.anyFrozen, people: e.people });
        if (r.anyFrozen) thawMap.push({ dow: e.dow, text: "Move " + DAYN[e.dow] + " " + label.toLowerCase() + " (" + e.meal.n + ") to the fridge" });
        return;
      }
      var r2 = classify(e, e.meal, e.meal.n, e.people);
      var where = r2.allOK ? "fridge" : (r2.freezableCover ? "freezer" : "midweek");
      portions.push({ key: e.key, tick: "p" + e.key, dow: e.dow, slot: e.slot, date: e.date, name: e.meal.n, where: where, people: e.people });
      if (where === "freezer") thawMap.push({ dow: e.dow, text: "Move " + DAYN[e.dow] + " " + label.toLowerCase() + " (" + e.meal.n + ") to the fridge" });
    });
    // Extra freezer portions from pot bumps.
    ck.bumped.forEach(function (id) {
      var has = ck.eatings.some(function (e) { return e.mealId === id && !e.lo; });
      if (!has) return;
      var first = ck.eatings.filter(function (e) { return e.mealId === id && !e.lo; })[0];
      portions.push({ key: first.key + "x", tick: "p" + first.key + "x", dow: first.dow, slot: first.slot, date: first.date, name: MEALS[id].n + " (extra)", where: "freezer", extra: true, people: 1 });
    });
    // Breakfast components for breakfast days on/after the prep day.
    var bkByComp = {};
    breakfastDays(ctx, cells).forEach(function (bd) {
      if (bd.date < prepDate) return;
      (bd.bk.prep || []).forEach(function (cid) {
        var c = COMP[cid]; if (!c) return;
        var e = bkByComp[cid] || (bkByComp[cid] = { offs: [], meals: [] });
        e.offs.push(bd.dow - eff);
        e.meals.push({ bk: bd.bk, off: bd.dow - eff });
      });
    });
    Object.keys(bkByComp).forEach(function (cid) {
      var c = COMP[cid], info = bkByComp[cid];
      var maxOff = Math.max.apply(null, info.offs);
      var srvBk = servingsOf(cells).B;
      info.meals.forEach(function (mm) {
        if (fridgeOK(c, maxOff) || c.z) { feed(batch, cid, mm.bk, mm.bk.n, srvBk); if (!fridgeOK(c, maxOff)) batch[cid].frozenLater = true; }
        else feed(mid, cid, mm.bk, mm.bk.n, srvBk);
      });
    });
    // Timeline.
    var batchIds = Object.keys(batch).sort(function (a, b) { return (COMP[a].o - COMP[b].o) || (a < b ? -1 : 1); });
    var anyOv = batchIds.some(function (cid) { return COMP[cid].ov; });
    var steps = [];
    steps.push({
      tick: "setup", id: "setup", title: anyOv ? "Oven to 425°F, pans out" : "Set up",
      how: "Line sheet pans. Meat pans, boards and containers for meat; a pareve pot for rice, veg and eggs so they go with any meal.",
      start: 0, finish: 5, a: 5, t: 5, amount: "", feeds: [], keep: "", meat: false
    });
    var cursor = 5, latestFinish = 5;
    batchIds.forEach(function (cid) {
      var c = COMP[cid], b = batch[cid];
      var start = cursor; cursor += c.a;
      var finish = start + c.t;
      if (finish > latestFinish) latestFinish = finish;
      steps.push({
        tick: cid, id: cid, title: c.n, how: c.h, start: start, finish: finish, a: c.a, t: c.t,
        amount: amountText(c, b.amount), feeds: b.feeds.slice(), keep: keepText(c, !!b.frozenLater),
        meat: !!c.meat, ready: finish > 15 ? clock(finish) : ""
      });
    });
    var containers = portions.reduce(function (n2, p2) { return n2 + (p2.people || 1); }, 0);
    var packDur = Math.min(20, 8 + containers);
    var total = 0;
    if (batchIds.length) {
      steps.push({
        tick: "pack", id: "pack", title: "Cool, portion, label", how: "Cool, portion into containers and label each one M / D / P with the day it is for.",
        start: latestFinish, finish: latestFinish + packDur, a: packDur, t: packDur, amount: "", feeds: [], keep: "", meat: false
      });
      total = latestFinish + packDur;
    }
    var midDay = Math.min(5, eff + 3);
    var midTasks = Object.keys(mid).sort(function (a, b) { return (COMP[a].o - COMP[b].o) || (a < b ? -1 : 1); }).map(function (cid) {
      var c = COMP[cid], mm = mid[cid];
      return { tick: "mid_" + cid, id: cid, title: c.n, how: c.h, amount: amountText(c, mm.amount), feeds: mm.feeds.slice(), a: c.a, meat: !!c.meat };
    });
    var midTotal = midTasks.reduce(function (s2, t2) { return s2 + t2.a; }, 0);
    var thaws = thawMap.map(function (t2, i) { return { tick: "mv" + t2.dow + "_" + i, dow: t2.dow, text: t2.text }; });
    return {
      servings: servingsOf(cells),
      savedDay: savedDay, prepDay: eff, prepDate: prepDate, note: note,
      steps: batchIds.length ? steps : [],
      empty: batchIds.length === 0,
      total: total, durText: dur(total), containers: containers,
      long: total > 125,
      before: before,
      fridge: portions.filter(function (p) { return p.where === "fridge"; }),
      freezer: portions.filter(function (p) { return p.where === "freezer"; }),
      midweekPortions: portions.filter(function (p) { return p.where === "midweek"; }),
      cookFresh: cookFresh,
      midweek: { day: midDay, date: addDays(ctx.week, midDay), tasks: midTasks, total: midTotal, durText: dur(midTotal), thaws: thaws },
      eatBy: addDays(prepDate, 3) <= addDays(ctx.week, 5) ? addDays(prepDate, 3) : addDays(ctx.week, 5)
    };
  }

  root.PLAN_ENGINE = {
    slots: slots, resolve: resolve, generate: generate, shuffleOne: shuffleOne,
    cooked: cooked, breakfastDays: breakfastDays, breakfastPair: breakfastPair,
    shopping: shopping, prep: prep, qtyText: qtyText, frac: frac, dur: dur, clock: clock,
    proteinsOf: proteinsOf, servingsOf: servingsOf, addDays: addDays, dowOf: dowOf, cellVals: cellVals,
    DAYN: DAYN, DAY3: DAY3
  };
})(typeof window !== "undefined" ? window : globalThis);
