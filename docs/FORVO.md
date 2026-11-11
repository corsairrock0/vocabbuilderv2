# Pronunciation: Forvo, your own recordings and text-to-speech

VocabBuilder can play native-speaker recordings from [Forvo](https://forvo.com) through Forvo's **official API**,
using an API key that you obtain. Without a key the app works fully. Audio then comes from recordings you upload or
record yourself, or, if you turn it on, from your device's text-to-speech, which is clearly labelled as synthetic.

> **Verification status:** request building, response parsing, link expiry, quota counting and error handling are
> covered by tests against a **mocked** Forvo API (`tests/unit/forvo.test.ts`). Live playback has **not** been
> verified, because no Forvo API key was available while building the app. After adding your key, check one word
> per language (see "Checking it works" below).

## Setting it up

1. Get an API key from [api.forvo.com](https://api.forvo.com/). Plans and their daily request limits are set by Forvo.
2. In `.env` on the server:

   ```
   VB_FORVO_API_KEY=your-key
   VB_FORVO_API_BASE=https://apifree.forvo.com   # the API host given in your plan's documentation
   VB_FORVO_DAILY_LIMIT=500                      # your plan's daily limit, or lower
   VB_FORVO_TIMEOUT_MS=8000
   ```

3. Restart the app with `docker compose up -d`. Settings → Audio then shows *Forvo connected* and today's usage.

The key is read only by the server. It is used in server-to-Forvo requests, and it is never sent to the browser,
logged, or included in backups or exports.

## How the integration respects Forvo's terms

| Rule | What the app does |
|---|---|
| Use the official API only | Lookups use the documented `word-pronunciations` action. Nothing is scraped, and hidden media URLs are never extracted. |
| Don't download, store or cache audio | The server never fetches audio files. The browser plays Forvo's audio link directly from Forvo. The service worker ignores cross-origin requests, so Forvo audio is never put in a cache or IndexedDB. Offline mode has no Forvo audio, and the app says so. |
| Links expire after 2 hours | Only **metadata** is kept: speaker, country, rating and Forvo's id. The short-lived links stay in server memory for at most 90 minutes and are never written to disk. A link that fails to play is looked up again once. |
| Every play counts as a request | The browser reports plays to the server in batches. The server counts API calls and plays against `VB_FORVO_DAILY_LIMIT`. When the limit is reached, lookups stop until Forvo's daily reset at 22:00 UTC, and the app shows why. |
| Attribution | Each Forvo recording shows its speaker and a link to the word's page on Forvo. |

## Accent labels: what can and cannot be claimed

Forvo records each speaker's **country**, not their city or region. The app therefore never claims that a recording
is from Bogotá, Moscow, Kyiv or Warsaw (or from Ho Chi Minh City or Southern Vietnam), unless *you* have marked that
speaker as verified.

| Your accent preference (Settings → Audio) | Lookup | How a recording is labelled |
|---|---|---|
| Colombian Spanish (prefer Bogotá) | `language=es`, `country=COL` | "Colombian Spanish — country verified; city/region unverified" |
| Brazilian Portuguese | `pt`, `BRA` | "Brazilian Portuguese — country verified; city/region unverified" |
| Southern Vietnamese | `vi`, `VNM` | "Vietnamese (Vietnam) — specific regional accent unverified" |
| Moscow Russian | `ru`, `RUS` | "Russian (Russia) — specific regional accent unverified" |
| Kyiv Ukrainian | `uk`, `UKR` | "Ukrainian (Ukraine) — specific regional accent unverified" |
| Warsaw Polish | `pl`, `POL` | "Polish (Poland) — specific regional accent unverified" |

How results are chosen and ranked:

- **Few matches.** If the preferred country returns fewer than two recordings, a second lookup without the country
  filter adds more. Recordings from other countries are labelled with their actual country, for example "Spanish
  (Spain) — not your preferred variety".
- **Ranking:**
  1. the recording you chose as preferred for that word
  2. speakers you marked as preferred
  3. the preferred country
  4. an exact match of the word form
  5. Forvo rating and votes

  Speakers you marked *avoid* are ranked last.
- **Verified speakers.** On a word's page you can open a speaker's recordings and mark the speaker *verified*, with a
  note such as "Bogotá, confirmed on their profile". From then on, that speaker's recordings are labelled
  "verified by you".

## Playback

On any word or exercise you get:

- play, pause and replay (`R`)
- speed 0.75×, 1× or 1.25×
- other speakers (a menu with each speaker's label)
- a link to the recording's source page

For Vietnamese, slowed playback shows a note that slowing audio can distort tones. Autoplay is off by default
(Settings → Audio).

## Fallbacks

1. **Your own recordings.** On a word's page you can record (if the browser allows the microphone) or upload a file.
   Files are stored in `/data/audio` on your server and labelled "Your recording". They can play offline after you
   have heard them once online, because the service worker caches only your own recordings. Database backups do
   not include audio files; `scripts/offsite-sync.sh --include-audio` copies them.
2. **Licensed recordings.** The data model supports recordings from a licensed source, with attribution, imported
   as `provider='licensed'`. No such dataset is bundled.
3. **Text-to-speech** (off by default, per language). It uses the device's `speechSynthesis` voices, with a voice
   choice. It is always labelled "Device text-to-speech (synthetic)" and is never presented as a native speaker.
   Voice quality and accent depend on the device.

Listening exercises run only when the word has audio. Without audio they are not planned, or, offline, they can be
skipped without counting against you.

## Checking it works

After adding the key:

1. Settings → Audio should show *Forvo connected* with today's request count.
2. Open a common word in each language, for example *gracias*, *obrigado*, *cảm ơn*, *спасибо*, *дякую* and
   *dziękuję*. Press play, and check the speaker labels and the Forvo link.
3. The request count rises by one per lookup and one per play.
4. If nothing plays, see the *Pronunciation (Forvo)* section of [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Common causes are a wrong
   `VB_FORVO_API_BASE` for your plan, an exhausted daily limit, or the word having no recordings for that language.
