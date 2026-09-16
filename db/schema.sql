-- Dynasty: Philippine candidates and elected officials, 2001-2025.
-- Shared by the local SQLite build (data/dynasty.sqlite) and Cloudflare D1.

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS provinces (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  poverty REAL
);

CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  province_id INTEGER NOT NULL REFERENCES provinces(id),
  UNIQUE (province_id, slug)
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  home_province_id INTEGER REFERENCES provinces(id),
  runs INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  first_year INTEGER NOT NULL,
  last_year INTEGER NOT NULL,
  top_position TEXT NOT NULL DEFAULT '',
  last_key TEXT NOT NULL,
  first_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contests (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  province_id INTEGER NOT NULL REFERENCES provinces(id),
  city_id INTEGER REFERENCES cities(id),
  district TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL,
  seats INTEGER NOT NULL,
  candidates INTEGER NOT NULL,
  total_votes INTEGER,
  last_winner_votes INTEGER,
  runner_up_votes INTEGER,
  margin INTEGER,
  uncontested INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS candidacies (
  id INTEGER PRIMARY KEY,
  contest_id TEXT NOT NULL REFERENCES contests(id),
  person_id TEXT NOT NULL REFERENCES persons(id),
  year INTEGER NOT NULL,
  province_id INTEGER NOT NULL REFERENCES provinces(id),
  city_id INTEGER REFERENCES cities(id),
  position TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  votes INTEGER,
  rank INTEGER,
  won INTEGER NOT NULL DEFAULT 0,
  ballot_name TEXT NOT NULL DEFAULT '',
  match TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS national_candidates (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  position TEXT NOT NULL,
  name TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  votes INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  won INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS national_province_votes (
  national_id INTEGER NOT NULL REFERENCES national_candidates(id),
  province_id INTEGER NOT NULL REFERENCES provinces(id),
  votes INTEGER NOT NULL,
  PRIMARY KEY (national_id, province_id)
);

CREATE INDEX IF NOT EXISTS idx_persons_last ON persons(last_key, first_key);
CREATE INDEX IF NOT EXISTS idx_persons_home ON persons(home_province_id);
CREATE INDEX IF NOT EXISTS idx_contests_place ON contests(province_id, city_id, year);
CREATE INDEX IF NOT EXISTS idx_contests_year ON contests(year, position);
CREATE INDEX IF NOT EXISTS idx_cand_person ON candidacies(person_id, year);
CREATE INDEX IF NOT EXISTS idx_cand_contest ON candidacies(contest_id);
CREATE INDEX IF NOT EXISTS idx_cand_place ON candidacies(province_id, city_id, year);
CREATE INDEX IF NOT EXISTS idx_national_year ON national_candidates(year, position);
CREATE INDEX IF NOT EXISTS idx_npv_prov ON national_province_votes(province_id);

-- Towns whose voters elect a district seat (representatives, board members). borrowed_year is set when the
-- membership comes from another election because this one has no per-town rows.
CREATE TABLE IF NOT EXISTS district_towns (
  contest_id TEXT NOT NULL REFERENCES contests(id),
  city_id INTEGER NOT NULL REFERENCES cities(id),
  borrowed_year INTEGER,
  PRIMARY KEY (contest_id, city_id)
);
CREATE INDEX IF NOT EXISTS idx_district_towns_city ON district_towns(city_id);

-- Surname blocs: officials in one province sharing a surname as last or middle name, per election (scope_year)
-- or across all elections (scope_year = 0). Stored from 2 members up; filter n >= rule at query time.
CREATE TABLE IF NOT EXISTS blocs (
  id INTEGER PRIMARY KEY,
  scope_year INTEGER NOT NULL,
  province_id INTEGER NOT NULL REFERENCES provinces(id),
  surname TEXT NOT NULL,
  n INTEGER NOT NULL,
  nmid INTEGER NOT NULL,
  terms INTEGER NOT NULL,
  share REAL NOT NULL,
  votes INTEGER NOT NULL,
  top_position TEXT NOT NULL,
  parties TEXT NOT NULL DEFAULT '',
  years TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bloc_members (
  bloc_id INTEGER NOT NULL REFERENCES blocs(id),
  person_id TEXT NOT NULL REFERENCES persons(id),
  via TEXT NOT NULL,
  top_position TEXT NOT NULL,
  city_id INTEGER REFERENCES cities(id),
  votes INTEGER,
  PRIMARY KEY (bloc_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_blocs_scope ON blocs(scope_year, province_id, n);
CREATE INDEX IF NOT EXISTS idx_blocs_surname ON blocs(surname, scope_year);
CREATE INDEX IF NOT EXISTS idx_bloc_members_person ON bloc_members(person_id);
