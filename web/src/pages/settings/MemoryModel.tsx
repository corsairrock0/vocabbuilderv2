// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Your memory model (2.0.0), in Settings → Learning → Memory. Reviews are timed with a model of how memory fades. It
 * starts out the same for everyone; with enough reviews in a language it can be fitted to the learner, and is used
 * only when it predicts their latest reviews better than the standard one (server/learning/memory-model.ts). The card
 * says where the learner stands in plain words: how many reviews there are of the number needed, what the last fit
 * found, and which model is timing reviews now.
 */
import { useEffect, useState } from 'react';
import { LuBrain, LuCheck } from 'react-icons/lu';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import type { MemoryFit, MemoryModelChange, MemoryModelStatus } from '../../../../shared/settings.ts';
import { ApiError, get, post } from '../../lib/api.ts';
import { count, date, pct, plural } from '../../lib/format.ts';
import { loadBootstrap, setLocalLanguageSettings, toast } from '../../lib/store.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Progress, Skeleton, Spinner } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';

/**
 * What the last fit found, in words. The fitted model is judged on the latest reviews, which it has not seen, by how
 * far its predictions were from the answers (log loss) next to the standard model's.
 */
function found(fit: MemoryFit): string {
  const latest = `your latest ${plural(fit.judgedOn, 'review')}`;
  if (fit.status !== 'better') return `Checked on ${date(fit.at)} with ${plural(fit.reviews, 'review')}: a model fitted to you predicted ${latest} no better than the standard model, so the standard model is in use.`;
  const gain = 1 - fit.fittedLoss / fit.standardLoss;
  const head = `Fitted on ${date(fit.at)} to ${plural(fit.reviews, 'review')}. On ${latest}, which it had not seen, its predictions were ${pct(gain, gain < 0.1 ? 1 : 0)} closer to your answers than the standard model's.`;
  // The averages are shown when they tell the same story: what you remembered, and what each model expected.
  const closer = Math.abs(fit.fittedPredicted - fit.recalled) + 0.01 <= Math.abs(fit.standardPredicted - fit.recalled);
  return closer ? `${head} You remembered ${pct(fit.recalled)}; the standard model expected ${pct(fit.standardPredicted)}, yours ${pct(fit.fittedPredicted)}.` : head;
}

export function MemoryModel({ code }: { code: LanguageCode }) {
  const [status, setStatus] = useState<MemoryModelStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'fit' | 'reset' | null>(null);
  const name = LANGUAGES[code].name;
  useEffect(() => {
    let alive = true;
    setStatus(null);
    setError(null);
    get<MemoryModelStatus>(`/api/languages/${code}/memory-model`)
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setError(e instanceof ApiError && e.isNetwork ? 'Connect to your server to see your memory model.' : e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [code]);

  const change = async (what: 'fit' | 'reset') => {
    setBusy(what);
    try {
      const r = await post<MemoryModelChange>(`/api/languages/${code}/memory-model/${what}`);
      setStatus(r);
      setLocalLanguageSettings(code, { fsrsParameters: r.settings.fsrsParameters, fsrsFit: r.settings.fsrsFit });
      const due = r.dueAfter === r.dueBefore ? `${plural(r.dueAfter, 'word')} due today, as before` : `${plural(r.dueAfter, 'word')} due today (${count(r.dueBefore)} before)`;
      if (r.outcome === 'fitted') toast(`Your memory model is timing your ${name} reviews now. ${due}.`, 'good');
      else if (r.outcome === 'reset') toast(`Back to the standard model for ${name}. ${due}.`, 'good');
      else if (r.outcome === 'reverted') toast(`A fitted model no longer predicts your ${name} reviews better: the standard model is in use again. ${due}.`);
      else if (r.outcome === 'kept') toast(`The standard model already fits your ${name} reviews: nothing changed.`);
      else toast(`Not enough ${name} reviews yet.`);
      // The words due changed with the model: Today and the language menu show them.
      if (r.rescheduled) void loadBootstrap();
    } catch (e) {
      toast(e instanceof ApiError && e.isNetwork ? 'Connect to your server to change your memory model.' : e instanceof Error ? e.message : 'Could not change the memory model', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const personal = status?.model === 'personal';
  const enough = !!status && status.reviews >= status.needed;
  const fit = status?.lastFit ?? null;
  return (
    <section aria-labelledby="memory-model-title" className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4" data-testid="memory-model" data-model={status?.model}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id="memory-model-title" className="flex items-center gap-2 text-[0.9375rem] font-medium">
          <LuBrain className="size-4 text-muted-foreground" aria-hidden="true" /> Your memory model
        </h3>
        {status && (
          <Badge variant={personal ? 'soft' : 'secondary'} data-testid="memory-model-state">
            {personal && <LuCheck aria-hidden="true" />}
            {personal ? 'Fitted to you' : 'Standard'}
          </Badge>
        )}
      </div>
      <p className="text-sm leading-normal text-muted-foreground">
        Reviews are timed with a model of how memory fades. It starts out the same for everyone. With enough reviews it can be fitted to your own answers, and it is used only if it then predicts your latest
        reviews better.
      </p>
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : !status ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <>
          {!enough && (
            <div className="flex flex-col gap-1.5">
              <Progress value={(status.reviews / Math.max(1, status.needed)) * 100} aria-label={`${name} reviews toward a fit`} className="h-1.5" />
              <p className="text-sm tabular-nums" data-testid="memory-model-progress">
                {count(status.reviews)} of {count(status.needed)} {name} reviews
              </p>
              <p className="text-sm text-muted-foreground">A review counts here when it comes a day or more after the one before it.</p>
            </div>
          )}
          {fit && (
            <p className="text-sm leading-normal" data-testid="memory-model-fit">
              {found(fit)}
            </p>
          )}
          {enough && !fit && (
            <p className="text-sm leading-normal">
              You have {plural(status.reviews, 'review')} in {name}: enough to fit the model to you.
            </p>
          )}
          {(enough || personal) && (
            <div className="flex flex-wrap gap-2">
              {enough && (
                <Button variant={personal || fit ? 'outline' : 'default'} size="sm" disabled={!!busy} aria-busy={busy === 'fit' || undefined} onClick={() => void change('fit')}>
                  {busy === 'fit' && <Spinner />}
                  {busy === 'fit' ? 'Fitting' : personal ? 'Fit again' : fit ? 'Check again' : 'Fit to my reviews'}
                </Button>
              )}
              {personal && (
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void change('reset')}>
                  {busy === 'reset' && <Spinner />}
                  Use the standard model
                </Button>
              )}
            </div>
          )}
          <p className="text-xs leading-normal text-muted-foreground">
            The model is FSRS-6. Fitting it re-times your {name} reviews from your whole history; going back to the standard model undoes that exactly.
          </p>
        </>
      )}
    </section>
  );
}
