# Replacing sentences on left-out topics

The app's owner wants no example sentences about **Africa, India, the Middle East, Islam or Muslims, or the Bible**
(biblical figures, places and stories, and God as a biblical word, including exclamations such as "Oh my God").
Each such sentence is replaced by one set in **Europe, Asia (not India or the Middle East) or North America**.

Input: `topics/in/<lang>.txt`, one sentence per line:

```
T12 | <word> (<part of speech>) | <the meaning the word has in this sentence> | <sentence> | <translation> | {<the word's form in the sentence>} | hits: <keywords found>
```

The sentence is an example for **that word**. Output: `topics/out/<lang>.txt`, one line per input line, in order:

```
T12 replace <new sentence> | <English translation> {<form of the word in the new sentence>}
T13 keep
T14 drop
```

- **replace**: write a new sentence that uses the word **in the same meaning** (the meaning column) and, if natural, the
  same form. It must be short (4–12 words), natural, everyday language of the variety (Colombian Spanish, Brazilian
  Portuguese, Southern Vietnamese, Moscow Russian, Kyiv Ukrainian, Warsaw Polish), contain the word **once**, and
  must not touch any left-out topic. Where the old sentence named a place or culture, name one in Europe, East or
  Southeast Asia, or North America instead (Madrid, Kraków, Kyoto, Seoul, Hanoi, Toronto, Chicago, the Alps…);
  otherwise an everyday sentence without places is fine. No politics, violence or real public figures. Give the form
  exactly as it appears in your sentence, inside `{}`. The translation is natural English.
- **keep**: the sentence is not about these topics at all; the keyword is a false match (a library, the name Belén or
  Adam as an ordinary person's name, "Chúa nhật" meaning Sunday, Turkmen, a turkey bird).
- **drop**: the word itself means one of these topics (África, árabe, musulmán, Biblia, Dios as a word), so no
  sentence with it can avoid them. Only for that case.

When done, run `PATH=/opt/node24/bin:$PATH node /home/claude/review/topic-export.mjs check <lang>` and fix everything
it reports until it shows 0 problems. It checks that every line has a decision, the form is a word of the new
sentence, and the new sentence does not match a left-out topic.
