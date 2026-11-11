// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Grammar explanations under answers (shared/grammar.ts): which case a declined form is in and why, and which tense,
// mood and person a verb form is and why, also from a sentence's annotated exact cell (data/grammar/). The tables are
// real ones from the frequency sets, written compactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactCellOf, exactKey, explainForm, NO_NOTE, noNote, paradigmFor, type ExactCell, type ExplainInput } from '../../shared/grammar.ts';
import type { LanguageCode } from '../../shared/languages.ts';
import type { Paradigm, ParadigmKind } from '../../shared/paradigms.ts';

const TABLES: Record<string, [ParadigmKind, string]> = {
  "ru:работа": ["noun", "nom|sg=рабо́та;nom|pl=рабо́ты;gen|sg=рабо́ты;gen|pl=рабо́т;dat|sg=рабо́те;dat|pl=рабо́там;acc|sg=рабо́ту;acc|pl=рабо́ты;ins|sg=рабо́той;ins|pl=рабо́тами;loc|sg=рабо́те;loc|pl=рабо́тах"],
  "ru:стол": ["noun", "nom|sg=стол;nom|pl=столы́;gen|sg=стола́;gen|pl=столо́в;dat|sg=столу́;dat|pl=стола́м;acc|sg=стол;acc|pl=столы́;ins|sg=столо́м;ins|pl=стола́ми;loc|sg=столе́;loc|pl=стола́х"],
  "ru:книга": ["noun", "nom|sg=кни́га;nom|pl=кни́ги;gen|sg=кни́ги;gen|pl=книг;dat|sg=кни́ге;dat|pl=кни́гам;acc|sg=кни́гу;acc|pl=кни́ги;ins|sg=кни́гой;ins|pl=кни́гами;loc|sg=кни́ге;loc|pl=кни́гах"],
  "ru:мама": ["noun", "nom|sg=ма́ма;nom|pl=ма́мы;gen|sg=ма́мы;gen|pl=мам;dat|sg=ма́ме;dat|pl=ма́мам;acc|sg=ма́му;acc|pl=мам;ins|sg=ма́мой;ins|pl=ма́мами;loc|sg=ма́ме;loc|pl=ма́мах"],
  "ru:время": ["noun", "nom|sg=вре́мя;nom|pl=времена́;gen|sg=вре́мени;gen|pl=времён;dat|sg=вре́мени;dat|pl=времена́м;acc|sg=вре́мя;acc|pl=времена́;ins|sg=вре́менем;ins|pl=времена́ми;loc|sg=вре́мени;loc|pl=времена́х"],
  "ru:врач": ["noun", "nom|sg=врач;nom|pl=врачи́;gen|sg=врача́;gen|pl=враче́й;dat|sg=врачу́;dat|pl=врача́м;acc|sg=врача́;acc|pl=враче́й;ins|sg=врачо́м;ins|pl=врача́ми;loc|sg=враче́;loc|pl=врача́х"],
  "ru:друг": ["noun", "nom|sg=друг;nom|pl=друзья́;gen|sg=дру́га;gen|pl=друзе́й;dat|sg=дру́гу;dat|pl=друзья́м;acc|sg=дру́га;acc|pl=друзе́й;ins|sg=дру́гом;ins|pl=друзья́ми;loc|sg=дру́ге;loc|pl=друзья́х"],
  "ru:новый": ["adjective", "nom|m=но́вый;nom|f=но́вая;nom|n=но́вое;nom|pl=но́вые;gen|m=но́вого;gen|f=но́вой;gen|n=но́вого;gen|pl=но́вых;dat|m=но́вому;dat|f=но́вой;dat|n=но́вому;dat|pl=но́вым;acc|f=но́вую;acc|n=но́вое,но́вого;ins|m=но́вым;ins|f=но́вой;ins|n=но́вым;ins|pl=но́выми;loc|m=но́вом;loc|f=но́вой;loc|n=но́вом;loc|pl=но́вых;acc.inan|m=но́вый;acc.anim|m=но́вого;acc.inan|pl=но́вые;acc.anim|pl=но́вых"],
  "ru:вы": ["pronoun", "acc|-=вас;gen|-=вас;nom|-=вы;dat|-=вам;ins|-=вами;loc|-=вас"],
  "ru:кошка": ["noun", "nom|sg=ко́шка;nom|pl=ко́шки;gen|sg=ко́шки;gen|pl=ко́шек;dat|sg=ко́шке;dat|pl=ко́шкам;acc|sg=ко́шку;acc|pl=ко́шек;ins|sg=ко́шкой;ins|pl=ко́шками;loc|sg=ко́шке;loc|pl=ко́шках"],
  "ru:дом": ["noun", "nom|sg=дом;nom|pl=дома́;gen|sg=до́ма;gen|pl=домо́в;dat|sg=до́му;dat|pl=дома́м;acc|sg=дом;acc|pl=дома́;ins|sg=до́мом;ins|pl=дома́ми;loc|sg=до́ме;loc|pl=дома́х"],
  "ru:лето": ["noun", "nom|sg=ле́то;nom|pl=лета́;gen|sg=ле́та;gen|pl=лет;dat|sg=ле́ту;dat|pl=лета́м;acc|sg=ле́то;acc|pl=лета́;ins|sg=ле́том;ins|pl=лета́ми;loc|sg=ле́те;loc|pl=лета́х"],
  "uk:школа": ["noun", "nom|sg=шко́ла;nom|pl=шко́ли;gen|sg=шко́ли;gen|pl=шкіл;dat|sg=шко́лі;dat|pl=шко́лам;acc|sg=шко́лу;acc|pl=шко́ли;ins|sg=шко́лою;ins|pl=шко́лами;loc|sg=шко́лі;loc|pl=шко́лах;voc|sg=шко́ло;voc|pl=шко́ли"],
  "uk:робота": ["noun", "nom|sg=робо́та;nom|pl=робо́ти;gen|sg=робо́ти;gen|pl=робі́т;dat|sg=робо́ті;dat|pl=робо́там;acc|sg=робо́ту;acc|pl=робо́ти;ins|sg=робо́тою;ins|pl=робо́тами;loc|sg=робо́ті;loc|pl=робо́тах;voc|sg=робо́то;voc|pl=робо́ти"],
  "uk:друг": ["noun", "nom|sg=друг;nom|pl=дру́зі;gen|sg=дру́га;gen|pl=дру́зів;dat|sg=дру́гові,дру́гу;dat|pl=дру́зям;acc|sg=дру́га;acc|pl=дру́зів;ins|sg=дру́гом;ins|pl=дру́зями;loc|sg=дру́гові,дру́гу;loc|pl=дру́зях;voc|sg=дру́же;voc|pl=дру́зі"],
  "uk:час": ["noun", "nom|sg=час;nom|pl=часи́;gen|sg=ча́су;gen|pl=часі́в;dat|sg=ча́су;dat|pl=часа́м;acc|sg=час;acc|pl=часи́;ins|sg=ча́сом;ins|pl=часа́ми;loc|sg=ча́сі;loc|pl=часа́х;voc|sg=ча́се;voc|pl=часи́"],
  "uk:стіл": ["noun", "nom|sg=стіл;nom|pl=столи́;gen|sg=стола́,сто́лу;gen|pl=столі́в;dat|sg=столо́ві,столу́;dat|pl=стола́м;acc|sg=стіл;acc|pl=столи́;ins|sg=столо́м;ins|pl=стола́ми;loc|sg=столі́,столу́;loc|pl=стола́х;voc|sg=сто́ле;voc|pl=столи́"],
  "uk:ти": ["pronoun", "nom|-=ти;gen|-=тебе́,те́бе;dat|-=тобі́;acc|-=тебе́;ins|-=тобо́ю;loc|-=тобі́"],
  "uk:я": ["pronoun", "nom|-=я;gen|-=мене́,ме́не;dat|-=мені́;acc|-=мене́;ins|-=мно́ю;loc|-=мені́"],
  "uk:спорт": ["noun", "nom|sg=спорт;nom|pl=спо́рти;gen|sg=спо́рту;gen|pl=спо́ртів;dat|sg=спо́рту;dat|pl=спо́ртам;acc|sg=спорт;acc|pl=спо́рти;ins|sg=спо́ртом;ins|pl=спо́ртами;loc|sg=спо́рту,спо́рті;loc|pl=спо́ртах;voc|sg=спо́рте;voc|pl=спо́рти"],
  "uk:порядок": ["noun", "nom|sg=поря́док;nom|pl=поря́дки;gen|sg=поря́дку;gen|pl=поря́дків;dat|sg=поря́дку;dat|pl=поря́дкам;acc|sg=поря́док;acc|pl=поря́дки;ins|sg=поря́дком;ins|pl=поря́дками;loc|sg=поря́дку;loc|pl=поря́дках;voc|sg=поря́дку;voc|pl=поря́дки"],
  "uk:шахрайство": ["noun", "nom|sg=шахра́йство;nom|pl=шахра́йства;gen|sg=шахра́йства;gen|pl=шахра́йств;dat|sg=шахра́йству;dat|pl=шахра́йствам;acc|sg=шахра́йство;acc|pl=шахра́йства;ins|sg=шахра́йством;ins|pl=шахра́йствами;loc|sg=шахра́йстві;loc|pl=шахра́йствах;voc|sg=шахра́йство;voc|pl=шахра́йства"],
  "uk:карта": ["noun", "nom|sg=ка́рта;nom|pl=ка́рти;gen|sg=ка́рти;gen|pl=карт;dat|sg=ка́рті;dat|pl=ка́ртам;acc|sg=ка́рту;acc|pl=ка́рти;ins|sg=ка́ртою;ins|pl=ка́ртами;loc|sg=ка́рті;loc|pl=ка́ртах;voc|sg=ка́рто;voc|pl=ка́рти"],
  "pl:poczta": ["noun", "acc|sg=pocztę;ins|sg=pocztą;acc|pl=poczty;nom|pl=poczty;voc|pl=poczty;gen|sg=poczty;dat|pl=pocztom;voc|sg=poczto;ins|pl=pocztami;loc|pl=pocztach;nom|sg=poczta;gen|pl=poczt;dat|sg=poczcie;loc|sg=poczcie"],
  "pl:praca": ["noun", "acc|sg=pracę;ins|sg=pracą;dat|sg=pracy;gen|sg=pracy;loc|sg=pracy;dat|pl=pracom;voc|sg=praco;acc|pl=prace;nom|pl=prace;voc|pl=prace;ins|pl=pracami;loc|pl=pracach;nom|sg=praca;gen|pl=prac"],
  "pl:brat": ["noun", "ins|pl=braćmi;dat|sg=bratu;ins|sg=bratem;acc|sg=brata;gen|sg=brata;nom|sg=brat;dat|pl=braciom;loc|sg=bracie;voc|sg=bracie;loc|pl=braciach;nom|pl=bracia;voc|pl=bracia;acc|pl=braci;gen|pl=braci"],
  "pl:czas": ["noun", "gen|pl=czasów;acc|pl=czasy;nom|pl=czasy;voc|pl=czasy;gen|sg=czasu;dat|sg=czasowi;dat|pl=czasom;loc|sg=czasie;voc|sg=czasie;ins|sg=czasem;ins|pl=czasami;loc|pl=czasach;acc|sg=czas;nom|sg=czas"],
  "pl:kawa": ["noun", "acc|sg=kawę;ins|sg=kawą;acc|pl=kawy;nom|pl=kawy;voc|pl=kawy;gen|sg=kawy;dat|pl=kawom;voc|sg=kawo;dat|sg=kawie;loc|sg=kawie;ins|pl=kawami;loc|pl=kawach;nom|sg=kawa;gen|pl=kaw"],
  "pl:siostra": ["noun", "gen|pl=sióstr;acc|sg=siostrę;ins|sg=siostrą;dat|sg=siostrze;loc|sg=siostrze;acc|pl=siostry;nom|pl=siostry;voc|pl=siostry;gen|sg=siostry;dat|pl=siostrom;voc|sg=siostro;ins|pl=siostrami;loc|pl=siostrach;nom|sg=siostra"],
  "pl:kot": ["noun", "gen|pl=kotów;acc|pl=koty;nom|pl=koty;voc|pl=koty;dat|sg=kotu;dat|pl=kotom;ins|sg=kotem;ins|pl=kotami;loc|pl=kotach;acc|sg=kota;gen|sg=kota;nom|sg=kot;loc|sg=kocie;voc|sg=kocie"],
  "pl:muzyka": ["noun", "acc|sg=muzykę;ins|sg=muzyką;dat|pl=muzykom;voc|sg=muzyko;acc|pl=muzyki;nom|pl=muzyki;voc|pl=muzyki;gen|sg=muzyki;ins|pl=muzykami;loc|pl=muzykach;nom|sg=muzyka;gen|pl=muzyk;dat|sg=muzyce;loc|sg=muzyce"],
  "pl:niski": ["adjective", "acc|f=niską;ins|f=niską;ins|pl.vir=niskimi;ins|pl.nvir=niskimi;dat|pl.vir=niskim;dat|pl.nvir=niskim;ins|m=niskim;ins|n=niskim;loc|m=niskim;loc|n=niskim;dat|m=niskiemu;dat|n=niskiemu;dat|f=niskiej;gen|f=niskiej;loc|f=niskiej;gen|m=niskiego;gen|n=niskiego;acc|pl.nvir=niskie;nom|pl.nvir=niskie;voc|pl.nvir=niskie;acc|n=niskie;nom|n=niskie;voc|n=niskie;acc|pl.vir=niskich;gen|pl.vir=niskich;gen|pl.nvir=niskich;loc|pl.vir=niskich;loc|pl.nvir=niskich;nom|m=niski;voc|m=niski;nom|f=niska;voc|f=niska;nom|pl.vir=niscy;voc|pl.vir=niscy;acc.anim|m=niskiego;acc.inan|m=niski"],
  "es:hablar": ["verb", "nfin|inf=hablar;nfin|ger=hablando;part|m.sg=hablado;part|f.sg=hablada;part|m.pl=hablados;part|f.pl=habladas;ind.pres|1s=hablo;ind.pres|3s=habla;ind.pres|1p=hablamos;ind.pres|2p=habláis;ind.pres|3p=hablan;ind.impf|1s=hablaba;ind.impf|3s=hablaba;ind.impf|1p=hablábamos;ind.impf|2p=hablabais;ind.impf|3p=hablaban;ind.pret|1s=hablé;ind.pret|3s=habló;ind.pret|1p=hablamos;ind.pret|2p=hablasteis;ind.pret|3p=hablaron;ind.fut|1s=hablaré;ind.fut|3s=hablará;ind.fut|1p=hablaremos;ind.fut|2p=hablaréis;ind.fut|3p=hablarán;cond|1s=hablaría;cond|3s=hablaría;cond|1p=hablaríamos;cond|2p=hablaríais;cond|3p=hablarían;sbjv.pres|1s=hable;sbjv.pres|3s=hable;sbjv.pres|1p=hablemos;sbjv.pres|2p=habléis;sbjv.pres|3p=hablen;sbjv.impf|1s=hablara,hablase;sbjv.impf|3s=hablara,hablase;sbjv.impf|1p=habláramos,hablásemos;sbjv.impf|2p=hablarais,hablaseis;sbjv.impf|3p=hablaran,hablasen;sbjv.fut|1s=hablare;sbjv.fut|3s=hablare;sbjv.fut|1p=habláremos;sbjv.fut|2p=hablareis;sbjv.fut|3p=hablaren;imp.aff|3s=hable;imp.aff|1p=hablemos;imp.aff|2p=hablad;imp.aff|3p=hablen;imp.neg|3s=no hable;imp.neg|1p=no hablemos;imp.neg|2p=no habléis;imp.neg|3p=no hablen;ind.pres|2s=hablas;ind.pres|2s.vos=hablás;ind.impf|2s=hablabas;ind.pret|2s=hablaste;ind.fut|2s=hablarás;cond|2s=hablarías;sbjv.pres|2s=hables;sbjv.pres|2s.vos=hablés;sbjv.impf|2s=hablaras;sbjv.impf|2s.vos=hablases;sbjv.fut|2s=hablares;imp.aff|2s=habla;imp.aff|2s.vos=hablá;imp.neg|2s=no hables;imp.neg|2s.vos=no hablés;ind.pret|2s.vos=hablaste;ind.impf|2s.vos=hablabas;ind.fut|2s.vos=hablarás;cond|2s.vos=hablarías;sbjv.fut|2s.vos=hablares;c.ind.perf|1s=he hablado;c.ind.perf|2s=has hablado;c.ind.perf|3s=ha hablado;c.ind.perf|1p=hemos hablado;c.ind.perf|2p=habéis hablado;c.ind.perf|3p=han hablado;c.ind.perf|2s.vos=has hablado"],
  "pt:falar": ["verb", "ind.pres|2p=falais;ind.pres|1p=falamos;ind.pret|1p=falamos;ind.pres|3p=falam;nfin|ger=falando;ind.plup|1p=faláramos;ind.pret|3p=falaram;ind.plup|3p=falaram;ind.fut|3p=falarão;ind.fut|2s=falarás;ind.plup|2s=falaras;ind.plup|1s=falara;ind.fut|3s=falará;ind.plup|3s=falara;sbjv.fut|2p=falardes;ind.fut|2p=falareis;ind.plup|2p=faláreis;ind.fut|1s=falarei;ind.fut|1p=falaremos;sbjv.fut|3p=falarem;sbjv.fut|2s=falares;cond|1p=falaríamos;cond|3p=falariam;cond|2s=falarias;cond|1s=falaria;cond|3s=falaria;cond|2p=falaríeis;sbjv.fut|1p=falarmos;sbjv.fut|1s=falar;sbjv.fut|3s=falar;nfin|inf=falar;sbjv.impf|2p=falásseis;sbjv.impf|1p=falássemos;sbjv.impf|3p=falassem;sbjv.impf|2s=falasses;sbjv.impf|1s=falasse;sbjv.impf|3s=falasse;ind.pret|2p=falastes;ind.pret|2s=falaste;ind.pres|2s=falas;ind.pres|3s=fala;ind.impf|1p=falávamos;ind.impf|3p=falavam;ind.impf|2s=falavas;ind.impf|1s=falava;ind.impf|3s=falava;ind.impf|2p=faláveis;sbjv.pres|2p=faleis;ind.pret|1s=falei;sbjv.pres|1p=falemos;sbjv.pres|3p=falem;sbjv.pres|2s=fales;sbjv.pres|1s=fale;sbjv.pres|3s=fale;ind.pret|3s=falou;ind.pres|1s=falo;part|m.sg=falado;imp.aff|2s=fala;imp.aff|2p=falai;imp.aff|3s=fale;imp.aff|1p=falemos;imp.aff|3p=falem;imp.neg|2s=não fales;imp.neg|3s=não fale;imp.neg|1p=não falemos;imp.neg|2p=não faleis;imp.neg|3p=não falem;inf.pers|1s=falar;inf.pers|2s=falares;inf.pers|3s=falar;inf.pers|1p=falarmos;inf.pers|2p=falardes;inf.pers|3p=falarem;part|f.sg=falada;part|m.pl=falados;part|f.pl=faladas;c.ind.perf|1s=tenho falado;c.ind.perf|2s=tens falado;c.ind.perf|3s=tem falado;c.ind.perf|1p=temos falado;c.ind.perf|2p=tendes falado;c.ind.perf|3p=têm falado"],
  "es:venir": ["verb", "sbjv.pres|2s=vengas"],
  "es:saber": ["verb", "sbjv.pres|2s=sepas"],
  "es:tener": ["verb", "sbjv.impf|1s=tuviera,tuviese;sbjv.impf|3s=tuviera,tuviese"],
  "pt:entender": ["verb", "sbjv.pres|1s=entenda;sbjv.pres|3s=entenda;imp.aff|3s=entenda"],
  "pt:ter": ["verb", "sbjv.fut|1s=tiver;sbjv.fut|3s=tiver"],
  "pt:chegar": ["verb", "nfin|inf=chegar;sbjv.fut|1s=chegar;sbjv.fut|3s=chegar;inf.pers|1s=chegar;inf.pers|3s=chegar"],
  "es:esperar": ["verb", "nfin|inf=esperar;nfin|ger=esperando;ind.pres|3s=espera;imp.aff|2s=espera;imp.aff|2s.vos=esperá;imp.aff|3s=espere"],
  "es:poner": ["verb", "nfin|inf=poner;nfin|ger=poniendo;imp.aff|2s=pon"],
  "es:sentar": ["verb", "nfin|inf=sentar;imp.aff|2s=sienta;imp.aff|1p=sentemos;imp.aff|2p=sentad"],
  "uk:український": ["adjective", "nom|m=украї́нський;nom|n=украї́нське;nom|f=украї́нська;nom|pl=украї́нські;gen|m=украї́нського;gen|n=украї́нського;gen|f=украї́нської;gen|pl=украї́нських;dat|m=украї́нському;dat|n=украї́нському;dat|f=украї́нській;dat|pl=украї́нським;acc|n=украї́нське;acc|f=украї́нську;ins|m=украї́нським;ins|n=украї́нським;ins|f=украї́нською;ins|pl=украї́нськими;loc|m=украї́нському;loc|n=украї́нському;loc|f=украї́нській;loc|pl=украї́нських;acc.inan|m=украї́нський;acc.anim|m=украї́нського;acc.inan|pl=украї́нські;acc.anim|pl=украї́нських"],
  "pt:obrigar": ["verb", "nfin|inf=obrigar;nfin|ger=obrigando;ind.pret|3s=obrigou;sbjv.pres|1s=obrigue;sbjv.pres|2s=obrigues;sbjv.pres|3s=obrigue;imp.aff|2s=obriga;imp.aff|3s=obrigue;imp.neg|2s=não obrigues;imp.neg|3s=não obrigue;imp.neg|1p=não obriguemos"],
  // Verbs whose table holds both aspects' forms (PoliMorf lists wynosić as imperfective "to amount to" and as perfective
  // "to wear out"), and one whose command is spelled like its future.
  "pl:wynosić": ["verb", "imp|2s=wynoś;imp|1p=wynośmy;imp|2p=wynoście;pres|1s=wynoszę;fut|1s=wynoszę;pres|3p=wynoszą;fut|3p=wynoszą;nfin|inf=wynosić;pres|2s=wynosisz;fut|2s=wynosisz;pres|1p=wynosimy;fut|1p=wynosimy;pres|2p=wynosicie;fut|2p=wynosicie;pres|3s=wynosi;fut|3s=wynosi"],
  "ru:договориться": ["verb", "nfin|inf=договори́ться;fut|1s=договорю́сь;fut|2s=договори́шься;fut|3s=договори́тся;fut|1p=договори́мся;fut|2p=договори́тесь;fut|3p=договоря́тся;imp|2s=договори́сь;imp|2p=договори́тесь"],
};

/** A table from "cell=form,form;cell=form". */
function table(key: string): Paradigm {
  const [kind, spec] = TABLES[key];
  return { kind, cells: Object.fromEntries(spec.split(';').map((c) => [c.split('=')[0], c.split('=')[1].split(',')])) };
}

/**
 * Explain the form in brackets in a sentence ("Для [чого] ти…"), with the table of `language:lemma` (null: none) and
 * the sentence's annotated exact cell, if given.
 */
function explain(language: LanguageCode, lemma: string, sentence: string, opts: { table?: boolean; exact?: ExactCell | null } = {}) {
  const m = /^(.*)\[(.+?)\](.*)$/.exec(sentence)!;
  return explainForm({ language, paradigm: opts.table === false ? null : table(`${language}:${lemma}`), lemma, form: m[2], before: m[1], after: m[3], exact: opts.exact });
}
const text = (language: LanguageCode, lemma: string, sentence: string, opts?: { table?: boolean }) => explain(language, lemma, sentence, opts)?.text ?? null;
/** A drill that names the cell: no sentence. */
const drill = (input: Omit<ExplainInput, 'paradigm'> & { key: string }) => explainForm({ ...input, paradigm: table(input.key) })?.text ?? null;

test('the owner’s example: чого after для is the genitive of що, whose entry has no table of its own', () => {
  const e = explain('uk', 'що', 'Для [чого] ти будеш це використовувати?', { table: false })!;
  assert.equal(e.text, '“чого” is the genitive of “що”: it follows “для” (for), which always takes the genitive.');
  assert.deepEqual(e.cells, ['gen|-']);
  assert.equal(e.label, 'genitive');
  assert.equal(e.fromSentence, true);
  assert.equal(paradigmFor('uk', 'що', null)?.kind, 'pronoun');
  assert.equal(paradigmFor('ru', 'что', null)?.cells['loc|-']?.[0], 'чём');
  assert.equal(paradigmFor('uk', 'хата', null), null);
  // Russian texts often write чём as чем: о settles it as the prepositional, not the instrumental.
  assert.equal(text('ru', 'что', 'О [чем] ты думаешь?', { table: false }), '“чем” is the prepositional of “что”: it follows “о” (about), which takes the prepositional.');
});

test('prepositions with two cases: the meaning picks the case, in both senses', () => {
  assert.equal(text('ru', 'работа', 'Я на [работе].'), '“работе” is the prepositional singular of “работа”: after “на”, the prepositional means where something is (on, at); the accusative would mean where to.');
  assert.match(text('ru', 'работа', 'Я иду на [работу].')!, /^“работу” is the accusative singular of “работа”: after “на”, the accusative means where to, .*; the prepositional would mean where something is\.$/);
  assert.match(text('uk', 'школа', 'Діти в [школі].')!, /^“школі” is the locative singular of “школа”: after “в”, the locative means where something is \(in\)/);
  assert.match(text('uk', 'школа', 'Діти йдуть у [школу].')!, /^“школу” is the accusative singular of “школа”: after “у”, the accusative means where to/);
  assert.match(text('pl', 'poczta', 'Jestem na [poczcie].')!, /^“poczcie” is the locative singular of “poczta”: after “na”, the locative means where something is/);
  assert.match(text('pl', 'poczta', 'Idę na [pocztę].')!, /^“pocztę” is the accusative singular of “poczta”: after “na”, the accusative means where to/);
  // з / с / z: from or out of with the genitive, with (together) with the instrumental.
  assert.match(text('uk', 'робота', 'Я повернувся з [роботи].')!, /genitive singular of “робота”: after “з”, the genitive means from, out of, or off; the instrumental would mean with\.$/);
  assert.match(text('uk', 'друг', 'Я гуляю з [другом].')!, /instrumental singular of “друг”: after “з”, the instrumental means with \(together with\); the genitive would mean from, out of\.$/);
  assert.match(text('ru', 'работа', 'Он вернулся с [работы].')!, /genitive singular of “работа”: after “с”, the genitive means from/);
  assert.match(text('ru', 'друг', 'Я гулял с [другом].')!, /instrumental singular of “друг”: after “с”, the instrumental means with/);
  assert.match(text('pl', 'praca', 'Wracam z [pracy].')!, /genitive singular of “praca”: after “z”, the genitive means from/);
  assert.match(text('pl', 'brat', 'Idę z [bratem].')!, /instrumental singular of “brat”: after “z”, the instrumental means with/);
});

test('negation takes the genitive: нет, немає, nie ma, Polish negated transitive verbs, and what is absent', () => {
  assert.equal(text('uk', 'час', 'Немає [часу].'), '“часу” is the genitive singular of “час”: after “немає” (there is no), Ukrainian uses the genitive.');
  assert.equal(text('ru', 'время', 'У меня нет [времени].'), '“времени” is the genitive singular of “время”: after “нет” (there is no), Russian uses the genitive.');
  assert.match(text('pl', 'czas', 'Nie ma [czasu].')!, /^“czasu” is the genitive singular of “czas”: after “nie ma” \(there is no, or does not have\), Polish uses the genitive\.$/);
  assert.equal(text('pl', 'kawa', 'Nie piję [kawy].'), '“kawy” is the genitive singular of “kawa”: after a negated verb (“nie piję”), Polish puts the object in the genitive.');
  // siostry could be the subject of an intransitive verb: the negation settles nothing.
  assert.match(text('pl', 'siostra', 'Wczoraj nie przyjechały [siostry].')!, /^“siostry” can be the nominative or accusative plural, or genitive singular of “siostra”/);
  assert.equal(text('uk', 'я', '[Мене] не буде вдома.'), '“мене” is the genitive of “я”: with “не буде” after it, Ukrainian puts what is absent in the genitive.');
});

test('numerals: Russian 2–4 take the genitive singular, Ukrainian and Polish 2–4 the nominative plural, 5 up the genitive plural', () => {
  assert.equal(text('ru', 'стол', 'В комнате два [стола].'), '“стола” is the genitive singular of “стол”: it follows “два”, and after 2, 3 and 4 Russian uses the genitive singular.');
  const kniga = explain('ru', 'книга', 'У меня три [книги].')!;
  assert.deepEqual(kniga.cells, ['gen|sg'], 'три settles книги as the genitive singular, not the nominative plural');
  assert.equal(text('ru', 'стол', 'В зале пять [столов].'), '“столов” is the genitive plural of “стол”: it follows “пять”, and numbers from 5 up take the genitive plural.');
  assert.equal(text('uk', 'стіл', 'У кімнаті два [столи].'), '“столи” is the nominative plural of “стіл”: it follows “два”, and after 2, 3 and 4 Ukrainian uses the nominative plural.');
  assert.match(text('uk', 'стіл', 'У залі п’ять [столів].')!, /^“столів” is the genitive plural of “стіл”: it follows “п'ять”, and numbers from 5 up take the genitive plural\.$/);
  assert.match(text('pl', 'kot', 'Mam trzy [koty].')!, /^“koty” is the nominative plural of “kot”: it follows “trzy”, and after 2, 3 and 4 Polish uses the nominative plural\.$/);
  assert.match(text('pl', 'kot', 'Mam pięć [kotów].')!, /^“kotów” is the genitive plural of “kot”: it follows “pięć”/);
  // The 2–4 rule is about nouns: an adjective after два is not explained by it.
  assert.equal(explain('ru', 'новый', 'Я купил два [новых] стола.')!.fromSentence, false);
});

test('verbs with fixed government, and the predicative instrumental', () => {
  assert.equal(text('uk', 'ти', 'Дякую [тобі].'), '“тобі” is the dative of “ти”: it follows “дякую”, and дякувати (to thank) takes the dative.');
  assert.equal(text('ru', 'мама', 'Я помогаю [маме].'), '“маме” is the dative singular of “мама”: it follows “помогаю”, and помогать (to help) takes the dative.');
  assert.equal(text('ru', 'вы', 'Благодарю [вас].'), '“вас” is the accusative of “вы”: it follows “благодарю”, and благодарить (to thank) takes the accusative.');
  assert.match(text('pl', 'muzyka', 'Interesuję się [muzyką].')!, /instrumental singular of “muzyka”: it follows “interesuję”, and interesować się \(to be interested in\) takes the instrumental\.$/);
  assert.match(text('uk', 'спорт', 'Він займається [спортом].')!, /instrumental singular of “спорт”: it follows “займається”, and займатися .* takes the instrumental\.$/);
  assert.equal(text('ru', 'врач', 'Он стал [врачом].'), '“врачом” is the instrumental singular of “врач”: it follows “стал”, and after быть (to be) and стать (to become), what someone is or becomes goes in the instrumental.');
  // летом after были is the instrumental of time, not what someone is.
  assert.match(text('ru', 'лето', 'Мы были там [летом].')!, /says when \(“летом” means in summer\)\.$/);
});

test('an ambiguous form is named by every cell, unless the sentence settles it', () => {
  const plain = explain('ru', 'книга', 'Это [книги].')!;
  assert.equal(plain.text, '“книги” can be the nominative or accusative plural, or genitive singular of “книга”: they are spelled the same.');
  assert.equal(plain.fromSentence, false);
  assert.deepEqual(plain.cells.sort(), ['acc|pl', 'gen|sg', 'nom|pl']);
  const settled = explain('ru', 'книга', 'Я не могу жить без [книги].')!;
  assert.equal(settled.text, '“книги” is the genitive singular of “книга”: it follows “без” (without), which always takes the genitive.');
  assert.deepEqual(settled.cells, ['gen|sg']);
  // Words passed on the way back must agree: повному (dative or locative) leaves порядку its locative.
  assert.match(text('uk', 'порядок', 'Всі в повному [порядку].')!, /^“порядку” is the locative singular of “порядок”: after “в”/);
  assert.match(text('ru', 'дом', 'Я живу в этом большом [доме].')!, /^“доме” is the prepositional singular of “дом”: after “в”/);
  assert.equal(explain('ru', 'новый', 'Это подарок для [нового] друга.')!.label, 'genitive masculine or neuter');
  // у + genitive is at someone's: not for a thing (грати в карти).
  assert.match(text('uk', 'карта', 'Мені не хочеться грати в [карти].')!, /^“карти” is the accusative plural of “карта”: after “в”, the accusative means .*a game/);
  // за допомогою is one preposition; допомогою (instrumental) cannot go with шахрайства.
  assert.match(text('uk', 'шахрайство', 'Том виграв матч за допомогою [шахрайства].')!, /^“шахрайства” is the genitive singular of “шахрайство”: it follows “за допомогою” \(with the help of\)/);
});

test('the search stops at punctuation, personal pronouns and verbs, and never invents a reason', () => {
  assert.equal(explain('ru', 'книга', 'Без сомнения, [книги] лежат на столе.')!.fromSentence, false);
  assert.equal(explain('ru', 'книга', 'Без меня [книги] не читай.')!.fromSentence, false, 'без belongs to меня');
  assert.equal(text('ru', 'кошка', 'На улице видел [кошку].'), '“кошку” is the accusative singular of “кошка”. The accusative marks the direct object, and where to after в and на; it also follows через.');
  // Polish za before an adjective is "too", not the preposition.
  assert.equal(explain('pl', 'niski', 'To krzesło jest dla mnie za [niskie].')!.fromSentence, false);
});

test('a drill that names the cell gets the case’s use; the dictionary form and Vietnamese get nothing', () => {
  assert.equal(drill({ key: 'ru:книга', language: 'ru', lemma: 'книга', form: 'книг', cell: 'gen|pl' }), '“книг” is the genitive plural of “книга”. The genitive means “of” and follows words like нет, без, для, у, из, от and до.');
  assert.match(drill({ key: 'uk:школа', language: 'uk', lemma: 'школа', form: 'шко́лі', cell: 'loc|sg' })!, /^“школі” is the locative singular of “школа”\. The locative is used after у\/в and на for where something is/);
  assert.equal(explainForm({ language: 'ru', paradigm: table('ru:книга'), lemma: 'книга', form: 'Книга', before: '', after: ' на столе.' }), null);
  assert.equal(explainForm({ language: 'vi', paradigm: null, lemma: 'nhà', form: 'nhà' }), null);
  assert.equal(explainForm({ language: 'ru', paradigm: table('ru:книга'), lemma: 'книга', form: 'стол' }), null, 'a form not in the table');
});

test('Spanish: tense, mood and person with its pronoun, and the reason in the sentence', () => {
  assert.equal(drill({ key: 'es:hablar', language: 'es', lemma: 'hablar', form: 'hablé', cell: 'ind.pret|1s' }), '“hablé” is the preterite of “hablar”, yo (I), used for a completed action in the past.');
  // hablamos is both the present and the preterite: a time word settles it, otherwise both are named.
  const ayer = explain('es', 'hablar', 'Ayer [hablamos] con Juan.')!;
  assert.equal(ayer.text, '“hablamos” is the preterite of “hablar”, nosotros (we), used for a completed action in the past. Here “ayer” (yesterday) puts it in the past (the present indicative is spelled the same).');
  assert.equal(ayer.label, 'preterite, nosotros (we)');
  assert.match(text('es', 'hablar', 'Ahora [hablamos] con Juan.')!, /^“hablamos” is the present indicative of “hablar”, nosotros \(we\).* Here “ahora” \(now\) points to the present/);
  assert.equal(text('es', 'hablar', '[Hablamos] mucho.'), '“hablamos” can be the present indicative or preterite of “hablar”, nosotros (we): they are spelled the same.');
  assert.match(text('es', 'hablar', 'Ella [hablaba] muy bien.')!, /^“hablaba” is the imperfect indicative of “hablar”, él\/ella\/usted \(he\/she\/you\), used for .* The subject is “ella” \(yo has the same form\)\.$/);
  assert.match(text('es', 'hablar', 'Ella [habla] español.')!, /^“habla” is the present indicative of “hablar”/, 'with a subject before it, it is not the imperative');
  assert.equal(text('es', 'hablar', 'Quiero [hablar].'), null, 'the infinitive is the dictionary form');
});

test('Spanish subjunctive after quiero que, para que, ojalá and si; commands; gerund and participle', () => {
  assert.equal(text('es', 'venir', 'Quiero que [vengas].'), '“vengas” is the present subjunctive of “venir”, tú (you), used after words of wishing, doubt, feeling or purpose. Here it follows “quiero que”: wanting someone to do something takes the subjunctive.');
  assert.match(text('es', 'saber', 'Te lo digo para que lo [sepas].')!, /Here it follows “para que” \(so that\), which always takes the subjunctive\.$/);
  assert.match(text('es', 'hablar', 'Ojalá [hablara] más despacio.')!, /^“hablara” is the imperfect subjunctive of “hablar”, yo \(I\) or él\/ella\/usted .* Here it follows “ojalá” \(hopefully, if only\), which always takes the subjunctive\.$/);
  assert.match(text('es', 'tener', 'Si [tuviera] dinero, viajaría.')!, /Here “si” \(if\) introduces something unreal or unlikely, which takes the imperfect subjunctive\.$/);
  assert.equal(text('es', 'hablar', 'No [hables] tan rápido.'), '“hables” is the negative imperative of “hablar”, tú (you): with “no”, a command uses the present subjunctive form (no hables).');
  assert.equal(text('es', 'hablar', 'Estoy [hablando] con ella.'), '“hablando” is the gerund of “hablar”: after “estoy” (estar), it describes an action in progress.');
  assert.equal(text('es', 'hablar', 'He [hablado] con ella.'), '“hablado” is the past participle of “hablar”: after “he”, it forms the present perfect (he hablado).');
});

test('Colombian Spanish and Brazilian Portuguese: vos, vosotros, tu and você', () => {
  assert.match(text('es', 'hablar', 'Vos [hablás] muy bien.')!, /^“hablás” is the present indicative of “hablar”, vos \(you; parts of Colombia\)/);
  assert.match(drill({ key: 'es:hablar', language: 'es', lemma: 'hablar', form: 'habláis', cell: 'ind.pres|2p' })!, /, vosotros \(you all; Spain only\), used for/);
  assert.match(drill({ key: 'pt:falar', language: 'pt', lemma: 'falar', form: 'falas', cell: 'ind.pres|2s' })!, /, tu \(you; regional in Brazil\), used for/);
  assert.match(text('pt', 'falar', 'A gente [fala] português.')!, /ele\/ela\/você \(he\/she\/you\).* The subject is “a gente” \(we\), which takes the third-person singular\.$/);
});

test('Portuguese: tense and person, the subjunctive after quero que and para que, the future subjunctive after se', () => {
  assert.match(text('pt', 'falar', 'Ontem [falamos] com ele.')!, /^“falamos” is the preterite of “falar”, nós \(we\).* Here “ontem” \(yesterday\) puts it in the past \(the present indicative is spelled the same\)\.$/);
  assert.match(text('pt', 'falar', 'Nós [falamos] português.')!, /^“falamos” can be the present indicative or preterite of “falar”, nós \(we\): they are spelled the same\./);
  assert.equal(
    text('pt', 'falar', 'Quero que você [fale] com ele.'),
    '“fale” is the present subjunctive of “falar”, ele/ela/você (he/she/you), used after words of wishing, doubt, feeling or purpose. Here it follows “quero que”: wanting someone to do something takes the subjunctive. The subject is “você”, which takes the third-person form (eu has the same form).',
  );
  assert.match(text('pt', 'entender', 'Explico de novo para que ele [entenda].')!, /Here it follows “para que” \(so that\), which always takes the subjunctive\./);
  assert.match(text('pt', 'ter', 'Se eu [tiver] tempo, vou.')!, /^“tiver” is the future subjunctive of “ter”, eu \(I\).* Here “se” \(if\) refers to the future, which takes the future subjunctive\./);
  assert.equal(text('pt', 'chegar', 'Quando você [chegar], me liga.'), null, 'chegar is spelled like the dictionary form');
  assert.match(text('pt', 'falar', '[Fale] com o Tom.')!, /^“fale” is the imperative of “falar”, você \(you\).* so here it is a command \(the present subjunctive is spelled the same\)\.$/);
  assert.equal(text('pt', 'falar', 'O Tom estava [falando].'), '“falando” is the gerund of “falar”: after “estava” (estar), it describes an action in progress.');
  assert.match(text('pt', 'falar', 'Ele explicou devagar para [falarmos] melhor.')!, /^“falarmos” is the personal infinitive of “falar”, nós \(we\).* Here it follows “para”/);
});

test('Spanish pronouns joined to an infinitive, a gerund or a command', () => {
  assert.equal(text('es', 'esperar', '[Espérame] aquí.'), '“espérame” is the imperative of “esperar”, tú (you), with “me” joined to the end: a command takes its pronouns after it; the written accent keeps the stress where it was.');
  assert.equal(text('es', 'poner', 'Tengo que [ponerme] el abrigo.'), '“ponerme” is the infinitive of “poner”, with “me” joined to the end: an infinitive can take its pronouns after it.');
  assert.match(text('es', 'esperar', 'Sigue [esperándonos].')!, /^“esperándonos” is the gerund of “esperar”, with “nos” joined to the end/);
  // The command loses its final s before nos and its final d before os.
  assert.match(text('es', 'sentar', '[Sentémonos] aquí.')!, /^“sentémonos” is the imperative of “sentar”, nosotros \(let’s\), with “nos” joined/);
  assert.match(text('es', 'sentar', '[Sentaos], por favor.')!, /^“sentaos” is the imperative of “sentar”, vosotros \(you all; Spain only\), with “os” joined/);
  assert.deepEqual(explain('es', 'poner', 'Quiero [ponérselo].')!.cells, ['nfin|inf']);
});

// ------------------------------------------------------------------ the exact cell of an annotated sentence

const OWNER_WHY = 'it describes “громадянство” (citizenship), the thing he has in “у нього …” (he has); what someone has is the subject there, so it is nominative.';

test('the owner’s example: an annotated sentence names its one cell and why, never a list of possibilities', () => {
  const sentence = 'У нього [українське] громадянство.';
  // The rules alone can't tell: nothing before the gap calls for a case.
  assert.equal(text('uk', 'український', sentence), '“українське” can be the nominative or accusative neuter of “український”: they are spelled the same.');
  const e = explain('uk', 'український', sentence, { exact: { cell: 'nom|n', why: OWNER_WHY } })!;
  assert.equal(
    e.text,
    '“українське” is the nominative neuter of “український”: it describes “громадянство” (citizenship), the thing he has in “у нього …” (he has); what someone has is the subject there, so it is nominative.',
  );
  assert.deepEqual(e.cells, ['nom|n'], 'the table marks this one cell');
  assert.equal(e.label, 'nominative neuter');
  assert.equal(e.reason, OWNER_WHY.slice(0, -1));
  assert.equal(e.fromSentence, true);
  // A reason without its full stop gets one; spacing is tidied.
  assert.equal(explain('uk', 'український', sentence, { exact: { cell: 'nom|n', why: '  it describes  “громадянство”' } })!.text, '“українське” is the nominative neuter of “український”: it describes “громадянство”.');
  // The annotation decides even where the rules would name several cells.
  const books = explain('ru', 'книга', 'Это [книги].', { exact: { cell: 'nom|pl', why: 'it is what “это” (this is) points to, the subject, so it is nominative.' } })!;
  assert.equal(books.text, '“книги” is the nominative plural of “книга”: it is what “это” (this is) points to, the subject, so it is nominative.');
  assert.deepEqual(books.cells, ['nom|pl']);
});

test('an exact cell without a reason gets the rule for that cell when the sentence gives one, else the cell’s general use', () => {
  const bare = explain('uk', 'український', 'У нього [українське] громадянство.', { exact: { cell: 'nom|n' } })!;
  assert.equal(bare.text, '“українське” is the nominative neuter of “український”. The nominative names the subject: who or what does something.');
  assert.deepEqual(bare.cells, ['nom|n']);
  assert.equal(bare.fromSentence, false);
  // A trigger in the sentence that fits the cell, with nothing about what is spelled the same.
  const gen = explain('ru', 'книга', 'У меня нет [книги].', { exact: { cell: 'gen|sg', why: null } })!;
  assert.equal(gen.text, '“книги” is the genitive singular of “книга”: after “нет” (there is no), Russian uses the genitive.');
  assert.equal(gen.fromSentence, true);
  // Verbs: the tense the annotation names, its use, no "spelled the same" aside.
  assert.equal(text('es', 'hablar', '[Hablamos] mucho.'), '“hablamos” can be the present indicative or preterite of “hablar”, nosotros (we): they are spelled the same.');
  assert.equal(explain('es', 'hablar', '[Hablamos] mucho.', { exact: { cell: 'ind.pret|1p' } })!.text, '“hablamos” is the preterite of “hablar”, nosotros (we), used for a completed action in the past.');
  assert.equal(explain('es', 'hablar', 'Ayer [hablamos] con Juan.', { exact: { cell: 'ind.pret|1p', why: '' } })!.text, '“hablamos” is the preterite of “hablar”, nosotros (we), used for a completed action in the past. Here “ayer” (yesterday) puts it in the past.');
  // With a reason, the verb's label is split around the lemma as everywhere else.
  const party = explain('es', 'hablar', '[Hablamos] mucho de ti en la fiesta.', { exact: { cell: 'ind.pret|1p', why: 'the talking happened at a party that is over, so it is the preterite.' } })!;
  assert.equal(party.text, '“hablamos” is the preterite of “hablar”, nosotros (we): the talking happened at a party that is over, so it is the preterite.');
  assert.equal(party.label, 'preterite, nosotros (we)');
});

test('an annotation whose cell does not hold the form is ignored, as if there were none', () => {
  const sentence = 'У нього [українське] громадянство.';
  const plain = explain('uk', 'український', sentence)!;
  for (const cell of ['gen|n', 'nom|m', 'nom|zz', 'constructor', '__proto__', 'toString', '']) {
    assert.deepEqual(explain('uk', 'український', sentence, { exact: { cell, why: 'a reason meant for another cell.' } }), plain, cell);
  }
  // It is about the form in the gap: another form of the word (a learner's answer explained) is explained by the rules.
  assert.equal(
    explain('uk', 'український', 'У нього [українська] громадянство.', { exact: { cell: 'nom|n', why: OWNER_WHY } })!.text,
    '“українська” is the nominative feminine of “український”. The nominative names the subject: who or what does something.',
  );
  // exactCellOf decides, for explanations, the server and the marked table alike.
  assert.equal(exactCellOf('uk', table('uk:український'), 'украї́нський', 'Украї́нське', { cell: 'nom|n' }), 'nom|n', 'stress marks and capitals do not matter');
  assert.equal(exactCellOf('uk', table('uk:український'), 'український', 'українське', { cell: 'gen|n' }), null);
  assert.equal(exactCellOf('uk', table('uk:український'), 'український', 'українське', null), null);
  assert.equal(exactCellOf('uk', null, 'хата', 'хати', { cell: 'gen|sg' }), null, 'no table');
  assert.equal(exactCellOf('uk', null, 'що', 'чого', { cell: 'gen|-' }), 'gen|-', 'a built-in table counts');
  assert.equal(exactCellOf('ru', { kind: 'noun', indeclinable: true, cells: { 'gen|sg': ['кофе'] } }, 'кофе', 'кофе', { cell: 'gen|sg' }), null, 'indeclinable');
  assert.equal(exactCellOf('es', table('es:hablar'), 'hablar', 'hablar', { cell: 'nfin|inf' }), null, 'the infinitive is the dictionary form');
  assert.equal(exactCellOf('vi', null, 'nhà', 'nhà', { cell: 'nom|sg' }), null);
});

test('a Russian, Ukrainian or Polish verb form that fills two cells is named by its sentence’s annotation alone', () => {
  // Without an annotation the app can only say what the form could be.
  assert.equal(text('pl', 'wynosić', 'Ile [wynosi] rachunek?'), '“wynosi” can be the present (on, ona, ono) or future (on, ona, ono) of “wynosić”: they are spelled the same.');
  // With one, it names the tense the sentence shows and says why.
  const why = 'its subject is “rachunek” (the bill), and “Ile…?” (how much?) asks what it comes to now; wynosić (to amount to) is imperfective, so this form is the present.';
  const e = explain('pl', 'wynosić', 'Ile [wynosi] rachunek?', { exact: { cell: 'pres|3s', why } })!;
  assert.equal(e.text, `“wynosi” is the present (on, ona, ono) of “wynosić”: ${why}`);
  assert.deepEqual(e.cells, ['pres|3s']);
  assert.equal(e.label, 'present (on, ona, ono)');
  assert.equal(e.fromSentence, true);
  // The other reading, when a sentence shows it; and the cell's general use when the annotation has no reason.
  assert.deepEqual(explain('pl', 'wynosić', 'Do jutra [wynosi] te buty.', { exact: { cell: 'fut|3s', why: 'x.' } })!.cells, ['fut|3s']);
  assert.equal(explain('pl', 'wynosić', 'Ile [wynosi] rachunek?', { exact: { cell: 'pres|3s' } })!.text, '“wynosi” is the present (on, ona, ono) of “wynosić”. Used for what happens now or regularly.');
  // A command spelled like a statement about the future.
  const order = explain('ru', 'договориться', '[Договоритесь] о встрече.', { exact: { cell: 'imp|2p', why: 'the sentence tells the listener what to do (“Make an appointment”), so it is a command' } })!;
  assert.equal(order.text, '“договоритесь” is the imperative (вы) of “договориться”: the sentence tells the listener what to do (“Make an appointment”), so it is a command.');
  assert.deepEqual(order.cells, ['imp|2p']);
  // exactCellOf accepts a verb cell that holds the form, and nothing else.
  assert.equal(exactCellOf('pl', table('pl:wynosić'), 'wynosić', 'Wynosi', { cell: 'pres|3s' }), 'pres|3s');
  assert.equal(exactCellOf('ru', table('ru:договориться'), 'договориться', 'договоритесь', { cell: 'fut|2p' }), 'fut|2p');
  assert.equal(exactCellOf('pl', table('pl:wynosić'), 'wynosić', 'wynosi', { cell: 'pres|1s' }), null, 'the cell holds another form');
  assert.equal(exactCellOf('pl', table('pl:wynosić'), 'wynosić', 'wynosić', { cell: 'nfin|inf' }), null, 'the infinitive is the dictionary form');
  assert.deepEqual(explain('pl', 'wynosić', 'Ile [wynosi] rachunek?', { exact: { cell: 'pres|1s', why } }), explain('pl', 'wynosić', 'Ile [wynosi] rachunek?'));
});

test('Portuguese: “Não me obrigue a fazer isso.” with its negative imperative, stored in the table with não', () => {
  const sentence = 'Não me [obrigue] a fazer isso.';
  const why = 'with “não” before it, it tells “você” not to make the speaker do something, and a negative command takes the present subjunctive form.';
  const e = explain('pt', 'obrigar', sentence, { exact: { cell: 'imp.neg|3s', why } })!;
  assert.equal(e.text, '“obrigue” is the negative imperative of “obrigar”, você (you): with “não” before it, it tells “você” not to make the speaker do something, and a negative command takes the present subjunctive form.');
  assert.deepEqual(e.cells, ['imp.neg|3s']);
  assert.equal(e.label, 'negative imperative, você (you)');
  assert.equal(e.fromSentence, true);
  assert.equal(exactCellOf('pt', table('pt:obrigar'), 'obrigar', 'obrigue', { cell: 'imp.neg|3s' }), 'imp.neg|3s', 'the cell holds “não obrigue”');
  // Without a reason, the rule for a negative command.
  assert.equal(explain('pt', 'obrigar', sentence, { exact: { cell: 'imp.neg|3s' } })!.text, '“obrigue” is the negative imperative of “obrigar”, você (you): with “não”, a command uses the present subjunctive form (não obrigue).');
  // The tu command is “não obrigues”: it does not hold obrigue, so the annotation is ignored.
  assert.deepEqual(explain('pt', 'obrigar', sentence, { exact: { cell: 'imp.neg|2s', why } }), explain('pt', 'obrigar', sentence));
  // Another cell that holds the form is named alone: the negative-command rule does not take over.
  assert.equal(explain('pt', 'obrigar', sentence, { exact: { cell: 'sbjv.pres|3s' } })!.text, '“obrigue” is the present subjunctive of “obrigar”, ele/ela/você (he/she/you), used after words of wishing, doubt, feeling or purpose.');
});

test('exactKey: stress marks, capitals, spacing, punctuation, apostrophes and Russian ё do not change the key', () => {
  const k = exactKey('uk', 'український', 'українське', 'У нього українське громадянство.');
  assert.equal(k, 'uk|український|українське|у нього українське громадянство');
  assert.equal(exactKey('uk', 'украї́нський', 'Украї́нське', '  У  нього\tукраї́нське громадя́нство . '), k);
  assert.equal(exactKey('ru', 'ёлка', 'Ёлки', 'Мы купили ёлки!'), 'ru|елка|елки|мы купили елки');
  assert.equal(exactKey('ru', 'елка', 'елки', 'мы купили елки'), exactKey('ru', 'ёлка', 'ёлки', 'Мы купили ЁЛКИ.'));
  assert.equal(exactKey('uk', "п'ять", "п'ять", 'Мені пʼять років.'), exactKey('uk', 'п’ять', 'п’ять', "Мені п'ять років."));
  assert.equal(exactKey('es', 'hablar', 'Hablamos', '¡Hablamos  mucho!'), 'es|hablar|hablamos|hablamos mucho');
  // Latin accents are spelling, not stress: hablé and hable are different forms.
  assert.notEqual(exactKey('es', 'hablar', 'hablé', 'Ya hablé.'), exactKey('es', 'hablar', 'hable', 'Ya hable.'));
  // The language is part of the key.
  assert.notEqual(exactKey('ru', 'стол', 'стола', 'Два стола.'), exactKey('uk', 'стол', 'стола', 'Два стола.'));
});

test('a sentence annotated "no note" (its word only looks like a form of this one) gets no grammar line at all', () => {
  // The rules alone would list what the form could be; the annotation says the sentence uses another word.
  assert.ok(explain('uk', 'український', 'У нього [українське] громадянство.'));
  assert.equal(explain('uk', 'український', 'У нього [українське] громадянство.', { exact: { cell: NO_NOTE, why: 'another word' } }), null);
  assert.equal(noNote({ cell: NO_NOTE }), true);
  assert.equal(noNote({ cell: 'nom|n' }), false);
  assert.equal(noNote(null), false);
});
