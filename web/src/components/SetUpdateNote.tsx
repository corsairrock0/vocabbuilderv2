// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// A line saying that the language's word set has an update (corrections, tables or sentences shipped with a new
// version of the app), with a link to Settings → Data, where the update keeps the learner's progress. Shown on Home
// and on the study start screen, so a word studied before the update is not taken for one the update leaves as it was.
import { LANGUAGES, type LanguageCode } from '../../../shared/languages.ts';
import { Link } from '../lib/router.tsx';
import { useApp } from '../lib/store.ts';
import { LuRefreshCw } from 'react-icons/lu';
import { cn } from '../lib/utils.ts';
import { Alert, AlertDescription } from './ui/alert.tsx';

export function SetUpdateNote({ language, className = '' }: { language: LanguageCode; className?: string }) {
  const ready = useApp((s) => s.boot?.languages.find((l) => l.code === language)?.frequencySet?.updateAvailable ?? false);
  if (!ready) return null;
  return (
    <Alert variant="info" className={cn('text-sm', className)} data-testid="set-update">
      <LuRefreshCw aria-hidden="true" />
      <AlertDescription className="text-foreground/85">
        <p>
          An update to your {LANGUAGES[language].name} words is ready, with corrections and word tables; your progress is kept.{' '}
          <Link to="/settings/data" className="font-medium text-primary underline underline-offset-2">
            Update the word set
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}
