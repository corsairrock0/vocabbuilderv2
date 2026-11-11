-- Inflection tables, sentence sources and the forms / cloze practice.

-- One declension or conjugation table per word (shared/paradigms.ts describes the cells).
CREATE TABLE entry_paradigms (
  entry_id INTEGER PRIMARY KEY REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- noun | adjective | pronoun | numeral | verb
  data TEXT NOT NULL,                        -- JSON {cells: {"<row>|<column>": [forms]}, indeclinable?, notes?, gender?}
  source TEXT,                               -- where the table comes from, e.g. "OpenRussian"
  import_job_id TEXT REFERENCES import_jobs(id),
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_paradigms_import ON entry_paradigms(import_job_id);

-- Where a sentence comes from at its source (e.g. "tatoeba:1234567"), for attribution links.
ALTER TABLE example_sentences ADD COLUMN source_ref TEXT;

-- Practice outside the spaced-repetition schedule: drilling table forms and filling sentence gaps.
-- Answers are graded on the server; op_id makes a retried upload count once.
CREATE TABLE practice_attempts (
  id INTEGER PRIMARY KEY,
  op_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  mode TEXT NOT NULL,                        -- forms | cloze
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  cell TEXT,                                 -- forms: the cell asked for ("gen|pl"); cloze: the target's cell, when known
  sentence_id INTEGER REFERENCES example_sentences(id) ON DELETE SET NULL,
  response TEXT,
  grade TEXT NOT NULL,                       -- correct | close | incorrect | revealed
  expected TEXT,
  answered_at INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  device_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_practice_lang ON practice_attempts(language_code, mode, answered_at);
CREATE INDEX idx_practice_entry ON practice_attempts(entry_id, mode, cell);
CREATE INDEX idx_practice_sentence ON practice_attempts(sentence_id);
