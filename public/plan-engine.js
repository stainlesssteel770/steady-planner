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
      /* Bug-fix batch item 11: Tisha B'Av has no meal slots at all; a minor
         fast day has no lunch slot (its dinner is the break-fast). Erev Yom
         Kippur keeps a dinner slot despite being pre-rest — that dinner is
         the pre-fast meal. */
      if (ctx.tisha && ctx.tisha[d]) continue;
      var date = addDays(ctx.week, d);
      var past = ctx.today ? date < ctx.today : false;
      if (!(ctx.fast && ctx.fast[d]) && (d < 5 || v.on5L !== false)) out.push({ dow: d, slot: "L", key: "m" + d + "L", date: date, past: past });
      var dinner = d === 5 ? v.on5D === true : !(ctx.pre && ctx.pre[d]) || !!(ctx.erevYK && ctx.erevYK[d]);
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

  /* v28a item 1: protein -> breakfast ingredient items, for exclusions.
     Only eggs and yogurt appear in breakfasts today (as the eggs item and
     the greekyog/cottage items); other proteins map to nothing. */
  var BK_PROTEIN_ITEMS = { eggs: ["eggs"], yogurt: ["greekyog", "cottage"] };
  function breakfastExcluded(bkId, excl) {
    if (!excl) return false;
    var bk = BK[bkId];
    if (!bk || !bk.ing) return false;
    return bk.ing.some(function (pair) {
      return Object.keys(excl).some(function (pid) {
        return excl[pid] && (BK_PROTEIN_ITEMS[pid] || []).indexOf(pair[0]) >= 0;
      });
    });
  }
  function breakfastPair(cells) {
    var v = cellVals(cells).bk;
    if (Array.isArray(v) && v.length === 2 && BK[v[0]] && BK[v[1]]) return v.slice();
    if (Array.isArray(v) && v.length === 0) return [];
    return PD.BREAKFAST_DEFAULT.slice();
  }
  function breakfastDays(ctx, cells) {
    var pair = breakfastPair(cells), out = [], idx = 0;
    if (!pair.length) return out;
    for (var d = 0; d <= 5; d++) {
      if (ctx.rest && ctx.rest[d]) continue;
      /* Bug-fix batch item 11: no breakfast is planned on a fast day. */
      if ((ctx.fast && ctx.fast[d]) || (ctx.tisha && ctx.tisha[d])) continue;
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

  /* Batch 4 item 5: "long" means long HANDS-ON prep (Mark's definition,
     replacing the spec's total-time rule): the sum of the meal's prep
     components' hands-on minutes (COMP a). A pot that simmers for hours
     after 15 minutes of prep is not long. The threshold is the plan's
     longMin cell (default 30); the weekly cap stays 2. */
  function handsOn(meal) {
    var t = 0, prep = meal.prep || [];
    for (var i = 0; i < prep.length; i++) { var c = COMP[prep[i]]; if (c && c.a) t += c.a; }
    return t;
  }
  function longMinOf(cells) {
    var n = cellVals(cells).longMin;
    return (typeof n === "number" && isFinite(n)) ? Math.max(5, Math.min(120, Math.round(n))) : 30;
  }

  function candidates(P, slotLetter, used, longCount, relaxUsed, relaxLong, longMin) {
    return Object.keys(MEALS).map(function (id) { return MEALS[id]; }).filter(function (meal) {
      if (P.indexOf(meal.p) < 0) return false;
      if (meal.s.indexOf(slotLetter) < 0) return false;
      if (!relaxUsed && used[meal.id]) return false;
      if (!relaxLong && longCount >= 2 && handsOn(meal) >= (longMin == null ? 30 : longMin)) return false;
      return true;
    });
  }

  function generate(ctx, cells, rand) {
    rand = rand || Math.random;
    var v = cellVals(cells), out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k]; });
    var P = proteinsOf(cells);
    /* v28a item 1: Settings exclusions shrink the pool — a stale saved week
       cannot regenerate an excluded protein, even if it is still picked. */
    if (ctx && ctx.excl) P = P.filter(function (id) { return !ctx.excl[id]; });
    var sl = slots(ctx, cells);
    if (!P.length) return out;
    var rotation = shuffleArr(P.slice(), rand);
    var used = {}, longCount = 0, rotIdx = 0;
    var longMinG = longMinOf(cells);
    // Locked slots are kept; their meals count as used.
    sl.forEach(function (s) {
      /* Beta batch 1 item 3: past days are history. Their cells pass
         through untouched — never re-rolled, never refilled — so a
         leftovers lunch can only ever point at a dinner that was really
         in the saved plan, and prep/shopping stay about shown days. */
      if (s.past) {
        /* Beta batch 2 item 6: past meals still count for variety — a
           meal eaten Sun–Tue is "used" (and a long one spends the weekly
           long-meal cap), so mid-week picks avoid repeating it. Only the
           counting happens here; the cells pass through as before. */
        var rp = resolve(ctx, cells, s.key);
        if (rp && rp.meal) { used[rp.meal.id] = true; if (!rp.lo && handsOn(rp.meal) >= longMinG) longCount++; }
        return;
      }
      var raw = v[s.key];
      if (raw && raw.k) {
        var r = resolve(ctx, cells, s.key);
        if (r && r.meal) { used[r.meal.id] = true; if (!r.lo && handsOn(r.meal) >= longMinG) longCount++; }
      } else { delete out[s.key]; }
    });
    /* Bug-fix batch item 4: slots() yields nothing on a rest day, so the seed
       pass above never touches its cells — an unlocked leftover lunch there
       is orphaned: invisible to slots/prep/shopping, but kept in the plan,
       and it resurrects as a stale "Leftovers:" card if the day is later
       un-marked. Drop it here, like every other unlocked cell. (Locked cells
       and non-leftover cells are the user's pins and stay.) */
    if (ctx.rest) {
      for (var rd = 0; rd <= 5; rd++) {
        if (!ctx.rest[rd]) continue;
        var lk4 = "m" + rd + "L", lv4 = v[lk4];
        if (lv4 && lv4.lo && !lv4.k) delete out[lk4];
      }
    }
    /* Bug-fix batch item 11: same orphan class on fast days — slots() yields
       no lunch there (and nothing at all on Tisha B'Av), so unlocked cells
       on those days are dropped too. Locked cells stay. */
    for (var fd = 0; fd <= 5; fd++) {
      var fl = v["m" + fd + "L"];
      if (ctx.fast && ctx.fast[fd] && fl && !fl.k) delete out["m" + fd + "L"];
      if (ctx.tisha && ctx.tisha[fd]) {
        if (fl && !fl.k) delete out["m" + fd + "L"];
        var fdn = v["m" + fd + "D"];
        if (fdn && !fdn.k) delete out["m" + fd + "D"];
      }
    }
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
      var relaxLevels = opts.levels || [[false, false], [true, false], [true, true]];
      for (var lvl = 0; lvl < relaxLevels.length; lvl++) {
        for (var pi = 0; pi < proteinOrder.length; pi++) {
          var p = proteinOrder[pi];
          var list = candidates([p], slotLetter, used, longCount, relaxLevels[lvl][0], relaxLevels[lvl][1], longMinG);
          if (opts.excludeTag) {
            /* Bug-fix batch item 11: excludeTag may be a list (a day can carry
               two hard exclusions at once, e.g. fast-day no-meat plus the
               locked-lunch dairy block). */
            var exT = [].concat(opts.excludeTag);
            var nonTag = list.filter(function (mm) { return exT.indexOf(mm.t) < 0; });
            if (opts.excludeTagHard || nonTag.length) list = nonTag;
          }
          if (opts.preferNotFresh) {
            var nf = list.filter(function (mm) { return !mm.fresh; });
            if (nf.length) list = nf;
          }
          /* Bug-fix batch item 11: light/hearty preference, same
             filter-with-fallback shape as preferNotFresh. */
          if (opts.preferLight) {
            var lt = list.filter(function (mm) { return mm.light; });
            if (lt.length) list = lt;
          }
          if (opts.preferHearty) {
            var hv = list.filter(function (mm) { return !mm.light; });
            if (hv.length) list = hv;
          }
          if (list.length) return pickFrom(list, rand);
        }
      }
      return null;
    }
    // Dinners first, rotating proteins, skipping last night's protein.
    /* Bug-fix batch item 1: the mdGap plan toggle ("meat lunch OK before a
       dairy dinner — dinner is 6+ hours later") lifts the meat-before-dairy
       day rule everywhere in the generator, dinner pass included. Off
       (default) = v21 behavior. Declared here so the dinner pass can use it. */
    var mdGapOn = v.mdGap === true;
    sl.filter(function (s) { return s.slot === "D"; }).forEach(function (s) {
      if (s.past || out[s.key]) return; // locked (or history)
      var prevP = prevDinnerProtein(s.dow);
      var order = [];
      for (var i = 0; i < rotation.length; i++) {
        var p = rotation[(rotIdx + i) % rotation.length];
        if (rotation.length > 1 && p === prevP) continue;
        order.push(p);
      }
      if (!order.length) order = rotation.slice();
      /* Bug-fix batch item 1: a locked meat lunch constrains the dinner pass.
         "Shuffle all unlocked" runs dinners first with no constraint, so a
         locked meat lunch could end up under a dairy dinner (~1/4 of rebuilds).
         Apply the same hard pickerBlocked exclusion shuffleOne uses for the
         dinner slot (lifted by the mdGap toggle, like everywhere else). */
      var dopts = {};
      var luR = resolve(ctx, out, "m" + s.dow + "L");
      if (luR && luR.locked && luR.meal && !mdGapOn && pickerBlocked("D", "D", luR.meal.t)) {
        dopts = { excludeTag: "D", excludeTagHard: true };
      }
      /* Bug-fix batch item 11: day rules compose into the same options.
         Minor fast: the break-fast dinner is never meat, light preferred.
         Nine Days: no meat. Erev Yom Kippur: the pre-fast dinner prefers
         hearty (non-light) meals. */
      var exD = dopts.excludeTag ? [].concat(dopts.excludeTag) : [];
      if ((ctx.fast && ctx.fast[s.dow]) || (ctx.nine && ctx.nine[s.dow])) {
        if (exD.indexOf("M") < 0) exD.push("M");
        dopts.excludeTagHard = true;
      }
      if (exD.length) dopts.excludeTag = exD;
      if (ctx.fast && ctx.fast[s.dow]) dopts.preferLight = true;
      if (ctx.erevYK && ctx.erevYK[s.dow]) dopts.preferHearty = true;
      var meal = chooseMeal("D", order, dopts);
      if (meal) {
        out[s.key] = { id: meal.id };
        used[meal.id] = true;
        if (handsOn(meal) >= longMinG) longCount++;
        rotIdx = (rotation.indexOf(meal.p) + 1) % rotation.length;
      }
    });
    // Lunches next.
    var leftoverPlaced = false;
    /* (mdGapOn is declared above the dinner pass; the lunch loop reuses it.) */
    sl.filter(function (s) { return s.slot === "L"; }).forEach(function (s) {
      if (s.past) {
        /* Beta batch 2 item 6: past meals still count for variety — a
           meal eaten Sun–Tue is "used" (and a long one spends the weekly
           long-meal cap), so mid-week picks avoid repeating it. Only the
           counting happens here; the cells pass through as before. */
        var rp = resolve(ctx, cells, s.key);
        /* Item 5: used-marking only — the seed pass owns long counting
           (a past lunch counted here too was the double-spend), and a
           leftover lunch never spends the budget at all. */
        if (rp && rp.meal) { used[rp.meal.id] = true; }
        return;
      } // history (item 3)
      if (out[s.key]) { var lr = resolve(ctx, out, s.key); if (lr && lr.lo) leftoverPlaced = true; return; }
      var d = s.dow;
      var tonight = out["m" + d + "D"], tonightMeal = tonight && tonight.id ? MEALS[tonight.id] : null;
      var prevD = d > 0 ? out["m" + (d - 1) + "D"] : null;
      var prevMeal = prevD && prevD.id ? MEALS[prevD.id] : null;
      var wantLo = v.lo !== false && d >= 1 && prevD && !prevD.lo && prevMeal && prevMeal.lo &&
        !(tonightMeal && tonightMeal.t === "D" && prevMeal.t === "M" && !mdGapOn) &&
        /* Bug-fix batch item 11: no meat leftovers inside the Nine Days. */
        !(ctx.nine && ctx.nine[d] && prevMeal.t === "M") &&
        (d % 2 === 1 || (!leftoverPlaced && d >= 2));
      if (wantLo) { out[s.key] = { lo: 1 }; leftoverPlaced = true; return; }
      var avoid = {};
      if (tonightMeal) avoid[tonightMeal.p] = true;
      if (prevMeal) avoid[prevMeal.p] = true;
      var order = rotation.filter(function (p) { return !avoid[p]; });
      if (!order.length) order = rotation.slice();
      // offset the lunch rotation from the dinners
      if (order.length > 1) { var sh = (rotIdx + d) % order.length; order = order.slice(sh).concat(order.slice(0, sh)); }
      var dairyDinner = !!(tonightMeal && tonightMeal.t === "D") && !mdGapOn;
      var lopts = {
        excludeTag: dairyDinner ? "M" : null,
        excludeTagHard: dairyDinner,
        preferNotFresh: true
      };
      /* Bug-fix batch item 11: inside the Nine Days a lunch is never meat
         either (hard, like the dinner rule). */
      if (ctx.nine && ctx.nine[d]) { lopts.excludeTag = "M"; lopts.excludeTagHard = true; }
      /* Beta batch 3 item 1: widen BEFORE repeating. The avoid-filtered
         order can be thin (salmon has 2 lunches); when all its lunches are
         used, the old code relaxed straight to a repeat without retrying
         the dropped dinner proteins. Now: (a) avoid-filtered order,
         strict (unused, cap-passing only); (b1) add back last night's
         dinner protein; (b2) add back tonight's; (c) only then relax to
         repeats across the full rotation. */
      var strict = { levels: [[false, false]] };
      var meal = chooseMeal("L", order, Object.assign({}, lopts, strict));
      /* Beta batch 4 item 1: the widen steps only ever add proteins that are
         chosen (members of `rotation`). A locked dinner from a deselected
         protein (e.g. yogurt dinners locked, then yogurt deselected) must
         not pull that protein's lunches back into the rotation. */
      if (!meal && prevMeal && order.indexOf(prevMeal.p) < 0 &&
          rotation.indexOf(prevMeal.p) >= 0) {
        meal = chooseMeal("L", order.concat([prevMeal.p]), Object.assign({}, lopts, strict));
      }
      if (!meal && tonightMeal && order.indexOf(tonightMeal.p) < 0 &&
          rotation.indexOf(tonightMeal.p) >= 0 &&
          (!prevMeal || tonightMeal.p !== prevMeal.p)) {
        var wider = order.slice();
        if (prevMeal && wider.indexOf(prevMeal.p) < 0 &&
            rotation.indexOf(prevMeal.p) >= 0) wider.push(prevMeal.p);
        wider.push(tonightMeal.p);
        meal = chooseMeal("L", wider, Object.assign({}, lopts, strict));
      }
      if (!meal) {
        // No unused rule-passing lunch anywhere: relax to repeats across
        // every chosen protein. The hard meat/dairy day rule always holds —
        // if nothing passes it (e.g. tonight's dinner was locked dairy while
        // the dairy protein is no longer selected), the lunch cell stays
        // empty, as on v20. A repeat is allowed only where an unused lunch
        // existed that passes the hard rules (the batch-3 definition).
        meal = chooseMeal("L", rotation, lopts);
      }
      if (meal) { out[s.key] = { id: meal.id }; used[meal.id] = true; if (handsOn(meal) >= longMinG) longCount++; }
    });
    if (!out.bk) {
      /* v28a item 1 (ruling A1): the default breakfast pair respects
         exclusions too — filtered defaults, refilled from the remaining
         breakfasts in order; empty when fewer than 2 remain. */
      var bkAvail = Object.keys(BK).filter(function (id) { return !breakfastExcluded(id, ctx && ctx.excl); });
      var bkPair = PD.BREAKFAST_DEFAULT.filter(function (id) { return bkAvail.indexOf(id) >= 0; });
      bkAvail.forEach(function (id) { if (bkPair.length < 2 && bkPair.indexOf(id) < 0) bkPair.push(id); });
      out.bk = bkPair.length >= 2 ? bkPair : [];
    }
    return out;
  }

  function pickLunchReplacement(ctx, out, dow, P, used, rand) {
    var tonight = out["m" + dow + "D"], tonightMeal = tonight && tonight.id ? MEALS[tonight.id] : null;
    var levels = [[false, false], [true, false], [true, true]];
    for (var lvl = 0; lvl < levels.length; lvl++) {
      var list = candidates(P, "L", used, 99, levels[lvl][0], levels[lvl][1], longMinOf(out));
      if (tonightMeal && cellVals(out).mdGap !== true) {
        var nonB = list.filter(function (mm) { return !pickerBlocked(mm.t, "L", tonightMeal.t); });
        if (nonB.length) list = nonB;
      }
      /* Bug-fix batch item 11: a replacement lunch inside the Nine Days is
         never meat (hard — an empty pool just leaves the cell empty). */
      if (ctx.nine && ctx.nine[dow]) {
        list = list.filter(function (mm) { return mm.t !== "M"; });
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
    var P = proteinsOf(cells);
    /* v28a item 1: same exclusion filter as generate(). */
    if (ctx && ctx.excl) P = P.filter(function (id) { return !ctx.excl[id]; });
    if (!P.length) return out;
    var cur = resolve(ctx, cells, key);
    var slotLetter = key.slice(-1);
    var used = {};
    slots(ctx, cells).forEach(function (s) {
      if (s.key === key) return;
      var r = resolve(ctx, cells, s.key);
      if (r && r.meal) used[r.meal.id] = true;
    });
    var all = candidates(P, slotLetter, {}, 99, true, true, longMinOf(cells)).filter(function (mm) { return !cur || !cur.meal || mm.id !== cur.meal.id; });
    /* Batch 4 item 1: HARD same-day meat/dairy filters — a candidate the
       picker would hide is never served by the dice, in either slot. If a
       filter empties the pool, the current meal stays and the caller is
       told via out.__noFit (not a cell key; never persisted). */
    var noFit = false;
    var mdGapS = v.mdGap === true;
    if (slotLetter === "L" && !mdGapS) {
      var dnR = resolve(ctx, cells, "m" + key.charAt(1) + "D");
      var dnTag = dnR && dnR.meal ? dnR.meal.t : null;
      if (dnTag) {
        var okL = all.filter(function (mm) { return !pickerBlocked(mm.t, "L", dnTag); });
        if (!okL.length && all.length) noFit = true;
        all = okL;
      }
    }
    if (slotLetter === "D" && !mdGapS) {
      var luR = resolve(ctx, cells, "m" + key.charAt(1) + "L");
      var luTag = luR && luR.meal ? luR.meal.t : null;
      if (luTag) {
        var okD = all.filter(function (mm) { return !pickerBlocked(mm.t, "D", luTag); });
        if (!okD.length && all.length) noFit = true;
        all = okD;
      }
    }
    /* Bug-fix batch item 11: the same day rules as generate() — no meat in
       the Nine Days, a fast day's break-fast dinner is never meat and
       prefers light, the Erev Yom Kippur dinner prefers hearty. */
    var dowS = +key.charAt(1);
    if ((ctx.nine && ctx.nine[dowS]) || (slotLetter === "D" && ctx.fast && ctx.fast[dowS])) {
      var okN = all.filter(function (mm) { return mm.t !== "M"; });
      if (!okN.length && all.length) noFit = true;
      all = okN;
    }
    if (slotLetter === "D" && ctx.fast && ctx.fast[dowS]) {
      var ltS = all.filter(function (mm) { return mm.light; });
      if (ltS.length) all = ltS;
    }
    if (slotLetter === "D" && ctx.erevYK && ctx.erevYK[dowS]) {
      var hvS = all.filter(function (mm) { return !mm.light; });
      if (hvS.length) all = hvS;
    }
    var unused = all.filter(function (mm) { return !used[mm.id]; });
    var pool = unused.length ? unused : all;
    if (cur && cur.meal && P.length > 1) {
      var same = pool.filter(function (mm) { return mm.p === cur.meal.p; });
      var other = pool.filter(function (mm) { return mm.p !== cur.meal.p; });
      if (same.length && other.length) pool = rand() < 0.45 ? same : other;
      else if (same.length && rand() < 0.45) pool = same;
    }
    if (!pool.length) { if (noFit) out.__noFit = true; return out; }
    var meal = pickFrom(pool, rand);
    out[key] = { id: meal.id };
    // Dinner shuffled: an unlocked leftover lunch may need re-picking.
    if (slotLetter === "D") {
      var dow = +key.charAt(1);
      var repick = function (lk2, day2) {
        var used2 = {};
        slots(ctx, out).forEach(function (s) { var r = resolve(ctx, out, s.key); if (r && r.meal) used2[r.meal.id] = true; });
        var rep = pickLunchReplacement(ctx, out, day2, P, used2, rand);
        if (rep) out[lk2] = { id: rep.id }; else delete out[lk2];
      };
      // Tomorrow's lunch is this dinner's leftovers: re-pick when the new
      // dinner makes no leftovers, or its leftovers are blocked by the
      // lunch day's own dinner (same rule as afterDinnerPick).
      var lk = "m" + (dow + 1) + "L", lv = out[lk];
      if (lv && lv.lo && !lv.k) {
        var tdR = resolve(ctx, out, "m" + (dow + 1) + "D");
        var tdTag = tdR && tdR.meal ? tdR.meal.t : null;
        if (!meal.lo || (!mdGapS && pickerBlocked(meal.t, "L", tdTag))) repick(lk, dow + 1);
      }
      // Today's lunch is yesterday's leftovers (its source dinner is
      // untouched) but it is eaten before this dinner: re-pick when the
      // new dinner blocks it.
      var sk = "m" + dow + "L", sv = out[sk];
      if (sv && sv.lo && !sv.k) {
        var slR = resolve(ctx, out, sk);
        if (slR && slR.meal && !mdGapS && pickerBlocked(slR.meal.t, "L", meal.t)) repick(sk, dow);
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
    var u = c.u;
    /* Bug-fix batch item 7: units are stored plural, but an amount of 1 or
       less takes the singular ("1 cucumbers" / "¼ cups dry" read wrong).
       "sweet potatoes" is the one unit whose plural sits on the last word. */
    if (val <= 1) {
      if (u.indexOf("sweet potatoes") === 0) u = "sweet potato" + u.slice("sweet potatoes".length);
      else u = u.replace(/^\S+/, function (w) { return /s$/.test(w) ? w.slice(0, -1) : w; });
    }
    return txt + " " + u;
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
      if (e.past) return; // Beta batch 1 item 3: prep lists only days shown in Week
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
      var has = ck.eatings.some(function (e) { return e.mealId === id && !e.lo && !e.past; });
      if (!has) return;
      var first = ck.eatings.filter(function (e) { return e.mealId === id && !e.lo && !e.past; })[0];
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
    /* Bug-fix batch item 2: the midweek top-up is an evening cooking session —
       never land it on a Yom Tov. Walk to the nearest non-Yom-Tov evening
       (ctx.yomtov, built by planCtx from calendar.json), earlier-evening-first
       — a top-up cooks ahead of the Yom Tov — with ties going earlier. */
    var yt2 = ctx.yomtov || {};
    if (yt2[addDays(ctx.week, midDay)]) {
      var bestD = -1, bestDist = 99;
      for (var wd = 0; wd <= 5; wd++) {
        if (yt2[addDays(ctx.week, wd)]) continue;
        var wdist = Math.abs(wd - midDay);
        if (wdist < bestDist || (wdist === bestDist && wd < bestD)) { bestD = wd; bestDist = wdist; }
      }
      if (bestD >= 0) midDay = bestD;
    }
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
    breakfastExcluded: breakfastExcluded,
    shopping: shopping, prep: prep, qtyText: qtyText, frac: frac, dur: dur, clock: clock,
    proteinsOf: proteinsOf, servingsOf: servingsOf, addDays: addDays, dowOf: dowOf, cellVals: cellVals,
    handsOn: handsOn, longMinOf: longMinOf,
    DAYN: DAYN, DAY3: DAY3
  };
})(typeof window !== "undefined" ? window : globalThis);
