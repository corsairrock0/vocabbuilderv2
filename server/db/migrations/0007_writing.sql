-- © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
-- Writing practice (version 1.9.0): the learner translates an English sentence into the language they are learning.
-- One row per answer. The sentences themselves are static files (data/writing/<lang>.json); sentence_id names one of
-- them. op_id makes a retried upload count once. A sentence is done once an answer to it is correct, either by the
-- grader or because the learner said their answer was right (accepted = 1); those wordings are kept in
-- writing_accepted and count as right from then on. Nothing here touches the review schedule.
CREATE TABLE writing_attempts (
  id INTEGER PRIMARY KEY,
  op_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  sentence_id TEXT NOT NULL,                 -- e.g. "es-A1-1-007"
  level TEXT NOT NULL,                       -- the sentence's level: A1 | A2 | B1 | B2 | C1
  response TEXT NOT NULL,
  correct INTEGER NOT NULL,                  -- 1 when every word was right
  accepted INTEGER NOT NULL DEFAULT 0,       -- 1 when the learner said a wrong-graded answer was right
  level_before TEXT NOT NULL,                -- the learner's writing level before and after this answer
  level_after TEXT NOT NULL,
  answered_at INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  device_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_writing_sentence ON writing_attempts(language_code, sentence_id);
CREATE INDEX idx_writing_time ON writing_attempts(language_code, answered_at);
CREATE INDEX idx_writing_day ON writing_attempts(language_code, local_day);

CREATE TABLE writing_accepted (
  language_code TEXT NOT NULL REFERENCES languages(code),
  sentence_id TEXT NOT NULL,
  answer TEXT NOT NULL,                      -- the learner's wording, as typed
  answer_key TEXT NOT NULL,                  -- how it is compared (shared/writing.ts, writingKey)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (language_code, sentence_id, answer_key)
);
