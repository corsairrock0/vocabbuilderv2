// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useState } from 'react';
import { LuRepeat } from 'react-icons/lu';
import { LANGUAGES, type LanguageCode } from '../../../shared/languages.ts';
import { ApiError } from '../lib/api.ts';
import { Link, navigate } from '../lib/router.tsx';
import { loadBootstrap, setActiveLanguage, toast, useApp } from '../lib/store.ts';
import { count, relative } from '../lib/format.ts';
import { Empty, PageHeader, PageLoading } from '../components/ui.tsx';
import { Button } from '../components/ui/button.tsx';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '../components/ui/item.tsx';
import { startSession } from './session/runtime.ts';

export function ReviewPage() {
  const boot = useApp((s) => s.boot);
  const [busy, setBusy] = useState<LanguageCode | null>(null);
  useEffect(() => {
    void loadBootstrap();
  }, []);
  if (!boot) return <PageLoading />;
  const due = boot.languages.filter((l) => l.stats.due > 0);
  const review = async (code: LanguageCode) => {
    setBusy(code);
    setActiveLanguage(code);
    try {
      const id = await startSession({ language: code, mode: 'review', quick: true });
      navigate(`/study/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_session_exists') navigate(`/study/${(err.details as any).sessionId}`);
      else toast(err instanceof Error ? err.message : 'Could not start the review', 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Review"
        description="The words most at risk of being forgotten come first, with recognising and recalling scheduled separately. Each memory of a word is reviewed at most once a day, in a session or on the Practice pages."
      />
      {due.length === 0 ? (
        <Empty icon={<LuRepeat />} title="Nothing is due">
          Your next reviews show here when they are due.
          {boot.overview.dueTotal === 0 && ' Learn some new words to have reviews to do.'}
        </Empty>
      ) : (
        <ul className="grid gap-3">
          {due.map((l) => (
            <li key={l.code} data-lang={l.code}>
              <Item variant="outline" className="shadow-xs">
                <ItemMedia className="text-2xl" aria-hidden="true">
                  {LANGUAGES[l.code].flag}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    <h2 className="word text-xl font-normal">{LANGUAGES[l.code].nativeName}</h2>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {count(l.stats.dueReceptive)} to recognise and {count(l.stats.dueProductive)} to recall. Last studied {relative(l.stats.lastStudiedAt)}.
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="max-sm:basis-full">
                  <Button variant="ghost" render={<Link to="/words?due=1" onClick={() => setActiveLanguage(l.code)} />}>
                    See the words
                  </Button>
                  <Button variant="lang" className="max-sm:flex-1" disabled={busy === l.code} onClick={() => void review(l.code)}>
                    <LuRepeat aria-hidden="true" /> Review {count(l.stats.due)}
                  </Button>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
