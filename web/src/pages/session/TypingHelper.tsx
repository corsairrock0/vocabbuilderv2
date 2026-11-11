// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useState } from 'react';
import { LuKeyboard } from 'react-icons/lu';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { applyTone, VI_TONE_KEYS } from '../../../../shared/vietnamese.ts';
import { settings, updateSettings } from '../../lib/store.ts';
import { Button } from '../../components/ui/button.tsx';

// Vietnamese letters a phone keyboard may lack; the tones are keys of their own (shared/vietnamese.ts).
const VI_LETTERS = ['ă', 'â', 'ê', 'ô', 'ơ', 'ư', 'đ'];

/** Insert text at the caret of an input/textarea, keeping React state in sync. */
export function insertAtCaret(el: HTMLInputElement | HTMLTextAreaElement | null, text: string, setValue: (v: string) => void, backspace = false) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  let value: string;
  let caret: number;
  if (backspace) {
    const from = start === end ? Math.max(0, start - 1) : start;
    value = el.value.slice(0, from) + el.value.slice(end);
    caret = from;
  } else {
    value = el.value.slice(0, start) + text + el.value.slice(end);
    caret = start + text.length;
  }
  setValue(value);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(caret, caret);
  });
}

/** Put a Vietnamese tone on the syllable before the caret (or take it off), keeping React state in sync. */
function toneAtCaret(el: HTMLInputElement | HTMLTextAreaElement | null, mark: string, setValue: (v: string) => void) {
  if (!el) return;
  const { text, caret } = applyTone(el.value, el.selectionStart ?? el.value.length, mark);
  setValue(text);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(caret, caret);
  });
}

/** On-screen helper for characters that may be missing from the device keyboard. */
export function TypingHelper({ language, inputRef, setValue }: { language: LanguageCode | 'en'; inputRef: { current: HTMLInputElement | HTMLTextAreaElement | null }; setValue: (v: string) => void }) {
  const [full, setFull] = useState(settings().onScreenKeyboard);
  if (language === 'en') return null;
  const profile = LANGUAGES[language];
  const press = (c: string) => insertAtCaret(inputRef.current, c, setValue);
  const keyClass = 'min-h-11 min-w-11 shrink-0 rounded-lg border bg-card px-2 text-lg shadow-xs outline-none transition-colors active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-accent';
  return (
    <div className="mt-3 space-y-2" onMouseDown={(e) => e.preventDefault()}>
      {profile.keyboardRows && full ? (
        <div className="space-y-1.5" role="group" aria-label={`${profile.name} keyboard`}>
          {profile.keyboardRows.map((row, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-1">
              {row.map((c) => (
                <button key={c} type="button" className={`${keyClass} word`} onClick={() => press(c)}>
                  {c}
                </button>
              ))}
            </div>
          ))}
          <div className="flex justify-center gap-1">
            <button type="button" className={`${keyClass} px-6 text-sm`} onClick={() => press(' ')}>
              space
            </button>
            <button type="button" className={`${keyClass} px-4 text-sm`} onClick={() => insertAtCaret(inputRef.current, '', setValue, true)} aria-label="Delete">
              ⌫
            </button>
          </div>
        </div>
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0" role="group" aria-label="Special characters">
          {(language === 'vi' ? VI_LETTERS : profile.helperChars).map((c) => (
            <button key={c} type="button" className={`${keyClass} word`} onClick={() => press(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {language === 'vi' && (
        <div>
          <div className="flex flex-wrap justify-center gap-1" role="group" aria-label="Tones">
            {VI_TONE_KEYS.map((t) => (
              <button
                key={t.name}
                type="button"
                className={`${keyClass} flex min-w-14 flex-col items-center leading-tight`}
                title={`${t.name}: ${t.sound} tone`}
                aria-label={`Tone ${t.name} (${t.sound})`}
                onClick={() => toneAtCaret(inputRef.current, t.mark, setValue)}
              >
                <span className="word text-xl" aria-hidden="true">
                  {`a${t.mark}`.normalize('NFC')}
                </span>
                <span className="text-[0.7rem] text-muted-foreground">{t.name}</span>
              </button>
            ))}
          </div>
          <p className="hint mt-1 text-center">Type the word, then tap its tone: it goes on the right vowel.</p>
        </div>
      )}
      {profile.keyboardRows && (
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setFull(!full);
              void updateSettings({ onScreenKeyboard: !full });
            }}
          >
            <LuKeyboard aria-hidden="true" /> {full ? 'Hide keyboard' : `Show ${profile.name} keyboard`}
          </Button>
        </div>
      )}
    </div>
  );
}
