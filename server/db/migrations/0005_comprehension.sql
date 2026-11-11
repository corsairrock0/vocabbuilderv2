-- © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
-- Reading comprehension (version 1.7.0): one row per passage read, with the option chosen for each of its questions.
-- The passages themselves are static files (data/reading/<lang>.json); passage_id names one of them. op_id makes a
-- retried upload count once. Nothing here touches the review schedule.
CREATE TABLE comprehension_attempts (
  id INTEGER PRIMARY KEY,
  op_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  passage_id TEXT NOT NULL,                  -- e.g. "es-A1-1-07" (long) or "es-A1-S1-07" (short, everyday)
  kind TEXT NOT NULL,                        -- long | short
  level TEXT NOT NULL,                       -- the passage's level: A1 | A2 | B1 | B2 | C1
  answers TEXT NOT NULL,                     -- JSON array: per question, the chosen option's stored index (-1 for none)
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,                    -- 4 for a long passage, 3 for a short one
  passed INTEGER NOT NULL,                   -- 1 when correct >= total - 1
  level_before TEXT NOT NULL,                -- the learner's reading level before and after this passage
  level_after TEXT NOT NULL,
  answered_at INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  device_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_comprehension_passage ON comprehension_attempts(language_code, passage_id);
CREATE INDEX idx_comprehension_time ON comprehension_attempts(language_code, answered_at);
