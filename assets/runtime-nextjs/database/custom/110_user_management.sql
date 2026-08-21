-- USER MANAGEMENT HARDENING. SAFE TO REAPPLY.
BEGIN;

UPDATE app_user SET email = lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_normalized_uidx ON app_user (lower(email));
CREATE INDEX IF NOT EXISTS app_user_role_active_idx ON app_user (role_key, active);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_email_normalized_check') THEN
    ALTER TABLE app_user ADD CONSTRAINT app_user_email_normalized_check CHECK (email = lower(trim(email)) AND length(email) <= 254);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_display_name_check') THEN
    ALTER TABLE app_user ADD CONSTRAINT app_user_display_name_check CHECK (length(trim(display_name)) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_auth_subject_check') THEN
    ALTER TABLE app_user ADD CONSTRAINT app_user_auth_subject_check CHECK (length(trim(auth_subject)) > 0);
  END IF;
END $$;

COMMIT;
