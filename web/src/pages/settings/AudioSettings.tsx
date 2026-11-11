// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useState } from 'react';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { get, put } from '../../lib/api.ts';
import { ttsVoices } from '../../lib/audio.ts';
import { langSettings, toast, updateLanguageSettings, useApp } from '../../lib/store.ts';
import { Segmented, Toggle } from '../../components/ui.tsx';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { RadioGroup, RadioGroupItem } from '../../components/ui/controls.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../../components/ui/input-group.tsx';
import { Group, LanguageSelect, Setting } from './parts.tsx';

interface Speaker {
  speaker: string;
  preference: 'preferred' | 'neutral' | 'avoid';
  accentNote: string | null;
  verifiedByUser: number;
}

export function AudioSettings() {
  const code = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const forvo = useApp((s) => s.boot?.forvo);
  useApp((s) => s.boot?.languageSettings[code]);
  const ls = langSettings(code)!;
  const profile = LANGUAGES[code];
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [usage, setUsage] = useState<{ apiRequests: number; audioPlays: number; limit: number; remaining: number } | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [newSpeaker, setNewSpeaker] = useState({ speaker: '', accentNote: '', preference: 'preferred' as Speaker['preference'], verified: true });
  const load = () => get<Speaker[]>(`/api/audio/speakers?lang=${code}`).then(setSpeakers).catch(() => undefined);
  useEffect(() => {
    void load();
    get<any>('/api/audio/usage').then(setUsage).catch(() => undefined);
    const update = () => setVoices(ttsVoices(profile.ttsLocales));
    update();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener?.('voiceschanged', update);
    return () => {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.removeEventListener?.('voiceschanged', update);
    };
  }, [code]);
  if (!ls) return null;
  const saveSpeaker = async (s: { speaker: string; preference: Speaker['preference']; accentNote: string | null; verifiedByUser: boolean }) => {
    await put('/api/audio/speakers', { language: code, ...s });
    toast('Speaker preference saved.', 'good');
    void load();
  };

  return (
    <div data-lang={code} className="flex flex-col gap-5">
      <LanguageSelect value={code} />
      <Alert variant={forvo?.configured ? 'default' : 'info'}>
        <AlertDescription>
          {forvo?.configured ? (
            <p>
              Forvo native-speaker recordings are on.
              {usage && ` Today: ${usage.apiRequests} lookups and ${usage.audioPlays} plays of your daily limit of ${usage.limit} (resets 22:00 UTC).`}
            </p>
          ) : (
            <p>
              Forvo is not set up. Add <code>VB_FORVO_API_KEY</code> to the server’s <code>.env</code> and restart to turn on native-speaker recordings. Until then you can upload your own recordings on any word’s page, or turn on device speech below.
            </p>
          )}
          <p className="mt-1">Forvo audio is streamed from Forvo when you press play and is never downloaded or cached, as its terms require. Each play counts toward your API quota.</p>
        </AlertDescription>
      </Alert>

      <Group title="Accent" description="Recordings are labelled only with what can be checked: a speaker’s country, never a city, unless you verify a speaker yourself below.">
        <RadioGroup value={ls.accent} onValueChange={(accent) => void updateLanguageSettings(code, { accent })} aria-label="Preferred accent" className="gap-2">
          {profile.accents.map((a) => (
            <FieldLabel key={a.id} htmlFor={`accent-${a.id}`}>
              <Field orientation="horizontal" data-state={ls.accent === a.id ? 'checked' : 'unchecked'}>
                <FieldContent>
                  <FieldTitle>{a.label}</FieldTitle>
                  <FieldDescription>{a.description}</FieldDescription>
                </FieldContent>
                <RadioGroupItem value={a.id} id={`accent-${a.id}`} />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
      </Group>

      <Group title="Playback">
        <Setting label="Speed" hint={profile.slowedAudioNote || undefined}>
          <Segmented label="Playback speed" value={ls.playbackRate} onChange={(playbackRate) => void updateLanguageSettings(code, { playbackRate })} options={[{ value: 0.75, label: '0.75×' }, { value: 1, label: '1×' }, { value: 1.25, label: '1.25×' }]} />
        </Setting>
        <div className="border-t">
          <Toggle label="Use device speech when there is no recording" hint="A synthesized voice is always labelled as one, never as a native recording." checked={ls.ttsFallback} onChange={(ttsFallback) => void updateLanguageSettings(code, { ttsFallback })} />
        </div>
        {ls.ttsFallback && (
          <Setting label="Voice on this device" htmlFor="voice" hint={voices.length === 0 ? `This device reports no ${profile.name} voices.` : undefined}>
            <NativeSelect id="voice" value={ls.ttsVoice ?? ''} onChange={(e) => void updateLanguageSettings(code, { ttsVoice: (e.target as HTMLSelectElement).value || null })}>
              <NativeSelectOption value="">Best match for {profile.ttsLocales.join(', ')}</NativeSelectOption>
              {voices.map((v) => (
                <NativeSelectOption key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Setting>
        )}
      </Group>

      <Group title="Forvo speakers" description="Mark speakers you like (their recordings are chosen first) or want to avoid. If you have listened and are sure of a speaker’s regional accent, note it: the label will say “verified by you”.">
        {speakers.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {speakers.map((s) => (
              <li key={s.speaker} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="font-medium">{s.speaker}</span>
                  {s.accentNote && (
                    <span className="block text-sm text-muted-foreground">
                      {s.accentNote}
                      {s.verifiedByUser ? ' (verified by you)' : ''}
                    </span>
                  )}
                </span>
                <NativeSelect
                  size="sm"
                  aria-label={`Preference for ${s.speaker}`}
                  value={s.preference}
                  onChange={(e) => void saveSpeaker({ speaker: s.speaker, preference: (e.target as HTMLSelectElement).value as Speaker['preference'], accentNote: s.accentNote, verifiedByUser: !!s.verifiedByUser })}
                >
                  <NativeSelectOption value="preferred">Preferred</NativeSelectOption>
                  <NativeSelectOption value="neutral">Neutral</NativeSelectOption>
                  <NativeSelectOption value="avoid">Avoid</NativeSelectOption>
                </NativeSelect>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newSpeaker.speaker.trim()) return;
            void saveSpeaker({ speaker: newSpeaker.speaker.trim(), preference: newSpeaker.preference, accentNote: newSpeaker.accentNote || null, verifiedByUser: !!newSpeaker.accentNote && newSpeaker.verified });
            setNewSpeaker({ speaker: '', accentNote: '', preference: 'preferred', verified: true });
          }}
        >
          <Input placeholder="Forvo username" value={newSpeaker.speaker} onChange={(e) => setNewSpeaker({ ...newSpeaker, speaker: (e.target as HTMLInputElement).value })} aria-label="Forvo username" autoComplete="off" />
          <Input
            placeholder={code === 'vi' ? 'Accent, e.g. Southern (Saigon)' : 'Accent you verified (optional)'}
            value={newSpeaker.accentNote}
            onChange={(e) => setNewSpeaker({ ...newSpeaker, accentNote: (e.target as HTMLInputElement).value })}
            aria-label="Accent note"
            autoComplete="off"
          />
          <Button type="submit" variant="outline" className="h-11">
            Save
          </Button>
        </form>
      </Group>
    </div>
  );
}
