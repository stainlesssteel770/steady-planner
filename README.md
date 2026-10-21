# Steady — habits & meal planner

A personal, single-user habits tracker and weekly meal planner. Installable phone web app (PWA) with four tabs: **Today · Workout · Plan · Meals**.

**Live site:** https://stainlesssteel770.github.io/steady-planner/

## This version: simple, personal, GitHub Pages only

This is the personal-use build. It is a completely static site hosted on GitHub Pages — there is no server, no account, no login and no sync.

- **Your data never leaves your phone.** Habits, check-ins, settings and meal plans are stored only in your browser's local storage on that device. Nothing is uploaded anywhere. Anyone opening the link just sees their own empty tracker on their own device.
- **Works offline** after the first load (service worker), and can be added to the home screen: Chrome menu ⋮ → *Add to Home screen*.
- **Backup:** Settings → *Download backup* saves a JSON file of all your data. Settings → *Restore from backup* loads it again — use this when switching phones.

## What's in it

- **Today:** 10 daily habits with a score (out of 10, or out of 6 on Fridays / erev Yom Tov — evening habits aren't counted then), week dots, streak, steps goal, weekly weight/waist check-in with trend.
- **Rest days:** Shabbos and Yom Tov (diaspora list, through Oct 2028) aren't tracked. Any day can be manually marked as a rest day, or a calendar rest day marked "track anyway", in Settings.
- **Workout:** 20-minute home routine, 5 moves, 3–4 rounds, rest timer, rep progression levels.
- **Plan:** pick 2–4 proteins and it builds the week (Sun–Fri; Shabbos and Yom Tov are not planned), with leftovers, a generated shopping list grouped by store section, and a prep-day timeline with fridge/freezer plan. All meals carry kosher tags (meat / dairy / pareve / fish) and the generator keeps meat lunches off dairy-dinner days.
- **Meals:** day-plan ideas, kosher notes, Shabbos tips.

The day rolls over at 4:00am, so late nights still count as the day before.

## Layout

```
public/            the whole site (deployed to GitHub Pages)
  index.html       app shell
  app.js           all UI and local state
  plan-engine.js   pure planner: week generator, shopping list, prep timeline
  plan-data.js     78 meals, 13 proteins, shopping catalog, prep components
  content.js       habits, workout, meal ideas, tips
  calendar.json    Yom Tov dates (Hebcal, diaspora)
  styles.css, sw.js, manifest.webmanifest, icons/
.github/workflows/pages.yml   deploys public/ to GitHub Pages on every push to main
```

No build step, no dependencies, no framework — edit the files and push.

## Notes

- Yom Tov dates come from the [Hebcal](https://www.hebcal.com/) Jewish calendar API (diaspora, Israel off), licensed CC BY 4.0, embedded in `public/calendar.json`. The list runs to 2028-10-13; after that only Saturdays are automatic rest days until the list is refreshed.
- No calorie numbers anywhere, by design.
