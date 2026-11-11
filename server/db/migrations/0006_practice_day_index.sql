-- © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
-- Statistics (version 1.8.0): today's figures, the streak and the daily charts count practice answers per local day.
-- This index answers those counts on its own; without it every practice answer's row was read to find its day, which
-- made the dashboard figures slow after a long streak with many practice answers. Nothing else changes.
CREATE INDEX idx_practice_lang_day ON practice_attempts(language_code, local_day);
