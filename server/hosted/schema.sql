CREATE TABLE IF NOT EXISTS wander_trip (
 id uuid PRIMARY KEY, scope text NOT NULL, line text NOT NULL, chat text NOT NULL,
 title text NOT NULL, snapshot bytea, UNIQUE(scope,line,chat)
);
CREATE TABLE IF NOT EXISTS wander_member (
 trip uuid REFERENCES wander_trip, handle text NOT NULL, picker uuid NOT NULL UNIQUE,
 name text, claimed boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(trip,handle)
);
CREATE TABLE IF NOT EXISTS wander_challenge (
 id uuid PRIMARY KEY, trip uuid NOT NULL, picker uuid REFERENCES wander_member(picker),
 browser text NOT NULL, digest text NOT NULL, created bigint NOT NULL,
 attempts integer NOT NULL DEFAULT 0, state text NOT NULL
);
CREATE INDEX IF NOT EXISTS wander_rate ON wander_challenge(created,picker);
CREATE TABLE IF NOT EXISTS wander_session (
 digest text PRIMARY KEY, trip uuid NOT NULL, picker uuid REFERENCES wander_member(picker), expires bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS wander_reply (
 trip uuid REFERENCES wander_trip, message text NOT NULL, state text NOT NULL,
 PRIMARY KEY(trip,message)
);

ALTER TABLE wander_member ADD COLUMN IF NOT EXISTS imported_name text;

CREATE TABLE IF NOT EXISTS wander_model_quota (
 day date PRIMARY KEY, requests integer NOT NULL
);
