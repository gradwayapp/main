-- GradWay Campus Insights: one row per anonymous event. No IP addresses or identifiers.
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,          -- YYYY-MM-DD, the visitor's local date
  hour INTEGER NOT NULL,      -- 0-23, local
  dow INTEGER NOT NULL,       -- 0 = Sunday
  campus TEXT NOT NULL,
  type TEXT NOT NULL,         -- visit, route, search, place, action
  role TEXT,                  -- student, visitor, unknown
  mode TEXT,                  -- walk, drive (routes)
  meters INTEGER,             -- route distance, to 50 m
  minutes INTEGER,
  dest TEXT,                  -- route destination name
  kind TEXT,                  -- place kind or category
  cell TEXT,                  -- ~150 m grid square "row:col"
  on_campus INTEGER,
  category TEXT,              -- quick-search category
  results INTEGER,            -- how many results a search found
  query TEXT,                 -- only for searches that found nothing
  name TEXT,                  -- action name, or the place name for "place"
  detail TEXT,                -- alert text for alert actions
  is_returning INTEGER           -- visit: 1 if this device used GradWay at this campus before
);
CREATE INDEX IF NOT EXISTS events_campus_day ON events (campus, day);
