-- © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
-- Click-wrap record of the Terms of Service: which version the account accepted, when, and from which device.
-- Rows are only added (a new row per accepted version); the latest row is the account's current acceptance.
CREATE TABLE terms_acceptances (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  device_id TEXT,
  user_agent TEXT
);
CREATE INDEX idx_terms_user ON terms_acceptances(user_id, accepted_at);
