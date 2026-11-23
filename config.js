// GradWay web settings. This is the only file you should need to edit.
window.GRADWAY_CONFIG = {
  // The same campus list the iPhone app downloads (CampusSelectorViewController).
  campusDataURL: "https://terencewilliams1.github.io/campus.json",
  // Used only if the live list can't be reached (for example when testing offline).
  fallbackCampusDataURL: "data/campus.sample.json",

  // Map tiles: OpenFreeMap (free, no API key). Any MapLibre style URL works here.
  mapStyleURL: "https://tiles.openfreemap.org/styles/positron",
  // More looks in the map's style picker (also from OpenFreeMap).
  navyStyleURL: "https://tiles.openfreemap.org/styles/fiord",
  streetsStyleURL: "https://tiles.openfreemap.org/styles/liberty",
  // Live traffic (optional): TomTom raster flow tiles. Sign up free at developer.tomtom.com
  // (200,000 tile requests a month, no credit card), create an API key, and paste it in place
  // of YOUR_KEY, for example:
  // trafficTilesURL: "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=YOUR_KEY",
  // While this is null, the Traffic switch doesn't show on the map.
  trafficTilesURL: null,
  // Satellite view: USGS The National Map aerial imagery (U.S. public domain, no key).
  satelliteTilesURL: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",

  // Current weather: National Weather Service (free, no key, U.S. campuses).
  weatherURL: "https://api.weather.gov",

  // Place search (free, no API key):
  //   Photon finds names ("Mitchell Memorial Library", "Starbucks").
  //   Overpass finds categories ("Parking", "ATM"), like Apple's POI categories in the app.
  photonURL: "https://photon.komoot.io/api/",
  // Tried in order until one answers. The main overpass-api.de server is often overloaded,
  // so a mirror goes first. For heavy commercial traffic, use a paid or self-hosted server.
  overpassURLs: [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
  ],

  // Walking and driving routes (free, no API key): the routing servers openstreetmap.org itself uses.
  osrmFootURL: "https://routing.openstreetmap.de/routed-foot",
  osrmCarURL: "https://routing.openstreetmap.de/routed-car",
  osrmBikeURL: "https://routing.openstreetmap.de/routed-bike",
  valhallaURL: "https://valhalla1.openstreetmap.de",
  // OSRM's public demo (driving only). Last resort; it's meant for light use.
  osrmDemoURL: "https://router.project-osrm.org",

  // Campus Insights: anonymous activity for insights.html (see worker/README.md to set up the
  // free Cloudflare Worker that receives it). null = nothing is sent, and insights.html shows sample data.
  insightsEndpoint: null,

  // Campus alerts at the top of the dashboard. Edit them with alerts-editor.html, which
  // publishes this file to the GitHub repository below.
  alertsURL: "data/alerts.json",
  alertsRepo: { owner: "gradwayapp", repo: "main", branch: "main", path: "data/alerts.json" },

  // Sponsored places shown under "Local deals" and at the top of matching categories.
  sponsorsURL: "data/sponsors.json",
  // Where "Advertise on GradWay" in the footer goes: the sign-up page in this folder. null hides it.
  advertiseURL: "advertise.html",

  // Sponsor plans on the sign-up page. The prices here are placeholders: set your own.
  // paymentURL: a Stripe Payment Link for the plan (Stripe dashboard → Payment Links → New).
  // GradWay adds the business's email and a reference to it. null = "we'll email a payment link".
  sponsorPlans: [
    { id: "monthly", name: "Monthly", price: "$49", per: "a month", months: 1, paymentURL: null, note: "Renews monthly. Cancel anytime." },
    { id: "semester", name: "Semester", price: "$179", per: "for 4 months", months: 4, paymentURL: null, note: "Fall or spring term. Save about 9%." }
  ],
  // Where sign-ups are sent. A form service that takes JSON, such as Formspree
  // ("https://formspree.io/f/your-id"); you get each listing by email. null = the business
  // emails it to contactEmail from the page instead.
  sponsorFormURL: null,

  appStoreURL: "https://apps.apple.com/us/app/gradway-college-made-easy/id1069778462",
  feedbackURL: "https://forms.gle/mjoaj1DDdrEfJWRt9",
  contactEmail: "oaklandsoftwareco@gmail.com",
  privacyURL: "privacy.html",
  termsURL: "terms.html",

  // Visitor counts (goatcounter.com, free, no cookies). Sign up, pick a code such as "gradway",
  // and put it here. In GoatCounter's settings, turn on "Allow adding visitor counts on your
  // website" to also show the total in the footer. null turns counting off.
  goatcounterCode: null
};
