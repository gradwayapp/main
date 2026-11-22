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
  valhallaURL: "https://valhalla1.openstreetmap.de",
  // OSRM's public demo (driving only). Last resort; it's meant for light use.
  osrmDemoURL: "https://router.project-osrm.org",

  // Sponsored places shown under "Local deals" and at the top of matching categories.
  sponsorsURL: "data/sponsors.json",
  // Where "Advertise on GradWay" in the footer goes (a form, email or Stripe Payment Link). null hides it.
  advertiseURL: "mailto:oaklandsoftwareco@gmail.com?subject=Advertise%20on%20GradWay",

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
