// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** The type of a question in a Comprehensive session's mix (shared/mix.ts), with its icon: on the question, in "Coming up" and on the start screen. */
import type { IconType } from 'react-icons';
import { LuAlignLeft, LuBookOpen, LuHeadphones, LuImage, LuLayers, LuMic, LuPenLine, LuPlus, LuRotateCcw, LuTextCursorInput } from 'react-icons/lu';
import { TYPE_INFO, type QuestionType } from '../../../../shared/mix.ts';
import { Badge } from '../../components/ui/badge.tsx';

export const TYPE_ICONS: Record<QuestionType, IconType> = {
  review: LuRotateCcw,
  new: LuPlus,
  listening: LuHeadphones,
  grammar: LuAlignLeft,
  sentences: LuTextCursorInput,
  pictures: LuImage,
  speaking: LuMic,
  reading: LuBookOpen,
  writing: LuPenLine,
};

/** Icons for the skills on Home and the start screen ("words" covers reviews and new words). */
export const SKILL_ICONS: Record<string, IconType> = { ...TYPE_ICONS, words: LuLayers };

/** "Listening" with its icon, above a question; `note` follows it (another try at a missed word). */
export function TypeLabel({ type, note }: { type: QuestionType; note?: string | null }) {
  const Icon = TYPE_ICONS[type];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-question-type={type}>
      <Badge variant="soft" className="h-7 gap-1.5 px-2.5 text-[0.8125rem] font-semibold [&>svg]:size-3.5">
        <Icon aria-hidden="true" />
        {TYPE_INFO[type].name}
      </Badge>
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
    </div>
  );
}

/** The types coming up next, as small badges. */
export function ComingUp({ types }: { types: QuestionType[] }) {
  if (!types.length) return null;
  return (
    <div className="mt-8 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground" data-testid="coming-up">
      <span className="mr-1">Coming up</span>
      {types.map((t, i) => {
        const Icon = TYPE_ICONS[t];
        return (
          <Badge key={`${t}-${i}`} variant="outline" className="h-6 gap-1 bg-card font-normal text-muted-foreground">
            <Icon aria-hidden="true" />
            {TYPE_INFO[t].name}
          </Badge>
        );
      })}
    </div>
  );
}
