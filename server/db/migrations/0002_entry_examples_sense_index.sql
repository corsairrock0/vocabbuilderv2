-- Deleting a sense sets entry_examples.sense_id to NULL. Without an index, SQLite scans every example link for each
-- deleted sense, which made undoing a 6,000-word import with example sentences take several seconds.
CREATE INDEX IF NOT EXISTS idx_entry_examples_sense ON entry_examples(sense_id);
