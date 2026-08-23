CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS volunteers (
  id INTEGER PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  display_name TEXT,
  sms_status TEXT NOT NULL CHECK (sms_status IN ('pending', 'opted_in', 'opted_out')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_events (
  id INTEGER PRIMARY KEY,
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
  action TEXT NOT NULL CHECK (action IN ('opt_in', 'opt_out', 'help')),
  source TEXT NOT NULL,
  keyword TEXT,
  twilio_message_sid TEXT,
  policy_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'standby', 'cancelled')),
  standby_position INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS signups_one_active_per_volunteer_event
  ON signups(event_id, volunteer_id)
  WHERE status IN ('confirmed', 'standby');

CREATE TABLE IF NOT EXISTS standby_openings (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'filled', 'exhausted', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS standby_offers (
  id INTEGER PRIMARY KEY,
  opening_id INTEGER NOT NULL REFERENCES standby_openings(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  signup_id INTEGER NOT NULL REFERENCES signups(id),
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  offered_at TEXT NOT NULL,
  expires_at TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS standby_offers_one_pending_per_event
  ON standby_offers(event_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS standby_offers_one_pending_per_opening
  ON standby_offers(opening_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS standby_offers_one_pending_per_signup
  ON standby_offers(signup_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS sms_events (
  id INTEGER PRIMARY KEY,
  twilio_message_sid TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  volunteer_id INTEGER REFERENCES volunteers(id),
  event_id INTEGER REFERENCES events(id),
  classification TEXT,
  delivery_status TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS signups_event_status ON signups(event_id, status);
CREATE INDEX IF NOT EXISTS standby_offers_volunteer_status ON standby_offers(volunteer_id, status);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
