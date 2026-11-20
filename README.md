# GradWay for the web

A mobile-first version of GradWay that runs in any browser: iPhone, Android, laptop.
Plain HTML, CSS and JavaScript with no build step, made for GitHub Pages.

## What it does

- **Campus picker** reading the same `campus.json` the iPhone app downloads
  (`https://terencewilliams1.github.io/campus.json`). Add a campus there and it shows up in both.
- **Student or visitor** question per campus, like the app. Visitors get "Find parking"
  and the university website; students get their next class and the student portal.
- **Dashboard** built from the campus's links (Academic Calendar, Bookstore, Dining,
  Events, Public Safety, Sports, News, socials). Empty fields are skipped, as in the app.
- **Map search** with the app's rules: search the campus box first, then widen to
  3, 6, 10 and 15 miles; one result opens its card, several show a list sorted
  by distance, none says "Try a different search".
- **My classes**: add classes with a building; the dashboard's Next Class card walks you there.
- **Buildings** directory from the `Buildings` field.
- **Walking routes**: once location is allowed, tapping a place draws a dotted walking route
  from where you are, with walking time, distance and arrival time.
- **Initials, not logos**: every campus shows its initials badge; `Logo` in campus.json is ignored on the web.
- **Safety**: call 911, campus safety link, police and clinics nearby, share my location.
- **Install**: App Store card on iPhone; "Add to Home screen" on Android (it's a PWA).
- **Campus links** for marketing: `…/#/c/mississippi-state-university` opens straight to that campus.

## Publish on GitHub Pages

1. Create a repository (for example `gradway-web`) and upload everything in this folder,
   including the hidden `.nojekyll` file.
2. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch**,
   choose `main` and `/ (root)`, then **Save**.
3. After a minute the site is live at `https://terencewilliams1.github.io/gradway-web/`.

To serve it from your domain instead (for example `app.gradwayapp.com`), add the domain under
**Settings → Pages → Custom domain** and create the CNAME record your DNS provider asks for.

## Settings

Everything you'd change is in `config.js`: the campus list URL, App Store link,
feedback form, and the Privacy Policy and Terms links (hidden until you fill them in).

## Services it uses (all free, no API keys)

| Job | Service | Notes |
| --- | --- | --- |
| Map tiles | OpenFreeMap | No key and no view limits. The public service is best-effort. |
| Search by name | Photon (komoot) | Free for reasonable use; heavy use can be throttled. |
| Search by category | Overpass API (private.coffee mirror first, then overpass-api.de, then VK Maps) | Parking lots, ATMs and other unnamed places. Each server gets 9 seconds; if all fail, Photon's category filter is used. Results are kept for the visit. |
| Walking routes | OSRM foot profile at routing.openstreetmap.de, Valhalla as backup | The routers openstreetmap.org uses. Routes, walking time and arrival time from the user's location. |
| Map drawing | MapLibre GL JS 5.24.0 | Included in `vendor/`, so nothing loads from a CDN. |

If traffic grows past what the free services allow, each one can be swapped in `config.js`
(paid tile hosts, a self-hosted Photon, or Google Places through a new provider in `js/search.js`).

## Files

```
index.html            page shell and dialogs
config.js             settings
css/app.css           styles (dark navy glass, campus-color glow)
js/app.js             screens, routing, map screen
js/data.js            campus.json parsing (same fields as CampusData.swift)
js/search.js          the multi-pass campus search
js/map.js             MapLibre wrapper and route drawing
js/route.js           walking routes (OSRM, then Valhalla)
js/store.js           saved campus, mode and classes (this browser only)
js/icons.js           icons
data/campus.sample.json  two sample campuses, used only if campus.json can't load
sw.js, manifest.webmanifest, icons/   home-screen install and offline shell
```
