-- ===========================================================================
-- Authentication schema — DRAFT FOR REVIEW, not yet run against any database
-- ===========================================================================
--
-- Adds two tables on top of the existing schema:
--   users        one row per account, password stored as a salted PBKDF2 hash
--   otp_codes    short-lived codes for signup verification and password reset
--
-- Run only after you've confirmed the column choices below.
--   psql -U postgres -h localhost -d ner_logix -f backend/db/auth_schema.sql
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- already added by schema.sql, harmless if repeated
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email columns below

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- Password hashing: PBKDF2-HMAC-SHA256, NOT plain SHA-256. Plain SHA-256 is
-- fast by design, which is the wrong property for a password hash -- a
-- leaked table becomes brute-forceable at billions of guesses/sec on a GPU.
-- PBKDF2-HMAC-SHA256 (stdlib hashlib.pbkdf2_hmac, no new dependency) runs the
-- same hash family through a per-user salt and ~300k iterations, which is
-- the actual point of a password hash. password_salt and password_iterations
-- are stored per-row so the iteration count can be raised later without
-- invalidating existing hashes.
--
-- role values match the three-tier matrix: a User sees the core pages; a
-- Field Officer additionally verifies incidents and sees Analytics/Vehicles;
-- a Logistics Officer additionally reaches admin-level actions (e.g.
-- triggering a re-score). Enforced on the backend via a require_role()
-- dependency -- this CHECK constraint is a second line of defense, not the
-- only one, since hiding a UI button never stops a direct API call.

CREATE TABLE IF NOT EXISTS users (
    user_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name                TEXT NOT NULL,
    email               CITEXT NOT NULL UNIQUE,   -- case-insensitive match on login
    phone               TEXT,

    password_hash       TEXT NOT NULL,
    password_salt       TEXT NOT NULL,
    password_iterations INTEGER NOT NULL DEFAULT 300000,

    role                TEXT NOT NULL DEFAULT 'USER'
                         CHECK (role IN ('USER', 'FIELD_OFFICER', 'LOGISTICS_OFFICER')),

    is_verified         BOOLEAN NOT NULL DEFAULT FALSE,  -- flips true after signup OTP

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at       TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- otp_codes
-- ---------------------------------------------------------------------------
-- One row per code sent. Codes are hashed at rest (same PBKDF2 approach,
-- fewer iterations since they're short-lived and only 6 digits) so a DB leak
-- doesn't hand out live codes directly. expires_at is checked by the backend;
-- attempts caps brute-force guesses against a single code before it's
-- invalidated.

CREATE TABLE IF NOT EXISTS otp_codes (
    otp_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        CITEXT NOT NULL,
    code_hash    TEXT NOT NULL,
    code_salt    TEXT NOT NULL,
    purpose      TEXT NOT NULL CHECK (purpose IN ('SIGNUP', 'PASSWORD_RESET')),

    attempts     INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,

    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,          -- set once used, so a code can't be replayed
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_codes_lookup_idx
    ON otp_codes (email, purpose, expires_at DESC);

-- ---------------------------------------------------------------------------
-- Sanity check
-- ---------------------------------------------------------------------------
SELECT
    (SELECT count(*) FROM users)     AS users_loaded,
    (SELECT count(*) FROM otp_codes) AS otp_codes_loaded;
-- Both read 0 right after this runs -- expected, nobody has signed up yet.
