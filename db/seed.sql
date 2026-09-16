-- =====================================================================
-- OpenUp — seed data for development
-- Run after schema.sql.
-- Passwords are placeholders. After running this file, set real ones with:
--     cd server && npm run set-password -- --all OpenUp123!
-- The hash below is NOT a valid password; it is a stand-in so the NOT NULL
-- constraint is satisfied.
-- =====================================================================

BEGIN;

INSERT INTO barangay (name, city) VALUES
  ('Apas','Cebu City'), ('Banilad','Cebu City'), ('Basak Pardo','Cebu City'),
  ('Buhisan','Cebu City'), ('Bulacao','Cebu City'), ('Capitol Site','Cebu City'),
  ('Guadalupe','Cebu City'), ('Inayawan','Cebu City'), ('Kamputhaw','Cebu City'),
  ('Labangon','Cebu City'), ('Lahug','Cebu City'), ('Mabolo','Cebu City'),
  ('Mambaling','Cebu City'), ('Pahina Central','Cebu City'), ('Punta Princesa','Cebu City'),
  ('Talamban','Cebu City'), ('Tisa','Cebu City'), ('Zapatera','Cebu City');

-- Placeholder hashes. Run `npm run set-password -- --all OpenUp123!` after seeding.
INSERT INTO "user" (barangay_id, name, email, password, role, status, display_alias) VALUES
  (1, 'System Administrator', 'admin@openup.ph',
      '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin', 'active', NULL),
  (8, 'Barangay Inayawan LGU', 'inayawan.lgu@openup.ph',
      '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'lgu', 'active', NULL),
  (7, 'Dr. Maria Santos', 'maria.santos@openup.ph',
      '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'psychologist', 'active', NULL),
  (8, 'Juan Dela Cruz', 'juan@openup.ph',
      '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'resident', 'active', 'Blue Heron');

INSERT INTO psychologist (user_id, license_no, is_verified, specialization, languages, rate_per_hour, bio)
VALUES (3, 'PSY-12345', true, 'Anxiety and Depression', 'Bisaya, Filipino, English', 800.00,
        'Licensed psychologist with 8 years of community mental health practice in Cebu.');

INSERT INTO availability (psychologist_id, day_of_week, start_time, end_time) VALUES
  (1, 1, '09:00', '17:00'), (1, 2, '09:00', '17:00'), (1, 3, '09:00', '17:00'),
  (1, 4, '09:00', '17:00'), (1, 5, '09:00', '12:00');

INSERT INTO subscription (barangay_id, plan, status, amount, start_date, end_date)
VALUES (8, 'premium', 'active', 25000.00, CURRENT_DATE - 30, CURRENT_DATE + 335);

INSERT INTO care_credit (barangay_id, resident_id, amount, status)
VALUES (8, 4, 800.00, 'available'), (8, 4, 800.00, 'available');

INSERT INTO mood_entry (user_id, mood_level, entry_date, note) VALUES
  (4, 3, CURRENT_DATE - 4, 'Kapoy pero okay ra.'),
  (4, 2, CURRENT_DATE - 3, 'Rough day at work.'),
  (4, 4, CURRENT_DATE - 2, 'Nakatulog ug tarong.'),
  (4, 4, CURRENT_DATE - 1, NULL),
  (4, 3, CURRENT_DATE,     NULL);

INSERT INTO resource (title, description, category, body, is_published, created_by) VALUES
  ('Grounding: the 5-4-3-2-1 technique',
   'A short exercise for moments when anxiety spikes.', 'Coping skills',
   'Name five things you can see, four you can touch, three you can hear, two you can smell, and one you can taste.',
   true, 1),
  ('Talking to family about mental health',
   'How to start the conversation at home.', 'Stigma', 'Draft content.', true, 1);

INSERT INTO system_setting (key, value, updated_by) VALUES
  ('crisis_hotlines', '[{"name":"NCMH Crisis Hotline","number":"1553"},{"name":"Hopeline PH","number":"0917-558-4673"}]', 1),
  ('ai_escalation_threshold', '{"risk_score": 0.75}', 1);

COMMIT;
