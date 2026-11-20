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
  overpassURL: "https://overpass-api.de/api/interpreter",

  appStoreURL: "https://apps.apple.com/us/app/gradway-college-made-easy/id1069778462",
  feedbackURL: "https://forms.gle/mjoaj1DDdrEfJWRt9",
  contactEmail: "oaklandsoftwareco@gmail.com",
  // Fill these in once the pages are live; the links stay hidden while they are null.
  privacyURL: null,
  termsURL: null
};
