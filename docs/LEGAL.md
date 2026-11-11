# Legal protection: what is in place and what is left to do

VocabBuilder is a product of Lango. This page explains how the app protects Lango's work, where the protection
stops, and what only the owner (or a lawyer) can do. It is not legal advice; have a lawyer review the terms before
you offer the app to anyone else.

## In the app

- **Copyright notices.** "© 2026 Lango. All rights reserved." appears on the sign-in page, in the sidebar, in
  Settings → About, in the Terms of Service and the notices, in the page head (`<meta name="copyright">`), at the top
  of every shipped script and stylesheet (an esbuild banner that survives minification), in `LICENSE`, and at the
  top of every Lango source file (`node scripts/legal/headers.mjs` lists files without it; `--write` adds it; a
  unit test fails when one is missing). Applied database migrations are left untouched on purpose: the server checks
  their checksums, so editing one would stop existing databases from opening.
- **Terms of Service** (`web/src/pages/TermsPage.tsx`, version in `shared/legal.ts`). A personal, limited,
  revocable licence; ownership, copyright and database rights; Lango's names; what users may not do (copy,
  distribute, host for others, reverse engineer, scrape, use the content to train AI, remove notices, get around
  security); third-party content; AI-generated content; your data; no warranty; limitation of liability; termination;
  changes; governing law; severability; contact.
- **Click-wrap acceptance.** Creating the owner account requires ticking "I have read and accept the Terms of
  Service" (the server refuses the setup otherwise). When `TERMS_VERSION` changes, the app shows the new terms and
  asks for acceptance before anything else; "Sign out" is the only other way out. Each acceptance is stored in
  `terms_acceptances` with the version, time, device and browser (Settings → About shows the date). Signing in also
  carries "By signing in you agree to the Terms of Service".
- **Third-party notices** (`/notices`, and the full licence texts at `/third-party-notices.txt`, generated from the
  shipped packages by `scripts/legal/notices.mjs`; a copy is in `THIRD_PARTY_NOTICES.md`). Several of the sources
  require this credit (CC BY, CC BY-SA, MIT, BSD, OFL); without it, using them would itself break their licences.
- **py-fsrs credit.** The review scheduler (`shared/fsrs.ts`) is a port of py-fsrs, MIT-licensed, Copyright (c) 2022
  Open Spaced Repetition. The MIT licence requires that notice in copies, so it is in the file and in the notices.

## Your legal details

Built in since 1.7.0 (`LEGAL_DEFAULTS` in `shared/legal.ts`): Lango LLC, contact@lango.com, governed by the laws of
the United States of America. To change them without a new release, set these in `.env` and recreate the container
(`docker compose up -d --force-recreate app`); a line left empty uses the built-in value. In the United States,
contracts are normally governed by a state's law: naming the state where Lango LLC is registered (for example
"the State of Wyoming") is more precise than the whole country.

```
VB_LEGAL_NAME=           # the registered company or person behind Lango, e.g. "Lango LLC"
VB_LEGAL_EMAIL=          # where permission requests and legal notices go
VB_LEGAL_ADDRESS=        # postal address for legal notices
VB_LEGAL_GOVERNING_LAW=  # the country or state whose law governs the terms, e.g. "Ukraine"
```

## Where protection stops

- **Third-party content is not Lango's.** Meanings adapted from Wiktionary are CC BY-SA (share-alike): anyone may
  reuse them under that licence, whatever Lango's terms say. Tatoeba sentences are CC BY. The terms say so.
- **Distributing or selling the app needs a data clean-up first.** Some sentences are licensed for non-commercial use
  only (SynTagRus, PDB and IU treebanks; `scripts/freq/build.mjs --commercial-safe` leaves them out), Polish LFG
  sentences are GPL-3.0, the Spanish and Portuguese tables draw on GPL data (verbecc), and the Vietnamese frequency
  list has no licence. They are fine for private use; before offering the app to others or charging for it, replace
  or remove them (docs/FREQUENCY_SETS.md, "Licences").
- **AI-generated content may have little or no copyright of its own** in some countries (in the United States, for
  example, works need a human author). The terms still bind everyone who accepts them, and the selection and
  arrangement Lango made can be protected, but do not count on copyright alone for AI-written sentences, passages or
  pictures.
- **Names.** Using "Lango" does not by itself give exclusive rights to it, and other businesses already use similar
  names. Search the trademark registers where you operate (for example WIPO's Global Brand Database, the EUIPO, the
  USPTO and Ukraine's register) and consider registering the name and logo before launching publicly.
- **Privacy law.** The app keeps all data on the owner's server and has no tracking. If other people ever use your
  installation, you will need a privacy notice that fits the law where you and they live.

## Changing the terms

1. Edit `web/src/pages/TermsPage.tsx`.
2. Set `TERMS_VERSION` and `TERMS_UPDATED` in `shared/legal.ts` to the new date.
3. Release. Every account sees the new terms on its next visit and must accept them to continue; the acceptance is
   recorded.
