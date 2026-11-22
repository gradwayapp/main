# GradWay for the web

A mobile-first version of GradWay that runs in any browser: iPhone, Android, laptop.
Plain HTML, CSS and JavaScript with no build step, made for GitHub Pages.

## What it does

- **Campuses grouped by state**, worked out from each campus's center (simplified U.S. Census outlines in
  `data/us-states.json`, checked in the browser), with state shortcuts at the top. Typing a state name filters too.
- **Arrival screen** after Continue: the campus badge and name while buildings, weather and nearby places load
  (about two seconds, tap to skip), then the dashboard.
- **Welcome screen** on a first visit, then the campus picker, then a **confirmation page** with the
  campus photo (the `Campus` field in campus.json), current weather and what GradWay has for that school.
- **6-mile search**: campus results show at once, then places within 6 miles are added.
- **Business info** in each place card: open now or closed, the week's hours, phone (tap to call),
  website, and facts like Wi-Fi or wheelchair access, from OpenStreetMap.
  When OpenStreetMap has no hours or phone (or doesn't answer within 8 seconds), the card says so and links to
  the place on Google Maps.
- **Bottom card shrinks** while you drag or zoom the map; tap it to bring it back.
- **Privacy Policy and Terms of Use** at `privacy.html` and `terms.html`, linked in every footer.
- **Visitor counts** with GoatCounter (no cookies): page views per campus and screen, quick-search taps,
  routes, and sponsored listing views and taps; optional public total in the footer.
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
- **Find Buildings** directory from the `Buildings` field, near the top of the dashboard.
- **Walking and driving routes**: once location is allowed, tapping a place animates the route
  from where you are to the place, with time, distance and arrival time. A Walk / Drive toggle
  switches between a dotted walking route and a solid driving route (the choice is remembered),
  and Directions opens Apple or Google Maps in the same mode. If no route server answers, a
  dashed straight line still shows the way.
- **Lists stay put**: opening a building from the Buildings list keeps the list (and its filter)
  beside the map on a laptop, and Back returns to it on a phone.
- **Tap the map's own places**: cafés, restaurants, statues and shops drawn on the map open a place card
  (hours and phone looked up by name nearby, directions, Street View).
- **Back to campus** button under the map style button: recenters on the campus center point.
- **Live traffic** (optional): add a free TomTom key in `config.js` (`trafficTilesURL`) and a Live traffic switch
  appears under Show on map. Off until someone turns it on, and only drawn from zoom 11 in, to save tile requests.
- **Map styles**: Streets (the default), Dark (matches the app), Light, Navy (OpenFreeMap Fiord)
  and Satellite (USGS aerial imagery with street labels), from the layers button on the map. The choice is
  remembered; if a style can't load, the map keeps the current one.
- **Route preview flyover** for routes up to 0.75 mile: the map tilts and follows the route from start to
  finish, turning at each bend, then settles back on the whole route. Touching the map or Stop preview ends it.
- **Street View** button in every place card: opens Google Street View from the nearest street, facing the place,
  so it shows the outside rather than a visitor's photo from inside (free, no API key; the street comes from OSRM).
- **Minimize the list or card** with the chevron in its header (or the handle bar); tap it again to bring it back.
- **Map details** to switch on: emergency (blue-light) phones, AEDs, bus stops, bike racks, restrooms and
  water fountains, from OpenStreetMap.
- **Weather** in the dashboard header: temperature, conditions, and today's high and low from the
  National Weather Service, refreshed every 30 minutes.
- **Fast categories**: once a week per campus, one request fetches every quick category and map detail
  inside the campus box and keeps it on the device, so Library, Coffee or Parking answer instantly.
  Wider searches ask two map servers at once if the first is slow, with Photon as a backup.
- **Sponsored places**: paid local listings from `data/sponsors.json` appear under "Local deals" and at
  the top of the matching category, always labeled Sponsored.
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

## Turn on visitor counts

1. Sign up free at goatcounter.com and choose the code `gradway` (your dashboard becomes gradway.goatcounter.com).
2. Put `goatcounterCode: "gradway"` in `config.js`.
3. Optional: in GoatCounter, Settings → turn on "Allow adding visitor counts on your website" to show the total in the footer.

Sponsors' numbers are under Events in GoatCounter (sponsor-view and sponsor-click, by campus and name).

## Settings

Everything you'd change is in `config.js`: the campus list URL, App Store link,
feedback form, and the Privacy Policy and Terms links (hidden until you fill them in).

## Services it uses (all free, no API keys)

| Job | Service | Notes |
| --- | --- | --- |
| Map tiles | OpenFreeMap | No key and no view limits. The public service is best-effort. |
| Live traffic (optional) | TomTom Traffic raster flow tiles | Free tier: 200,000 tile requests a month, no credit card. Needs an API key in `config.js`. |
| Satellite imagery | USGS The National Map (USGSImageryOnly) | U.S. public domain. Credit: USGS, National Geospatial Program. |
| Weather | National Weather Service (api.weather.gov) | Free open data, no key, U.S. only. |
| Search by name | Photon (komoot) | Free for reasonable use; heavy use can be throttled. |
| Search by category | Overpass API (private.coffee mirror first, then overpass-api.de, then VK Maps) | Parking lots, ATMs and other unnamed places. Each server gets 9 seconds; if all fail, Photon's category filter is used. Results are kept for the visit. |
| Walking and driving routes | OSRM at routing.openstreetmap.de (foot and car), Valhalla as backup, OSRM's demo server last for driving | The routers openstreetmap.org uses. Route, time and arrival time from the user's location. |
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
js/route.js           walking and driving routes (OSRM, then Valhalla)
js/weather.js         current weather (National Weather Service)
js/hours.js           opening hours: open now, closes at, the week
js/analytics.js       GoatCounter visit counts
privacy.html, terms.html, css/legal.css   legal pages
js/store.js           saved campus, mode and classes (this browser only)
js/icons.js           icons
data/campus.sample.json  two sample campuses, used only if campus.json can't load
data/sponsors.json    sponsored places by campus (empty to start; see the example inside)
sw.js, manifest.webmanifest, icons/   home-screen install and offline shell
```
