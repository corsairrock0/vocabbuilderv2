// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useRef, useState } from 'react';
import { LuVolume2, LuPause, LuRotateCcw, LuExternalLink, LuEllipsis } from 'react-icons/lu';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/basics.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/menu.tsx';
import { cn } from '../../lib/utils.ts';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import type { AudioSource } from '../../../../shared/types.ts';
import { playSource, setRate, stopAudio, useAudioLookup, usePlayer } from '../../lib/audio.ts';
import { langSettings, settings, updateLanguageSettings } from '../../lib/store.ts';
import { post } from '../../lib/api.ts';

const KIND_LABEL: Record<AudioSource['kind'], string> = {
  human: 'Native-speaker recording',
  synthesized: 'Synthesized voice',
  user: 'Your recording',
  unverified: 'Unverified source',
};

export interface AudioHandle {
  play: () => void;
  available: boolean;
}

/**
 * Pronunciation controls for one word. `variant="hero"` is the large tap target used by
 * listening exercises; `"inline"` is the compact button used on cards and feedback.
 */
export function AudioControls({
  entryId,
  language,
  variant = 'inline',
  autoPlay = false,
  showDetails = true,
  handleRef,
  onAvailability,
}: {
  entryId: number;
  language: LanguageCode;
  variant?: 'hero' | 'inline';
  autoPlay?: boolean;
  showDetails?: boolean;
  handleRef?: { current: AudioHandle | null };
  onAvailability?: (available: boolean, loading: boolean) => void;
}) {
  const { lookup, sources, loading, error } = useAudioLookup(entryId);
  const player = usePlayer();
  const ls = langSettings(language);
  const [rate, setRateState] = useState(ls?.playbackRate ?? 1);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const autoplayed = useRef(false);
  const source = sources.find((s) => s.id === sourceId) ?? sources[0] ?? null;
  const isMine = player.entryId === entryId && player.sourceId === source?.id;
  const playing = isMine && player.playing;

  useEffect(() => {
    onAvailability?.(!!source, loading);
  }, [!!source, loading]);

  const play = () => {
    if (!source) return;
    void playSource(entryId, source, rate, lookup);
  };
  if (handleRef) handleRef.current = { play, available: !!source };

  useEffect(() => {
    if (autoPlay && source && !autoplayed.current && (settings().audioAutoplay || variant === 'hero')) {
      autoplayed.current = true;
      void playSource(entryId, source, rate, lookup);
    }
  }, [autoPlay, source?.id]);

  useEffect(() => () => {
    if (player.entryId === entryId) stopAudio();
  }, [entryId]);

  const changeRate = (r: number) => {
    setRateState(r);
    setRate(r);
    if (ls && ls.playbackRate !== r) void updateLanguageSettings(language, { playbackRate: r });
  };

  const choose = (s: AudioSource) => {
    setSourceId(s.id);
    setMenu(false);
    void playSource(entryId, s, rate, lookup);
    if (s.provider !== 'tts') post(`/api/audio/${entryId}/preferred`, { sourceId: s.id }).catch(() => undefined);
  };

  if (loading && !lookup) {
    return variant === 'hero' ? <Skeleton className="mx-auto size-24 rounded-full" aria-label="Loading audio" /> : <Skeleton className="inline-block size-11 rounded-full" />;
  }

  if (!source) {
    if (variant === 'inline' && !showDetails) return null;
    const msg =
      error === 'offline'
        ? 'Audio is unavailable offline (Forvo recordings are never stored on your devices).'
        : lookup?.status === 'not_configured'
          ? 'No pronunciation source configured yet.'
          : lookup?.status === 'quota_exceeded'
            ? 'Daily Forvo limit reached.'
            : 'No recording found for this word.';
    return (
      <p className="text-sm text-muted-foreground">
        {msg}{' '}
        {lookup?.forvoPageUrl && error !== 'offline' && (
          <a className="underline underline-offset-2" href={lookup.forvoPageUrl} target="_blank" rel="noopener noreferrer">
            Look it up on Forvo
          </a>
        )}
      </p>
    );
  }

  const slowNote = LANGUAGES[language].slowedAudioNote;
  const hero = variant === 'hero';
  return (
    <div className={hero ? 'flex flex-col items-center gap-3' : 'flex flex-wrap items-center gap-1.5'}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => (playing ? stopAudio() : play())}
          className={cn(
            'grid shrink-0 place-items-center rounded-full border bg-card text-foreground shadow-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-accent',
            hero ? 'size-24 border-2' : 'size-11',
            playing && 'playing border-lang text-lang',
          )}
          aria-label={playing ? 'Stop pronunciation' : 'Play pronunciation (R)'}
          title="Play pronunciation (R)"
        >
          {playing ? <LuPause className={hero ? 'size-9' : 'size-5'} aria-hidden="true" /> : <LuVolume2 className={hero ? 'size-10' : 'size-5'} aria-hidden="true" />}
        </button>
        {showDetails && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" aria-label="Playback options" />}>
              <LuEllipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent label="Playback options" minWidth={220}>
              <DropdownMenuItem onSelect={play}>
                <LuRotateCcw aria-hidden="true" /> Replay
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Speed</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={String(rate)} onValueChange={(v) => changeRate(Number(v))}>
                {[0.75, 1, 1.25].map((r) => (
                  <DropdownMenuRadioItem key={r} value={String(r)}>
                    {r === 1 ? 'Normal (1×)' : r < 1 ? 'Slower (0.75×)' : 'Faster (1.25×)'}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {sources.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{sources.length} recordings</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={source.id} onValueChange={(id) => { const s = sources.find((x) => x.id === id); if (s) choose(s); }}>
                    {sources.map((s) => (
                      <DropdownMenuRadioItem key={s.id} value={s.id}>
                        <span className="min-w-0">
                          <span className="block font-medium">{s.speaker ?? KIND_LABEL[s.kind]}</span>
                          <span className="block text-xs text-muted-foreground">{s.accentLabel}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {player.needsGesture && isMine && <span className="text-sm text-muted-foreground">Tap to play</span>}
      {showDetails && (
        <div className={cn('w-full text-xs text-muted-foreground', hero && 'text-center')}>
          <span className="font-medium text-foreground">{KIND_LABEL[source.kind]}</span>
          {source.speaker ? `, ${source.speaker}` : ''}. {source.accentLabel}.{rate !== 1 ? ` ${rate}×.` : ''}
          {source.provider === 'forvo' && (
            <>
              {' '}
              <a href={source.sourceUrl ?? 'https://forvo.com/'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                Pronunciations by Forvo <LuExternalLink className="size-3" aria-hidden="true" />
              </a>
            </>
          )}
          {slowNote && rate < 1 && <span className="mt-1 block text-warning">{slowNote}</span>}
        </div>
      )}
    </div>
  );
}
