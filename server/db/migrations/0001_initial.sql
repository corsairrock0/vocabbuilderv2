-- VocabBuilder initial schema.
-- Conventions: timestamps are INTEGER epoch milliseconds (UTC); JSON is stored as TEXT;
-- "local_day" columns are YYYY-MM-DD in the owner's configured timezone at event time.

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Single owner account (private, single-user application).
CREATE TABLE users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,                       -- SHA-256 of the session token (token itself is never stored)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  ip TEXT NOT NULL,
  username TEXT,
  success INTEGER NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);
CREATE INDEX idx_login_attempts_time ON login_attempts(attempted_at);

-- Idempotency for retried writes (client operation ids / Idempotency-Key header).
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_agent TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_sync_at INTEGER
);

CREATE TABLE languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT INTO languages (code, name, sort_order) VALUES
  ('es', 'Spanish', 1),
  ('pt', 'Portuguese', 2),
  ('vi', 'Vietnamese', 3),
  ('ru', 'Russian', 4),
  ('uk', 'Ukrainian', 5),
  ('pl', 'Polish', 6);

-- Settings: one row per key, last-writer-wins per key using server timestamps.
CREATE TABLE user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by_device TEXT
);

CREATE TABLE language_settings (
  language_code TEXT NOT NULL REFERENCES languages(code),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by_device TEXT,
  PRIMARY KEY (language_code, key)
);

-- ---------------------------------------------------------------- vocabulary

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  language_code TEXT REFERENCES languages(code),
  kind TEXT NOT NULL CHECK (kind IN ('vocabulary', 'frequency')),
  file_name TEXT,
  stored_file TEXT,
  format TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'validated', 'committed', 'failed', 'undone')),
  mapping TEXT,
  options TEXT,
  stats TEXT,
  error_report TEXT,
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  undone_at INTEGER
);

-- Provenance of vocabulary data and frequency lists.
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  language_code TEXT REFERENCES languages(code),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- curated | dictionary | user | frequency_spoken | frequency_subtitles | frequency_written | frequency_mixed
  url TEXT,
  license TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (language_code, name)
);

CREATE TABLE vocabulary_entries (
  id INTEGER PRIMARY KEY,
  language_code TEXT NOT NULL REFERENCES languages(code),
  lemma TEXT NOT NULL,                       -- dictionary headword (plain orthography)
  lemma_key TEXT NOT NULL,                   -- normalised matching key
  display TEXT,                              -- learner display form (e.g. with stress marks)
  pos TEXT NOT NULL DEFAULT 'other',
  homograph INTEGER NOT NULL DEFAULT 0,      -- separates distinct words with identical spelling and POS
  gender TEXT,
  aspect TEXT,
  aspect_pair TEXT,
  pronunciation TEXT,
  grammar TEXT,                              -- JSON {notes, ...}
  register TEXT,
  regional_note TEXT,
  image_url TEXT,
  frequency_rank INTEGER,                    -- effective rank from the preferred frequency source
  curated_order INTEGER,                     -- teaching order for curated sets (not a frequency claim)
  source_id INTEGER REFERENCES sources(id),
  import_job_id TEXT REFERENCES import_jobs(id),
  is_custom INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (language_code, lemma_key, pos, homograph)
);
CREATE INDEX idx_entries_lang_rank ON vocabulary_entries(language_code, frequency_rank);
CREATE INDEX idx_entries_lang_order ON vocabulary_entries(language_code, curated_order);
CREATE INDEX idx_entries_lang_key ON vocabulary_entries(language_code, lemma_key);
CREATE INDEX idx_entries_import ON vocabulary_entries(import_job_id);

CREATE TABLE vocabulary_senses (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  sense_order INTEGER NOT NULL,
  gloss TEXT NOT NULL,                       -- primary English meaning
  definition TEXT,
  note TEXT,
  import_job_id TEXT REFERENCES import_jobs(id),
  UNIQUE (entry_id, sense_order)
);
CREATE INDEX idx_senses_entry ON vocabulary_senses(entry_id);

CREATE TABLE vocabulary_translations (
  id INTEGER PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES vocabulary_senses(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,
  import_job_id TEXT REFERENCES import_jobs(id),
  UNIQUE (sense_id, text_key)
);
CREATE INDEX idx_translations_key ON vocabulary_translations(text_key);

CREATE TABLE vocabulary_forms (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  form_key TEXT NOT NULL,
  display TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  import_job_id TEXT REFERENCES import_jobs(id)
);
CREATE INDEX idx_forms_entry ON vocabulary_forms(entry_id);
CREATE INDEX idx_forms_key ON vocabulary_forms(form_key);

CREATE TABLE example_sentences (
  id INTEGER PRIMARY KEY,
  language_code TEXT NOT NULL REFERENCES languages(code),
  text TEXT NOT NULL,
  display TEXT,
  translation TEXT,
  source_id INTEGER REFERENCES sources(id),
  audio_url TEXT,                            -- only real, licensed sentence recordings
  audio_license TEXT,
  import_job_id TEXT REFERENCES import_jobs(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE entry_examples (
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  sentence_id INTEGER NOT NULL REFERENCES example_sentences(id) ON DELETE CASCADE,
  sense_id INTEGER REFERENCES vocabulary_senses(id) ON DELETE SET NULL,
  target TEXT,                               -- exact surface form of the word in the sentence
  target_start INTEGER,
  target_end INTEGER,
  example_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, sentence_id)
);
CREATE INDEX idx_entry_examples_sentence ON entry_examples(sentence_id);

CREATE TABLE related_expressions (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  translation TEXT,
  kind TEXT NOT NULL DEFAULT 'expression',   -- expression | collocation | related
  import_job_id TEXT REFERENCES import_jobs(id)
);
CREATE INDEX idx_expressions_entry ON related_expressions(entry_id);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE entry_tags (
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);

CREATE TABLE vocabulary_frequency (
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  rank INTEGER,
  count INTEGER,
  per_million REAL,
  matched_form TEXT,
  import_job_id TEXT REFERENCES import_jobs(id),
  PRIMARY KEY (entry_id, source_id)
);
CREATE INDEX idx_frequency_source_rank ON vocabulary_frequency(source_id, rank);

-- Personal notes and mnemonics, kept apart from imported dictionary data.
CREATE TABLE entry_user_data (
  entry_id INTEGER PRIMARY KEY REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  note TEXT,
  mnemonic TEXT,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------- pronunciation

-- Metadata only for Forvo (audio is never downloaded or cached; links are fetched live).
CREATE TABLE pronunciation_records (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('forvo', 'user', 'licensed')),
  provider_ref TEXT,                         -- Forvo pronunciation id
  word TEXT NOT NULL,
  speaker TEXT,
  speaker_sex TEXT,
  speaker_country TEXT,
  rating INTEGER,
  votes INTEGER,
  positive_votes INTEGER,
  audio_kind TEXT NOT NULL CHECK (audio_kind IN ('human', 'synthesized', 'user', 'unverified')),
  file_name TEXT,                            -- user uploads / explicitly licensed files only
  mime_type TEXT,
  byte_size INTEGER,
  license TEXT,
  created_at INTEGER NOT NULL,
  metadata_fetched_at INTEGER,
  UNIQUE (provider, provider_ref)
);
CREATE INDEX idx_pron_entry ON pronunciation_records(entry_id);

CREATE TABLE pronunciation_preferences (
  entry_id INTEGER PRIMARY KEY REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  record_id INTEGER REFERENCES pronunciation_records(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

-- The owner's own judgements about speakers (e.g. "Saigon accent — verified by me").
CREATE TABLE speaker_profiles (
  language_code TEXT NOT NULL REFERENCES languages(code),
  provider TEXT NOT NULL,
  speaker TEXT NOT NULL,
  preference TEXT NOT NULL DEFAULT 'neutral' CHECK (preference IN ('preferred', 'neutral', 'avoid')),
  accent_note TEXT,
  verified_by_user INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (language_code, provider, speaker)
);

-- Result of the last pronunciation lookup per word (avoids repeated API calls for words without recordings).
CREATE TABLE audio_lookups (
  entry_id INTEGER NOT NULL REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('found', 'none', 'error')),
  found_count INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, provider)
);

CREATE TABLE provider_usage (
  provider TEXT NOT NULL,
  usage_day TEXT NOT NULL,                   -- provider quota day (Forvo resets at 22:00 UTC)
  api_requests INTEGER NOT NULL DEFAULT 0,
  audio_plays INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, usage_day)
);

-- ---------------------------------------------------------------- learning state

CREATE TABLE learning_items (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL UNIQUE REFERENCES vocabulary_entries(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'introduced', 'active', 'known', 'suspended')),
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_difficult INTEGER NOT NULL DEFAULT 0,   -- manual flag (automatic difficulty comes from lapses/D)
  introduced_at INTEGER,
  introduced_day TEXT,
  first_scheduled_at INTEGER,
  last_studied_at INTEGER,
  times_forgotten INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_items_lang_status ON learning_items(language_code, status);

-- Separate FSRS memory states for recognition (receptive) and recall (productive).
CREATE TABLE fsrs_cards (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  skill TEXT NOT NULL CHECK (skill IN ('receptive', 'productive')),
  state INTEGER NOT NULL DEFAULT 0,          -- 0 new, 1 learning, 2 review, 3 relearning
  step INTEGER,
  stability REAL,
  difficulty REAL,
  due INTEGER,
  last_review INTEGER,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'FSRS-6',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE (item_id, skill)
);
CREATE INDEX idx_cards_lang_due ON fsrs_cards(language_code, state, due);

-- Complete scheduling history. At most one scheduling event per card per local day;
-- further same-day exercises are practice attempts (exercise_attempts).
CREATE TABLE review_logs (
  id INTEGER PRIMARY KEY,
  op_id TEXT NOT NULL UNIQUE,
  card_id INTEGER NOT NULL REFERENCES fsrs_cards(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  skill TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  rating_source TEXT NOT NULL,               -- auto | self | adjusted | aggregate
  reviewed_at INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  state_before INTEGER NOT NULL,
  stability_before REAL,
  difficulty_before REAL,
  due_before INTEGER,
  elapsed_days INTEGER,
  retrievability_before REAL,
  state_after INTEGER NOT NULL,
  stability_after REAL NOT NULL,
  difficulty_after REAL NOT NULL,
  due_after INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  exercise_kind TEXT,
  attempt_id INTEGER,
  session_id TEXT,
  device_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_reviews_card_time ON review_logs(card_id, reviewed_at);
CREATE INDEX idx_reviews_lang_day ON review_logs(language_code, local_day);
CREATE UNIQUE INDEX uq_reviews_card_day ON review_logs(card_id, local_day);

CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,                       -- client-generated UUID
  language_code TEXT NOT NULL REFERENCES languages(code),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'active', 'paused', 'completed', 'abandoned')),
  mode TEXT NOT NULL,
  config TEXT NOT NULL,
  plan_meta TEXT NOT NULL,
  resources TEXT NOT NULL,                   -- snapshot of the vocabulary needed to run the session (offline-capable)
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  last_activity_at INTEGER,
  ended_at INTEGER,
  active_ms INTEGER NOT NULL DEFAULT 0,
  device_id TEXT,
  summary TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sessions_lang_status ON study_sessions(language_code, status, last_activity_at);

CREATE TABLE session_exercises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  seq REAL NOT NULL,
  stage TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  card_skill TEXT,
  kind TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'core',
  origin TEXT NOT NULL DEFAULT 'plan',
  parent_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  completed_at INTEGER,
  attempt_id INTEGER
);
CREATE INDEX idx_session_ex_session ON session_exercises(session_id, seq);
CREATE INDEX idx_session_ex_item ON session_exercises(item_id);

CREATE TABLE exercise_attempts (
  id INTEGER PRIMARY KEY,
  op_id TEXT NOT NULL UNIQUE,
  session_id TEXT REFERENCES study_sessions(id) ON DELETE SET NULL,
  exercise_id TEXT,
  item_id INTEGER NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  kind TEXT NOT NULL,
  skill TEXT NOT NULL,
  card_skill TEXT,
  stage TEXT,
  response TEXT,
  grade TEXT NOT NULL CHECK (grade IN ('correct', 'close', 'incorrect', 'self')),
  feedback_code TEXT,
  score REAL NOT NULL,
  hints_used INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  self_rating INTEGER,
  suggested_rating INTEGER,
  final_rating INTEGER,
  override INTEGER NOT NULL DEFAULT 0,
  counted_as_review INTEGER NOT NULL DEFAULT 0,
  review_log_id INTEGER REFERENCES review_logs(id) ON DELETE SET NULL,
  answered_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  local_day TEXT NOT NULL,
  device_id TEXT,
  offline INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_attempts_item ON exercise_attempts(item_id, answered_at);
CREATE INDEX idx_attempts_session ON exercise_attempts(session_id);
CREATE INDEX idx_attempts_lang_day ON exercise_attempts(language_code, local_day);
CREATE INDEX idx_attempts_lang_kind ON exercise_attempts(language_code, kind, answered_at);

CREATE TABLE skill_evidence (
  item_id INTEGER NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  delayed_correct INTEGER NOT NULL DEFAULT 0,  -- correct on a later day than the word was introduced
  streak INTEGER NOT NULL DEFAULT 0,
  ewma REAL NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_correct_at INTEGER,
  last_incorrect_at INTEGER,
  PRIMARY KEY (item_id, skill)
);

CREATE TABLE daily_stats (
  language_code TEXT NOT NULL,
  local_day TEXT NOT NULL,
  study_ms INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  reviews_passed INTEGER NOT NULL DEFAULT 0,
  introduced INTEGER NOT NULL DEFAULT 0,
  listening_attempts INTEGER NOT NULL DEFAULT 0,
  listening_correct INTEGER NOT NULL DEFAULT 0,
  production_attempts INTEGER NOT NULL DEFAULT 0,
  production_correct INTEGER NOT NULL DEFAULT 0,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (language_code, local_day)
);
