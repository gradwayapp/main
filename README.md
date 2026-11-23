# GradWay for the web

A mobile-first version of GradWay that runs in any browser: iPhone, Android, laptop.
Plain HTML, CSS and JavaScript. A small build step (`npm run build`) publishes a minified copy to `dist/`
for Cloudflare Pages; the unbuilt folder still runs as is for local previews. Proprietary: see `LICENSE`.

## What it does

- **Campus alerts**: up to three short, timed messages at the top of a campus's dashboard (deadline, food,
  event, weather, safety, news), safety first, each with an optional link. Students can close them. Edited
  with `alerts-editor.html` (see "Campus alerts" below).
- **Light and dark**: a sun/moon button on the dashboard switches the whole site; the choice is remembered.
- **Walkthrough**: a 9-page story-style tour (tap through, hold to pause, swipe down to close) after the
  first campus pick, and anytime from "See how GradWay works" on the dashboard.
- **Leave-by reminders**: the Next class card counts down ("Leave in 12 min"), using the walk from the
  previous class, your location or a building you choose, plus extra minutes. Notifications while GradWay
  is open or installed, and a calendar file with a "leave now" alarm on every class for reminders that
  always arrive.
- **Dashboard cards say what to do**: "Find lunch" (changes with the time of day), "Check important dates",
  "Get your books", "Catch a game" and so on, each with a short line underneath.
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
- **Import a schedule**: from a calendar file (.ics) exported by the student portal, Canvas or Google Calendar,
  or text pasted from the portal's schedule page. Each class's room is matched to a campus building
  (Matched / Best guess / Pick one), then the student checks the list and adds them. Read in the browser only.
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

## Publish on Cloudflare Pages (from a private repository)

Cloudflare Pages builds the site from a **private** GitHub repository, so the source code isn't public,
and publishes the minified copy. It's free, and it's the same Cloudflare account as Campus Insights.

1. Upload everything in this folder to the repository (`gradwayapp/main`), as before. `node_modules/` and
   `dist/` are listed in `.gitignore` and never need uploading.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, sign in to GitHub and pick the repository.
3. Settings: Framework preset **None**, Build command **`npm run build`**, Build output directory **`dist`**. Deploy.
4. After a minute the site is live at `https://<project-name>.pages.dev` (for example `gradway.pages.dev`).
   Every push to the repository (including alerts saved in `alerts-editor.html`) republishes it within about a minute.
5. Test it there: pick a campus, search, route, open the walkthrough.
6. Custom domain (optional): the project's **Custom domains → Set up a domain**, for example `app.gradwayapp.com`.
7. If Campus Insights is set up, add the new address(es) to `ALLOWED_ORIGINS` in `worker/wrangler.toml`
   and run `npx wrangler deploy` again; also update the dashboard links you've sent (worker/README.md).
8. Keep the old link working, then make the code private:
   - In GitHub, rename the repository (Settings → General → Repository name, e.g. `gradway-web`) and change
     `alertsRepo.repo` in `config.js` to the new name; Cloudflare follows the rename.
   - Make it private: Settings → General → Danger Zone → **Change visibility → Private**.
   - Create a new **public** repository named `main` holding only `tools/github-pages-redirect/index.html`
     (as `index.html`; set the address inside first) and turn on GitHub Pages for it. Old links, QR codes and
     posts pointing to `gradwayapp.github.io/main/` then forward to the new site, including campus links.

Response headers for Cloudflare are in `_headers`: no framing by other sites, no AI-training tag, and the
offline worker always rechecked. `robots.txt` turns away AI-training crawlers while allowing search engines.

## Protecting GradWay

- **Ownership notices**: `LICENSE` (proprietary, all rights reserved), a copyright line at the top of every
  published script and stylesheet, and the Terms of Use ("Using the site" and "Ownership").
- **Minified code**: the published site is unreadable compared to the source, and the source repository is private.
- **Fingerprinted campus data**: `tools/fingerprint-campus.mjs` puts invisible marks in campus.json (tiny changes
  to each campus's center and color, worked out from a private key) so a copied file can be proven to be ours.
  1. `node tools/fingerprint-campus.mjs keygen` once; save the key in a password manager, never in a repository.
  2. `node tools/fingerprint-campus.mjs stamp campus.json campus.stamped.json --key <key>` after each edit,
     check it in the iPhone app, then publish it as campus.json.
  3. If you find a suspicious copy: `node tools/fingerprint-campus.mjs check their-file.json --key <key>`.
- **What can't be hidden**: anything a browser runs or downloads (the app's code and campus.json) can be read
  by a determined person. Keep secrets, prices and Insights data on the server, never in the site.

## Campus Insights (insights.html)

A dashboard for university leaders, and a selling point for campus licenses. It shows:
- **Headline numbers:** routes given, people helped, average route, share on foot, searches and share after dark, each compared with the period before.
- **Charts:**
  - routes per day;
  - a day-by-hour heatmap of when people navigate;
  - a map of where they go;
  - top destinations;
  - what people search for;
  - searches that found nothing;
  - how far people go;
  - parking demand by hour;
  - students vs visitors;
  - how campus alerts did;
  - schedule imports, reminders and safety use.
- **Written findings:** a short list of what stands out in the period.

Filters for campus, dates (7 days, 30 days, this term) and students or visitors. Every chart has a table
view; Download CSV and Save as PDF make a report to send.

- **Sample data** shows until a campus is live (clearly labeled), so you can demo it today:
  `insights.html?campus=mississippi-state-university`
- **Live data:** set up the free server in `worker/` (see `worker/README.md`), put its address in
  `config.js` as `insightsEndpoint`, and give each university its link with its own key:
  `insights.html?campus=…&key=…`. A key only opens its own campus.
- **Privacy:** the site sends only anonymous, coarse events (no IDs, no IP addresses, no starting points;
  places on a 150 m grid; search text only when nothing was found). Small groups (under 10) are hidden.
  The Privacy Policy's "Campus insights" section describes it.

## Campus alerts (alerts-editor.html)

1. Make a GitHub fine-grained token once: Repository access = only this site's repository;
   Permissions → Contents = Read and write. (The steps are also on the editor page.)
2. Open `alerts-editor.html` on the live site (it isn't linked anywhere and asks search engines not to list it),
   paste the token, tick "Remember" on your own computer, and tap **Load alerts**.
3. Pick a campus (or All campuses), tap **New alert**, write the message, choose the type and times
   ("Rest of today", "All day tomorrow" or "Next 7 days" fill them in), add a link if you like, and
   **Save and publish**. GitHub Pages republishes in about a minute; phones pick it up within two.
4. Alerts end on their own. **Remove ended alerts** tidies the file.

The repository and branch come from `alertsRepo` in `config.js`. Without a token you can still make changes
and download `alerts.json` to upload by hand.

## Sponsor sign-ups (advertise.html)

Local businesses sign up at `advertise.html` (linked as "Advertise on GradWay" in every footer, with the
campus already chosen). They pick a campus, enter their business and offer, place a pin, see a live preview,
choose a plan and send it for review.

1. **Prices**: set `sponsorPlans` in `config.js` (the $49 a month and $179 a semester there are placeholders).
2. **Payments**: in Stripe, create a Payment Link for each plan and paste it as that plan's `paymentURL`.
   GradWay adds the business's email and a reference (`campus-business`) so you can match payments.
3. **Getting sign-ups**: with `sponsorFormURL` set to a Formspree (or similar) endpoint, each sign-up arrives
   by email automatically. Without it, the page has the business email it to `contactEmail`.
4. **Going live**: each sign-up includes a ready-made `sponsors.json` entry. Paste it under the campus in
   `data/sponsors.json`, set `ends` to the last paid day, and commit. It appears at the next page load and
   disappears by itself after `ends`.
5. **Monthly report**: in GoatCounter, under Events, `sponsor-view` and `sponsor-click` are counted per
   campus and business name.

Note: GitHub's terms say Pages isn't meant for running an online business. Linking out to Stripe from a sign-up
page is light use, but once sponsor revenue grows, move `advertise.html` to gradwayapp.com or Cloudflare Pages.

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
