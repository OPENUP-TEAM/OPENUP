-- =====================================================================
-- OpenUp — Web-Based Mental Wellness and Freelance Counseling Support
-- Database schema for Supabase (PostgreSQL 15+)
--
-- Section 1 = the 14 tables in the manuscript Data Dictionary (Table 7).
--             Names and columns follow the dictionary exactly.
-- Section 2 = supporting tables required by the 38 modules in Table 8
--             that the current ERD does not yet cover. If you add these
--             to the manuscript, extend the ERD and Data Dictionary too.
--
-- Convention notes:
--   * Dictionary says INT for keys -> BIGSERIAL (auto-increment INT8).
--   * Dictionary says VARCHAR(n)   -> kept as VARCHAR(n) so the doc matches.
--   * Dictionary says DATETIME     -> TIMESTAMPTZ (Postgres has no DATETIME).
--   * The User table carries its own `password` column, so authentication
--     is handled by the Express server (bcrypt + JWT), not Supabase Auth.
--     Supabase is used as managed Postgres + Storage.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- SECTION 1 — TABLES FROM THE DATA DICTIONARY
-- ---------------------------------------------------------------------

-- Barangay --------------------------------------------------------------
CREATE TABLE barangay (
    barangay_id   BIGSERIAL PRIMARY KEY,
    name          VARCHAR(50)  NOT NULL,
    city          VARCHAR(50)  NOT NULL DEFAULT 'Cebu City',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_barangay_name_city UNIQUE (name, city)
);

-- User ------------------------------------------------------------------
-- role: resident | psychologist | lgu | admin
-- status: active | suspended | pending
CREATE TABLE "user" (
    user_id       BIGSERIAL PRIMARY KEY,
    barangay_id   BIGINT       NOT NULL REFERENCES barangay(barangay_id),
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(100) NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'resident',
    status        VARCHAR(20)  NOT NULL DEFAULT 'active',
    display_alias VARCHAR(50),          -- shown in anonymous chat / testimonials
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_role   CHECK (role IN ('resident','psychologist','lgu','admin')),
    CONSTRAINT ck_user_status CHECK (status IN ('active','suspended','pending'))
);
CREATE INDEX idx_user_barangay ON "user"(barangay_id);
CREATE INDEX idx_user_role     ON "user"(role);

-- Psychologist ----------------------------------------------------------
CREATE TABLE psychologist (
    psychologist_id BIGSERIAL PRIMARY KEY,
    user_id         BIGINT      NOT NULL UNIQUE REFERENCES "user"(user_id) ON DELETE CASCADE,
    license_no      VARCHAR(50) NOT NULL UNIQUE,
    is_verified     BOOLEAN     NOT NULL DEFAULT false,
    specialization  VARCHAR(100),
    languages       VARCHAR(100),        -- 'Bisaya, Filipino, English'
    bio             TEXT,
    rate_per_hour   NUMERIC(10,2) NOT NULL DEFAULT 0,
    license_doc_url TEXT,                -- Supabase Storage path
    verified_at     TIMESTAMPTZ,
    verified_by     BIGINT REFERENCES "user"(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_psychologist_verified ON psychologist(is_verified);

-- Care_Credit -----------------------------------------------------------
-- Declared before Booking because Booking references it (FK3).
-- status: available | reserved | consumed | expired
CREATE TABLE care_credit (
    credit_id   BIGSERIAL PRIMARY KEY,
    barangay_id BIGINT        NOT NULL REFERENCES barangay(barangay_id),
    resident_id BIGINT        NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    status      VARCHAR(20)   NOT NULL DEFAULT 'available',
    issued_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
    CONSTRAINT ck_credit_status CHECK (status IN ('available','reserved','consumed','expired'))
);
CREATE INDEX idx_credit_resident ON care_credit(resident_id, status);
CREATE INDEX idx_credit_barangay ON care_credit(barangay_id);

-- Booking ---------------------------------------------------------------
-- status: pending | confirmed | declined | completed | cancelled | no_show
-- session_type: one_on_one | group
CREATE TABLE booking (
    booking_id      BIGSERIAL PRIMARY KEY,
    resident_id     BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    psychologist_id BIGINT      NOT NULL REFERENCES psychologist(psychologist_id),
    care_credit_id  BIGINT      REFERENCES care_credit(credit_id),   -- optional (FK3)
    schedule        TIMESTAMPTZ NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    session_type    VARCHAR(20) NOT NULL DEFAULT 'one_on_one',
    duration_min    INT         NOT NULL DEFAULT 60,
    is_priority     BOOLEAN     NOT NULL DEFAULT false,  -- crisis escalation queue
    room_name       VARCHAR(80),                          -- Jitsi room
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_booking_status CHECK (status IN ('pending','confirmed','declined','completed','cancelled','no_show')),
    CONSTRAINT ck_booking_type   CHECK (session_type IN ('one_on_one','group'))
);
CREATE INDEX idx_booking_resident     ON booking(resident_id);
CREATE INDEX idx_booking_psychologist ON booking(psychologist_id, schedule);
CREATE INDEX idx_booking_status       ON booking(status);

-- Payment ---------------------------------------------------------------
CREATE TABLE payment (
    payment_id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT        NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
    amount     NUMERIC(10,2) NOT NULL,
    status     VARCHAR(20)   NOT NULL DEFAULT 'pending',
    method     VARCHAR(30),                       -- care_credit | gcash | card
    paid_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_payment_status CHECK (status IN ('pending','paid','refunded','failed'))
);
CREATE INDEX idx_payment_booking ON payment(booking_id);

-- Mood_Entry ------------------------------------------------------------
CREATE TABLE mood_entry (
    mood_id    BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    mood_level INT    NOT NULL CHECK (mood_level BETWEEN 1 AND 5),
    note       TEXT,
    entry_date DATE   NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_mood_per_day UNIQUE (user_id, entry_date)
);
CREATE INDEX idx_mood_user_date ON mood_entry(user_id, entry_date DESC);

-- Voice_Journal ---------------------------------------------------------
CREATE TABLE voice_journal (
    journal_id     BIGSERIAL PRIMARY KEY,
    user_id        BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    audio_url      TEXT,                        -- Supabase Storage path
    transcript     TEXT        NOT NULL DEFAULT '',
    emotion_result VARCHAR(50) NOT NULL DEFAULT 'neutral',
    ai_reflection  TEXT,
    risk_level     VARCHAR(20) NOT NULL DEFAULT 'low',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_journal_risk CHECK (risk_level IN ('low','moderate','high','severe'))
);
CREATE INDEX idx_journal_user ON voice_journal(user_id, created_at DESC);
CREATE INDEX idx_journal_risk ON voice_journal(risk_level) WHERE risk_level IN ('high','severe');

-- Assessment ------------------------------------------------------------
CREATE TABLE assessment (
    assessment_id BIGSERIAL PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    score         INT          NOT NULL,
    result        VARCHAR(100) NOT NULL,        -- minimal | mild | moderate | severe
    answers       JSONB        NOT NULL DEFAULT '[]',
    taken_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_assessment_user ON assessment(user_id, taken_at DESC);

-- Testimonial -----------------------------------------------------------
CREATE TABLE testimonial (
    testimonial_id BIGSERIAL PRIMARY KEY,
    user_id        BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    content        TEXT        NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'visible',
    is_anonymous   BOOLEAN     NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_testimonial_status CHECK (status IN ('visible','flagged','removed'))
);
CREATE INDEX idx_testimonial_status ON testimonial(status, created_at DESC);

-- Comment ---------------------------------------------------------------
CREATE TABLE comment (
    comment_id     BIGSERIAL PRIMARY KEY,
    testimonial_id BIGINT      NOT NULL REFERENCES testimonial(testimonial_id) ON DELETE CASCADE,
    user_id        BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    content        TEXT        NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'visible',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_comment_status CHECK (status IN ('visible','flagged','removed'))
);
CREATE INDEX idx_comment_testimonial ON comment(testimonial_id, created_at);

-- Notification ----------------------------------------------------------
CREATE TABLE notification (
    notification_id BIGSERIAL PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    message         VARCHAR(255) NOT NULL,
    type            VARCHAR(30)  NOT NULL DEFAULT 'system',  -- session | message | system
    link            VARCHAR(255),
    is_read         BOOLEAN      NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_user ON notification(user_id, is_read, created_at DESC);

-- Subscription ----------------------------------------------------------
CREATE TABLE subscription (
    subscription_id BIGSERIAL PRIMARY KEY,
    barangay_id     BIGINT      NOT NULL REFERENCES barangay(barangay_id),
    plan            VARCHAR(50) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    start_date      DATE        NOT NULL,
    end_date        DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_subscription_status CHECK (status IN ('active','expired','cancelled','pending'))
);
CREATE INDEX idx_subscription_barangay ON subscription(barangay_id, status);

-- Consent ---------------------------------------------------------------
CREATE TABLE consent (
    consent_id   BIGSERIAL PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    consent_type VARCHAR(50) NOT NULL,        -- data_use | voice_recording | lgu_analytics
    is_granted   BOOLEAN     NOT NULL DEFAULT false,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consent_user ON consent(user_id, consent_type);


-- ---------------------------------------------------------------------
-- SECTION 2 — SUPPORTING TABLES FOR THE 38 MODULES
-- (not yet in the ERD / Data Dictionary — add them before final defense)
-- ---------------------------------------------------------------------

-- Anonymous Chat (Noe) --------------------------------------------------
CREATE TABLE conversation (
    conversation_id BIGSERIAL PRIMARY KEY,
    resident_id     BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    psychologist_id BIGINT      REFERENCES psychologist(psychologist_id),
    is_anonymous    BOOLEAN     NOT NULL DEFAULT true,
    status          VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_conversation_status CHECK (status IN ('open','closed','escalated'))
);

CREATE TABLE message (
    message_id      BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT      NOT NULL REFERENCES conversation(conversation_id) ON DELETE CASCADE,
    sender_id       BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    content         TEXT        NOT NULL,
    is_read         BOOLEAN     NOT NULL DEFAULT false,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_message_conversation ON message(conversation_id, sent_at);

-- Psychologist availability & group sessions ----------------------------
CREATE TABLE availability (
    availability_id BIGSERIAL PRIMARY KEY,
    psychologist_id BIGINT      NOT NULL REFERENCES psychologist(psychologist_id) ON DELETE CASCADE,
    day_of_week     INT         NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time      TIME        NOT NULL,
    end_time        TIME        NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    CONSTRAINT ck_availability_range CHECK (end_time > start_time)
);

CREATE TABLE group_session (
    group_session_id BIGSERIAL PRIMARY KEY,
    psychologist_id  BIGINT      NOT NULL REFERENCES psychologist(psychologist_id),
    title            VARCHAR(120) NOT NULL,
    topic            VARCHAR(100),
    schedule         TIMESTAMPTZ NOT NULL,
    capacity         INT         NOT NULL DEFAULT 10,
    room_name        VARCHAR(80),
    status           VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    CONSTRAINT ck_group_status CHECK (status IN ('scheduled','ongoing','completed','cancelled'))
);

CREATE TABLE group_participant (
    group_session_id BIGINT NOT NULL REFERENCES group_session(group_session_id) ON DELETE CASCADE,
    user_id          BIGINT NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_session_id, user_id)
);

-- Client management / progress notes (Marinelle) -------------------------
CREATE TABLE session_note (
    note_id         BIGSERIAL PRIMARY KEY,
    booking_id      BIGINT      NOT NULL REFERENCES booking(booking_id) ON DELETE CASCADE,
    psychologist_id BIGINT      NOT NULL REFERENCES psychologist(psychologist_id),
    content         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_note_booking ON session_note(booking_id);

-- Wellness resources (Joan) ---------------------------------------------
CREATE TABLE resource (
    resource_id BIGSERIAL PRIMARY KEY,
    title       VARCHAR(150) NOT NULL,
    description TEXT,
    category    VARCHAR(50),
    file_url    TEXT,
    body        TEXT,
    is_published BOOLEAN     NOT NULL DEFAULT false,
    created_by  BIGINT       REFERENCES "user"(user_id),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_resource_published ON resource(is_published, category);

-- AI Crisis Companion (Noe) ---------------------------------------------
CREATE TABLE ai_conversation (
    ai_conversation_id BIGSERIAL PRIMARY KEY,
    user_id            BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    language           VARCHAR(20) NOT NULL DEFAULT 'en',   -- en | fil | ceb
    helpfulness_rating INT         CHECK (helpfulness_rating BETWEEN 1 AND 5),
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at           TIMESTAMPTZ
);

CREATE TABLE ai_message (
    ai_message_id      BIGSERIAL PRIMARY KEY,
    ai_conversation_id BIGINT      NOT NULL REFERENCES ai_conversation(ai_conversation_id) ON DELETE CASCADE,
    role               VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant')),
    content            TEXT        NOT NULL,
    risk_score         NUMERIC(4,3),
    response_ms        INT,
    sent_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trusted_contact (
    contact_id   BIGSERIAL PRIMARY KEY,
    user_id      BIGINT       NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    phone        VARCHAR(30),
    email        VARCHAR(100),
    relationship VARCHAR(50)
);

-- Crisis alerts: raised by voice journal or AI companion ------------------
CREATE TABLE crisis_alert (
    alert_id       BIGSERIAL PRIMARY KEY,
    user_id        BIGINT      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    source         VARCHAR(30) NOT NULL,   -- voice_journal | ai_companion | assessment
    source_id      BIGINT,
    risk_level     VARCHAR(20) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'open',
    handled_by     BIGINT      REFERENCES psychologist(psychologist_id),
    booking_id     BIGINT      REFERENCES booking(booking_id),
    was_helpful    BOOLEAN,                -- feeds AI Effectiveness Tracker
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at    TIMESTAMPTZ,
    CONSTRAINT ck_alert_status CHECK (status IN ('open','queued','assigned','resolved','dismissed'))
);
CREATE INDEX idx_alert_open ON crisis_alert(status, created_at DESC);

-- Moderation (Marinelle) -------------------------------------------------
CREATE TABLE content_flag (
    flag_id      BIGSERIAL PRIMARY KEY,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('testimonial','comment')),
    content_id   BIGINT      NOT NULL,
    reported_by  BIGINT      REFERENCES "user"(user_id),
    reason       VARCHAR(255),
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by  BIGINT      REFERENCES "user"(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_flag_status CHECK (status IN ('pending','kept','removed'))
);

-- Accomplishment reports (Christine) -------------------------------------
CREATE TABLE accomplishment_report (
    report_id    BIGSERIAL PRIMARY KEY,
    barangay_id  BIGINT      REFERENCES barangay(barangay_id),  -- NULL = citywide (admin)
    period_start DATE        NOT NULL,
    period_end   DATE        NOT NULL,
    payload      JSONB       NOT NULL,
    generated_by BIGINT      REFERENCES "user"(user_id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- System settings & audit (Christine) ------------------------------------
CREATE TABLE system_setting (
    key         VARCHAR(80) PRIMARY KEY,
    value       JSONB       NOT NULL,
    updated_by  BIGINT      REFERENCES "user"(user_id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    log_id     BIGSERIAL PRIMARY KEY,
    actor_id   BIGINT      REFERENCES "user"(user_id),
    action     VARCHAR(80) NOT NULL,
    entity     VARCHAR(50),
    entity_id  BIGINT,
    meta       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);


-- ---------------------------------------------------------------------
-- SECTION 3 — AGGREGATE VIEWS FOR LGU ANALYTICS
-- Anonymised and aggregated only: no resident identity, message, or
-- session content is exposed, per the Scope and Limitations chapter.
-- ---------------------------------------------------------------------

-- Mental Health Heatmap: one row per barangay per day.
CREATE VIEW v_barangay_mood_daily AS
SELECT b.barangay_id,
       b.name AS barangay_name,
       m.entry_date,
       COUNT(*)                    AS entry_count,
       ROUND(AVG(m.mood_level), 2) AS avg_mood
FROM mood_entry m
JOIN "user" u    ON u.user_id = m.user_id
JOIN barangay b  ON b.barangay_id = u.barangay_id
GROUP BY b.barangay_id, b.name, m.entry_date;

-- Community Wellness Index: mood trend, engagement, and crisis frequency
-- combined into a single 0-100 score per barangay for the last 30 days.
CREATE VIEW v_community_wellness_index AS
WITH residents AS (
    SELECT barangay_id, COUNT(*) AS resident_count
    FROM "user" WHERE role = 'resident' AND status = 'active'
    GROUP BY barangay_id
),
mood AS (
    SELECT u.barangay_id,
           AVG(m.mood_level)          AS avg_mood,
           COUNT(DISTINCT m.user_id)  AS active_users
    FROM mood_entry m
    JOIN "user" u ON u.user_id = m.user_id
    WHERE m.entry_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY u.barangay_id
),
crisis AS (
    SELECT u.barangay_id, COUNT(*) AS crisis_count
    FROM crisis_alert c
    JOIN "user" u ON u.user_id = c.user_id
    WHERE c.created_at >= now() - INTERVAL '30 days'
    GROUP BY u.barangay_id
)
SELECT b.barangay_id,
       b.name AS barangay_name,
       COALESCE(r.resident_count, 0) AS resident_count,
       ROUND(COALESCE(m.avg_mood, 0), 2) AS avg_mood,
       COALESCE(c.crisis_count, 0) AS crisis_count,
       GREATEST(0, LEAST(100, ROUND(
              COALESCE(m.avg_mood, 3) / 5 * 60                                     -- mood 60%
            + LEAST(1.0, COALESCE(m.active_users, 0)::NUMERIC
                         / COALESCE(NULLIF(r.resident_count, 0), 1)) * 25          -- engagement 25%
            + (1 - LEAST(1.0, COALESCE(c.crisis_count, 0)::NUMERIC
                         / COALESCE(NULLIF(r.resident_count, 0), 1) * 10)) * 15    -- low crisis 15%
       ))) AS wellness_index
FROM barangay b
LEFT JOIN residents r ON r.barangay_id = b.barangay_id
LEFT JOIN mood      m ON m.barangay_id = b.barangay_id
LEFT JOIN crisis    c ON c.barangay_id = b.barangay_id;

-- Funding & Budget Analytics per barangay.
CREATE VIEW v_barangay_budget AS
SELECT b.barangay_id,
       b.name AS barangay_name,
       COALESCE(SUM(cc.amount), 0)                                            AS credits_issued,
       COALESCE(SUM(cc.amount) FILTER (WHERE cc.status = 'consumed'), 0)      AS credits_used,
       COALESCE(SUM(cc.amount) FILTER (WHERE cc.status = 'available'), 0)     AS credits_remaining,
       (SELECT COALESCE(SUM(s.amount), 0) FROM subscription s
         WHERE s.barangay_id = b.barangay_id AND s.status = 'active')         AS subscription_cost
FROM barangay b
LEFT JOIN care_credit cc ON cc.barangay_id = b.barangay_id
GROUP BY b.barangay_id, b.name;

-- AI Effectiveness Tracker.
CREATE VIEW v_ai_effectiveness AS
SELECT COUNT(*)                                                        AS total_conversations,
       ROUND(AVG(c.helpfulness_rating), 2)                             AS avg_rating,
       (SELECT COUNT(*) FROM crisis_alert WHERE source = 'ai_companion') AS escalations,
       (SELECT COUNT(*) FROM crisis_alert
         WHERE source = 'ai_companion' AND was_helpful IS TRUE)          AS escalations_confirmed,
       (SELECT ROUND(AVG(response_ms)) FROM ai_message WHERE role = 'assistant') AS avg_response_ms
FROM ai_conversation c;

-- updated_at maintenance ------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_updated        BEFORE UPDATE ON "user"      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_testimonial_updated BEFORE UPDATE ON testimonial FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
