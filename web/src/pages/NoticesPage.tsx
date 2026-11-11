// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import type { ReactNode } from 'react';
import { Link } from '../lib/router.tsx';
import { COPYRIGHT } from '../lib/brand.ts';
import { Button } from '../components/ui/button.tsx';

interface Notice {
  name: string;
  url: string;
  what: string;
  licence: string;
  licenceUrl?: string;
  credit?: ReactNode;
}

const CC_BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/';
const CC_BY_SA_3 = 'https://creativecommons.org/licenses/by-sa/3.0/';

/** Content the word lists, meanings, sentences and tables come from (docs/FREQUENCY_SETS.md has the full detail). */
const CONTENT: Notice[] = [
  {
    name: 'English Wiktionary (via Kaikki.org / Wiktextract)',
    url: 'https://en.wiktionary.org/',
    what: 'Word meanings, shortened, corrected and reviewed for VocabBuilder. The adapted meanings are shared under the same licence.',
    licence: 'CC BY-SA 4.0 (also GFDL)',
    licenceUrl: CC_BY_SA_4,
    credit: 'Wiktionary contributors. Extraction: Tatu Ylonen, Wiktextract (LREC 2022), kaikki.org.',
  },
  { name: 'dmklinger/ukrainian', url: 'https://github.com/dmklinger/ukrainian', what: 'Fallback Ukrainian meanings and tables.', licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3 },
  {
    name: 'Tatoeba',
    url: 'https://tatoeba.org/',
    what: 'Example sentences and their English translations (through Vuizur/tatoeba-to-anki and the Tatoeba Translation Challenge).',
    licence: 'CC BY 2.0 FR',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/fr/',
    credit: 'Tatoeba contributors. Each sentence’s source is shown on the word’s page.',
  },
  {
    name: 'Universal Dependencies treebanks',
    url: 'https://universaldependencies.org/',
    what: 'Example sentences and help with telling word forms apart.',
    licence: 'AnCora CC BY 4.0; Porttinari, VTB, Taiga, GSD and PUD CC BY-SA 4.0; LFG GPL-3.0; PDB, SynTagRus and IU CC BY-NC-SA 4.0 (non-commercial use only)',
    credit: 'The treebanks’ authors; each sentence’s treebank and id are shown on the word’s page.',
  },
  { name: 'wordfreq', url: 'https://github.com/rspeer/wordfreq', what: 'Polish, Russian and Ukrainian word frequencies.', licence: 'Data CC BY-SA 4.0', licenceUrl: CC_BY_SA_4, credit: 'Robyn Speer; includes SUBTLEX and OpenSubtitles data.' },
  { name: 'FrequencyWords (OpenSubtitles)', url: 'https://github.com/hermitdave/FrequencyWords', what: 'Brazilian Portuguese and Spanish word frequencies.', licence: 'Content CC BY-SA 4.0', licenceUrl: CC_BY_SA_4, credit: 'Hermit Dave; OpenSubtitles via OPUS (Lison & Tiedemann 2016).' },
  { name: 'doozan/spanish_data', url: 'https://github.com/doozan/spanish_data', what: 'Spanish frequency list and data.', licence: 'CC BY-SA; Tatoeba sentences CC BY 2.0 FR' },
  { name: 'tabidots/vn-freqs', url: 'https://github.com/tabidots/vn-freqs', what: 'Vietnamese word frequencies.', licence: 'No licence stated by its author' },
  { name: 'UniMorph', url: 'https://unimorph.github.io/', what: 'Spanish, Portuguese and Ukrainian word tables.', licence: 'CC BY-SA 3.0', licenceUrl: CC_BY_SA_3 },
  { name: 'verbecc (from Verbiste)', url: 'https://github.com/bretttolbert/verbecc', what: 'Spanish and Portuguese conjugation tables, partly derived from its data.', licence: 'GPL-2.0-or-later', licenceUrl: 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html' },
  { name: 'OpenRussian (Badestrand/russian-dictionary)', url: 'https://github.com/Badestrand/russian-dictionary', what: 'Russian word tables.', licence: 'CC BY-SA 4.0', licenceUrl: CC_BY_SA_4 },
  { name: 'PoliMorf / Morfologik', url: 'https://github.com/morfologik/polimorf', what: 'Polish word tables.', licence: 'BSD 2-Clause', licenceUrl: 'https://opensource.org/license/bsd-2-clause' },
  { name: 'michmech lemmatization lists', url: 'https://github.com/michmech/lemmatization-lists', what: 'Matching word forms to dictionary forms.', licence: 'ODbL 1.0', licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  { name: 'Forvo', url: 'https://forvo.com/', what: 'Pronunciations, played from Forvo when a Forvo key is configured; not stored.', licence: 'Forvo’s terms; each recording belongs to its speaker' },
];

/** Software and fonts shipped in the app. Their full licence texts are in /third-party-notices.txt. */
const SOFTWARE: Notice[] = [
  { name: 'React, React DOM and scheduler', url: 'https://react.dev/', what: 'User interface.', licence: 'MIT', credit: 'Copyright (c) Meta Platforms, Inc. and affiliates.' },
  { name: 'TanStack Virtual', url: 'https://tanstack.com/virtual', what: 'Long lists.', licence: 'MIT', credit: 'Copyright (c) 2021-present Tanner Linsley.' },
  { name: 'React Icons and Lucide', url: 'https://react-icons.github.io/react-icons/', what: 'Icons.', licence: 'MIT (React Icons); ISC (Lucide icons)', credit: 'React Icons: Copyright 2018 kamijin_fanta. Lucide: Lucide contributors; parts from Feather by Cole Bemis (MIT).' },
  { name: 'Tailwind CSS', url: 'https://tailwindcss.com/', what: 'Styles.', licence: 'MIT', credit: 'Copyright (c) Tailwind Labs, Inc.' },
  { name: 'shadcn/ui', url: 'https://ui.shadcn.com/', what: 'The interface components follow its components, written again for this app.', licence: 'MIT', credit: 'Copyright (c) 2023 shadcn.' },
  {
    name: 'clsx, tailwind-merge and class-variance-authority',
    url: 'https://cva.style/',
    what: 'Putting styles together.',
    licence: 'MIT (clsx, tailwind-merge); Apache 2.0 (class-variance-authority)',
    credit: 'clsx: Copyright (c) Luke Edwards. tailwind-merge: Copyright (c) 2021 Dany Castillo. class-variance-authority: Copyright 2022 Joe Bell.',
  },
  { name: 'Zod', url: 'https://zod.dev/', what: 'Checking data on the server.', licence: 'MIT', credit: 'Copyright (c) 2025 Colin McDonnell.' },
  {
    name: 'py-fsrs (Free Spaced Repetition Scheduler)',
    url: 'https://github.com/open-spaced-repetition/py-fsrs',
    what: 'The review scheduler is a TypeScript port of py-fsrs 6.3.0.',
    licence: 'MIT',
    credit: 'Copyright (c) 2022 Open Spaced Repetition.',
  },
  {
    name: 'FSRS Optimizer and fsrs-rs',
    url: 'https://github.com/open-spaced-repetition/fsrs-optimizer',
    what: 'Fitting your memory model follows their method. It was written for this app and contains none of their code.',
    licence: 'BSD 3-Clause',
    credit: 'By Open Spaced Repetition.',
  },
  { name: 'Lora typeface', url: 'https://github.com/cyrealtype/Lora-Cyrillic', what: 'The serif type used for words and sentences.', licence: 'SIL Open Font License 1.1', licenceUrl: 'https://openfontlicense.org', credit: 'Copyright 2011 The Lora Project Authors, with Reserved Font Name “Lora”.' },
  { name: 'Node.js, SQLite and Caddy', url: 'https://nodejs.org/', what: 'Server runtime, database and web server in the Docker image.', licence: 'MIT (Node.js); public domain (SQLite); Apache 2.0 (Caddy)' },
];

function NoticeList({ items }: { items: Notice[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((n) => (
        <li key={n.name} className="py-3">
          <p className="font-medium">
            <a href={n.url} target="_blank" rel="noreferrer noopener" className="underline decoration-dotted underline-offset-2">
              {n.name}
            </a>
          </p>
          <p className="text-[0.95rem]">{n.what}</p>
          <p className="hint mt-0.5">
            Licence:{' '}
            {n.licenceUrl ? (
              <a href={n.licenceUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
                {n.licence}
              </a>
            ) : (
              n.licence
            )}
            {n.credit ? <> — {n.credit}</> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Third-party notices and attributions, readable before signing in (/notices). */
export function NoticesPage({ standalone = false }: { standalone?: boolean }) {
  return (
    <div className={standalone ? 'mx-auto max-w-2xl px-4 py-10' : 'max-w-2xl'}>
      <p className="text-sm font-medium text-muted-foreground">VocabBuilder by Lango</p>
      <h1 className="mt-1 text-[1.9rem] font-semibold leading-tight">Third-party notices</h1>
      <p className="mt-3 leading-relaxed">
        VocabBuilder includes content and software from other people and projects. They keep their own licences, listed here with the credit they ask for; nothing in Lango’s{' '}
        <Link to="/terms" className="underline underline-offset-2">
          Terms of Service
        </Link>{' '}
        limits what those licences allow. Everything else is Lango’s own work. {COPYRIGHT}
      </p>

      <h2 className="mt-8 text-lg font-semibold">Words, meanings, sentences and tables</h2>
      <NoticeList items={CONTENT} />

      <h2 className="mt-8 text-lg font-semibold">Software and type</h2>
      <NoticeList items={SOFTWARE} />
      <p className="mt-3">
        <a href="/third-party-notices.txt" className="underline underline-offset-2">
          Full licence texts
        </a>
      </p>

      <h2 className="mt-8 text-lg font-semibold">Made for VocabBuilder</h2>
      <p className="mt-2 leading-relaxed">
        The AI-written example sentences, the pictures for the Identify practice, the reviews of meanings and the app itself were made for Lango, and AI-made content is labelled where it is shown.
        They are covered by Lango’s Terms of Service.
      </p>

      <p className="mt-10">
        <Button variant="outline" render={<Link to="/" />}>
          {standalone ? 'Back to sign in' : 'Back to Today'}
        </Button>
      </p>
    </div>
  );
}
