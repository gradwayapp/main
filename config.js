// GradWay web settings. This is the only file you should need to edit.
window.GRADWAY_CONFIG = {
  // The same campus list the iPhone app downloads (CampusSelectorViewController).
  campusDataURL: "https://terencewilliams1.github.io/campus.json",
  // Used only if the live list can't be reached (for example when testing offline).
  fallbackCampusDataURL: "data/campus.sample.json",

  // Map tiles: OpenFreeMap (free, no API key). Any MapLibre style URL works here.
  mapStyleURL: "https://tiles.openfreemap.org/styles/positron",

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

  // Walking routes (free, no API key): the routing servers openstreetmap.org itself uses.
  osrmFootURL: "https://routing.openstreetmap.de/routed-foot",
  valhallaURL: "https://valhalla1.openstreetmap.de",

  appStoreURL: "https://apps.apple.com/us/app/gradway-college-made-easy/id1069778462",
  feedbackURL: "https://forms.gle/mjoaj1DDdrEfJWRt9",
  contactEmail: "oaklandsoftwareco@gmail.com",
  // Fill these in once the pages are live; the links stay hidden while they are null.
  privacyURL: null,
  termsURL: null
};
