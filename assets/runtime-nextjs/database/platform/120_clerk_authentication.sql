-- PRODUCTION IDENTITY LINKING. SAFE TO REAPPLY.

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS identity_linked_at timestamptz;

UPDATE app_user
   SET identity_linked_at = COALESCE(identity_linked_at, created_at)
 WHERE auth_subject NOT LIKE 'pending:%'
   AND auth_subject NOT LIKE 'development:%';

CREATE INDEX IF NOT EXISTS app_user_pending_email_idx
  ON app_user (lower(email))
  WHERE auth_subject LIKE 'pending:%';
