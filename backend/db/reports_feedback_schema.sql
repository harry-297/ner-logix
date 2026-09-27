-- ===========================================================================
-- Field reports + feedback schema
-- ===========================================================================
--
-- Adds two tables on top of schema.sql / auth_schema.sql:
--   field_reports   ground reports submitted from Field Intelligence, awaiting
--                    Field/Logistics Officer approval before they count as a
--                    confirmed incident
--   feedback         app feedback from any signed-in user, reviewable by
--                    Field/Logistics Officers for continuous improvement
--
-- Run after auth_schema.sql (both reference users.user_id) and after
-- schema.sql (field_reports references incidents.incident_id once approved):
--
--   psql -U postgres -h localhost -d ner_logix -f backend/db/reports_feedback_schema.sql
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- already added elsewhere, harmless if repeated

-- ---------------------------------------------------------------------------
-- field_reports
-- ---------------------------------------------------------------------------
-- One row per report submitted from the Field Intelligence page. A report
-- starts PENDING; a Field Officer or Logistics Officer then approves or
-- rejects it (backend/routers/field_reports.py, require_role(FIELD_OFFICER)).
-- Approving a report with coordinates also creates a row in `incidents` --
-- incident_id links back to it so the review page can show "-> INC-xxxx".
--
-- reported_by is nullable so a report never becomes unreadable if an account
-- is later deleted; reporter_name is captured at submission time so the
-- review list still reads correctly either way.

CREATE TABLE IF NOT EXISTS field_reports (
    report_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    type            TEXT NOT NULL,
    -- Landslide | Flood | Road Damage | Bridge Damage | Traffic | Other
    location        TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',

    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    photo_name      TEXT,
    -- Original filename, kept for display ("evidence.jpg") even though the
    -- bytes themselves live in photo_data below.
    photo_data      TEXT,
    -- The photo itself, base64-encoded. There is no object storage (S3 etc.)
    -- in this project, so the image is kept inline in the row rather than as
    -- a separate file on disk -- simplest thing that actually persists the
    -- photo to the database, which is the point. Fine at demo scale; a
    -- production deployment would move this to blob storage and store a URL
    -- instead once report volume/photo size makes row bloat a real concern.
    photo_mime      TEXT,
    -- e.g. 'image/jpeg' -- needed to hand the base64 back out as a usable
    -- data: URL or file.

    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),

    reported_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    reporter_name   TEXT NOT NULL,

    reviewed_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    reviewer_name   TEXT,
    review_notes    TEXT,
    reviewed_at     TIMESTAMPTZ,

    incident_id     UUID REFERENCES incidents(incident_id) ON DELETE SET NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_reports_status_idx     ON field_reports (status);
CREATE INDEX IF NOT EXISTS field_reports_reported_by_idx ON field_reports (reported_by);
CREATE INDEX IF NOT EXISTS field_reports_created_at_idx  ON field_reports (created_at DESC);

-- Safe to re-run against a database that already has field_reports from
-- before photo_data/photo_mime existed -- CREATE TABLE IF NOT EXISTS above
-- is a no-op on an existing table, so these ALTERs are what actually add the
-- columns for anyone upgrading rather than starting fresh.
ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS photo_data TEXT;
ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS photo_mime TEXT;

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------
-- App feedback from any signed-in role. user_id is nullable for the same
-- reason as field_reports.reported_by; user_name/user_role are captured at
-- submission time.

CREATE TABLE IF NOT EXISTS feedback (
    feedback_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id         UUID REFERENCES users(user_id) ON DELETE SET NULL,
    user_name       TEXT NOT NULL,
    user_role       TEXT,

    category        TEXT NOT NULL,
    -- Usability | Data Accuracy | Performance | Feature Request | Bug Report | Other
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    message         TEXT NOT NULL,
    page_context    TEXT,
    -- Which page/feature the feedback is about, e.g. "Live Map"

    status          TEXT NOT NULL DEFAULT 'NEW'
                    CHECK (status IN ('NEW', 'REVIEWED', 'ACTIONED')),

    reviewed_by     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    review_notes    TEXT,
    reviewed_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_status_idx     ON feedback (status);
CREATE INDEX IF NOT EXISTS feedback_category_idx   ON feedback (category);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at DESC);

-- ---------------------------------------------------------------------------
-- Sanity check
-- ---------------------------------------------------------------------------
SELECT
    (SELECT count(*) FROM field_reports) AS field_reports_loaded,
    (SELECT count(*) FROM feedback)      AS feedback_loaded;
-- Both read 0 right after this runs -- expected. Run
-- scripts/seed_feedback.py afterwards to load ~50 sample feedback rows.
