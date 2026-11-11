// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences on topics the owner asked to leave out of example sentences: Africa, India, the Middle East, Islam and
// Muslims, and the Bible (with God as a biblical word). Such a sentence is replaced by one set in Europe, Asia
// (outside India and the Middle East) or North America that uses the word in the same meaning and form, or dropped
// when no replacement is listed. Replacements: data/review/topics/<lang>.jsonl, one per line:
//   { lemma, text, replace: { text, translation, target } }   or   { lemma, text, keep: true }  (not on these topics)
//   or { lemma, text, drop: true } (the word itself is on these topics, so no sentence can avoid them)
// A sentence is checked in the target language and in its English translation.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// English, matched against translations. Proper names are case-sensitive so that "turkey" or "china" (porcelain) or
// "christmas eve" are not caught; generic words are case-insensitive.
const EN_NAMES = [
  // Africa
  'Africa', 'Africans?', 'Sahara', 'Sahel', 'Nile', 'Algeria', 'Algerians?', 'Angola', 'Angolans?', 'Benin', 'Botswana', 'Burkina', 'Burundi', 'Cameroon', 'Cameroonians?',
  'Congo', 'Congolese', 'Djibouti', 'Egypt', 'Egyptians?', 'Eritrea', 'Ethiopia', 'Ethiopians?', 'Gabon', 'Gambia', 'Ghana', 'Ghanaians?', 'Ivory Coast', 'Kenya', 'Kenyans?',
  'Lesotho', 'Liberia', 'Liberians?', 'Libya', 'Libyans?', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Mauritius', 'Morocco', 'Moroccans?', 'Mozambique', 'Namibia',
  'Niger', 'Nigeria', 'Nigerians?', 'Rwanda', 'Senegal', 'Senegalese', 'Sierra Leone', 'Somalia', 'Somalis?', 'Sudan', 'Sudanese', 'Tanzania', 'Tanzanians?', 'Togo',
  'Tunisia', 'Tunisians?', 'Uganda', 'Ugandans?', 'Zambia', 'Zimbabwe', 'Cairo', 'Nairobi', 'Lagos', 'Johannesburg', 'Cape Town', 'Casablanca', 'Marrakech', 'Marrakesh',
  'Timbuktu', 'Kilimanjaro', 'Serengeti', 'Zanzibar', 'Zulus?', 'Swahili', 'Maasai', 'Masai', 'Berbers?', 'Tuaregs?', 'Mandela', 'Tutankhamun',
  // India
  'India', 'Indians?', 'Hindi', 'Hindus?', 'Hinduism', 'Mumbai', 'Bombay', 'Delhi', 'New Delhi', 'Calcutta', 'Kolkata', 'Bangalore', 'Bengaluru', 'Chennai', 'Madras',
  'Hyderabad', 'Punjab', 'Punjabis?', 'Bengal', 'Bengalis?', 'Kashmir', 'Kerala', 'Goa', 'Ganges', 'Taj Mahal', 'Gandhi', 'Nehru', 'Bollywood', 'Sikhs?', 'Tamils?', 'Sanskrit',
  // Middle East
  'Middle East', 'Middle Eastern', 'Near East', 'Arabs?', 'Arabic', 'Arabia', 'Arabian', 'Persia', 'Persians?', 'Iran', 'Iranians?', 'Iraq', 'Iraqis?', 'Syria', 'Syrians?',
  'Lebanon', 'Lebanese', 'Israel', 'Israelis?', 'Israelites?', 'Palestine', 'Palestinians?', 'Gaza', 'West Bank', 'Jordan', 'Jordanians?', 'Saudi', 'Saudis', 'Kuwait',
  'Qatar', 'Dubai', 'Abu Dhabi', 'Emirates', 'Emirati', 'Oman', 'Omanis?', 'Yemen', 'Yemenis?', 'Bahrain', 'Turkey', 'Turkish', 'Turks?', 'Istanbul', 'Ankara', 'Ottomans?',
  'Kurds?', 'Kurdish', 'Kurdistan', 'Baghdad', 'Tehran', 'Damascus', 'Beirut', 'Jerusalem', 'Tel Aviv', 'Mecca', 'Medina', 'Riyadh', 'Bedouins?', 'Afghanistan',
  'Afghans?', 'Kabul', 'Taliban', 'Hamas', 'Hezbollah', 'ISIS', 'Al-Qaeda', 'al-Qaeda', 'Bin Laden', 'Saddam', 'Sinai', 'Suez', 'Mesopotamia', 'Babylon', 'Babylonians?',
  'Assyria', 'Persian Gulf', 'Gulf War', 'Pharaohs?', 'Burj Khalifa', 'Galilee', 'Dead Sea',
  // Islam
  'Islam', 'Islamic', 'Islamist', 'Muslims?', 'Moslems?', 'Koran', 'Quran', "Qur'an", 'Allah', 'Mohammed', 'Muhammad', 'Mohammad', 'Mahomet', 'Ramadan', 'Eid', 'Sunnis?',
  'Shia', 'Shiites?', 'Sharia',
  // The Bible
  'Bibles?', 'Biblical', 'Gospels?', 'Old Testament', 'New Testament', 'Genesis', 'Exodus', 'Psalms?', 'Jesus', 'Christ', 'Moses', 'Abraham', 'Noah', 'Adam and Eve',
  'Pharaoh', 'Satan', 'Lucifer', 'Messiah', 'Bethlehem', 'Nazareth', 'Judas', 'Pilate', 'Herod', 'Goliath', 'Samson', 'Solomon', 'Cain', 'Abel', 'Garden of Eden', 'Eden',
  'Babel', 'Sodom', 'Gomorrah', 'Calvary', 'Golgotha', 'Ten Commandments', 'Virgin Mary', 'Holy Spirit', 'Holy Ghost', 'God', "God's", 'Lord', "Lord's",
];
const EN_WORDS = [
  'mosques?', 'minarets?', 'imams?', 'mullahs?', 'ayatollahs?', 'jihad', 'jihadists?', 'caliphs?', 'caliphate', 'hijabs?', 'burqas?', 'niqabs?', 'chadors?', 'halal', 'hajj',
  'muezzins?', 'fatwas?', 'muftis?', 'sheikhs?', 'sultans?', 'sultanate', 'emirs?', 'safaris?', 'apostles?', 'prophets?', 'biblical', 'scriptures?', 'crucif\\w*', 'resurrection',
  'commandments?', 'gospel', 'psalms?', 'prodigal son',
];

// Target-language words, matched against the sentence (case-insensitive unless the word needs a capital to be a name).
const TARGET = {
  es: ['África', 'african[oa]s?', 'Sáhara', 'Egipto', 'egipci[oa]s?', 'Marruecos', 'marroqu[íi]e?s?', 'Argelia', 'Nigeria', 'Kenia', 'Etiop[íi]a', 'Sudáfrica', 'El Cairo', 'Nilo',
    'India', 'hind[úu]e?s?', 'hindi', 'Bombay', 'Nueva Delhi', 'Gandhi', 'Oriente Medio', 'Oriente Próximo', 'Medio Oriente', 'árabes?', 'Arabia', 'Persia', 'persas?', 'Irán',
    'iran[íi]e?s?', 'Irak', 'Iraq', 'iraqu[íi]e?s?', 'Siria', 'sirios?', 'Líbano', 'Israel', 'israel[íi]e?s?', 'israelitas?', 'Palestina', 'palestin[oa]s?', 'Gaza', 'Jordania',
    'Turquía', 'turc[oa]s?', 'Estambul', 'otoman[oa]s?', 'kurd[oa]s?', 'Bagdad', 'Teherán', 'Damasco', 'Jerusalén', 'La Meca', 'Afganistán', 'afgan[oa]s?', 'talib[áa]n(es)?',
    'islam', 'islámic[oa]s?', 'islamistas?', 'musulman(a|es|as)?', 'musulmán', 'mezquitas?', 'Corán', 'Alá', 'Allah', 'Mahoma', 'Ramad[áa]n', 'jeques?',
    'sultan(es)?', 'sultán', 'yihad', 'Biblias?', 'bíblic[oa]s?', 'evangelios?', 'Evangelio', 'Génesis', 'Éxodo', 'salmos?', 'Jesús', 'Jesucristo', 'Cristo', 'Moisés',
    'Abraham', 'Noé', 'Adán', 'faraón', 'faraones', 'Satanás', 'Mes[íi]as', 'Belén', 'Nazaret', 'Judas', 'Pilato', 'Herodes', 'Goliat', 'Salomón', 'apóstol(es)?',
    'profetas?', 'Dios', 'Virgen María', 'Espíritu Santo', 'crucific[\\p{L}\\p{M}]*'],
  pt: ['África', 'african[oa]s?', 'Saara', 'Egito', 'egípci[oa]s?', 'Marrocos', 'marroquin[oa]s?', 'Argélia', 'Nigéria', 'Quênia', 'Etiópia', 'Angola', 'angolan[oa]s?',
    'Moçambique', 'moçambican[oa]s?', 'Cairo', 'Nilo', 'Índia', 'indian[oa]s?', 'hindus?', 'hindi', 'Mumbai', 'Bombaim', 'Gandhi', 'Oriente Médio', 'Médio Oriente',
    'árabes?', 'Arábia', 'Pérsia', 'persas?', 'Irã', 'Irão', 'iranian[oa]s?', 'Iraque', 'iraquian[oa]s?', 'Síria', 'sírios?', 'Líbano', 'Israel', 'israelenses?', 'israelitas?',
    'Palestina', 'palestin[oa]s?', 'Gaza', 'Jordânia', 'Turquia', 'turc[oa]s?', 'Istambul', 'otoman[oa]s?', 'curd[oa]s?', 'Bagdá', 'Teerã', 'Damasco', 'Jerusalém', 'Meca',
    'Afeganistão', 'afeg[ãa]os?', 'talib[ãa]s?', 'islã', 'islão', 'islâmic[oa]s?', 'islamitas?', 'muçulman[oa]s?', 'muçulmanos', 'mesquitas?', 'Corão', 'Alcorão', 'Alá',
    'Allah', 'Maomé', 'Ramad[ãa]', 'imãs?', 'xeques?', 'sult[ãa]o', 'sultões', 'jihad', 'Bíblias?', 'bíblic[oa]s?', 'evangelhos?', 'Evangelho', 'Gênesis', 'Êxodo', 'salmos?',
    'Jesus', 'Cristo', 'Moisés', 'Abraão', 'Noé', 'Adão', 'faraó', 'faraós', 'Satanás', 'Messias', 'Belém', 'Nazaré', 'Judas', 'Pilatos', 'Herodes', 'Golias', 'Salomão',
    'apóstolos?', 'profetas?', 'Deus', 'Virgem Maria', 'Espírito Santo', 'crucific[\\p{L}\\p{M}]*'],
  vi: ['châu Phi', 'Châu Phi', 'Phi châu', 'Ai Cập', 'Ma Rốc', 'Nigeria', 'Kenya', 'Ấn Độ', 'người Ấn', 'Hindu', 'Ả Rập', 'Ả-rập', 'Trung Đông', 'Ba Tư', 'Iran', 'Iraq', 'I-rắc',
    'Syria', 'Xy-ri', 'Li-băng', 'Israel', 'Do Thái', 'Palestine', 'Gaza', 'Thổ Nhĩ Kỳ', 'Afghanistan', 'Taliban', 'Hồi giáo', 'đạo Hồi', 'người Hồi', 'nhà thờ Hồi giáo',
    'Kinh Thánh', 'kinh thánh', 'Chúa Giê-su', 'Chúa Giêsu', 'Giê-su', 'Giêsu', 'Chúa Kitô', 'Ki-tô', 'Môi-se', 'Áp-ra-ham', 'Nô-ê', 'A-đam', 'Đức Chúa Trời', 'Thượng Đế',
    'Thượng đế', 'Chúa', 'Sa-tan', 'tiên tri', 'Allah', 'Burj Khalifa', 'Dubai', 'Galilê', 'Ga-li-lê', 'Giordan', 'Giô-đanh', 'Biển chết'],
  ru: ['Африк[\\p{L}\\p{M}]*', 'африканск[\\p{L}\\p{M}]*', 'африканц[\\p{L}\\p{M}]*', 'Египт[\\p{L}\\p{M}]*', 'египетск[\\p{L}\\p{M}]*', 'египтян[\\p{L}\\p{M}]*', 'Марокко', 'Алжир[\\p{L}\\p{M}]*', 'Нигери[\\p{L}\\p{M}]*', 'Кени[\\p{L}\\p{M}]*', 'Эфиопи[\\p{L}\\p{M}]*',
    'Каир[\\p{L}\\p{M}]*', 'Нил[\\p{L}\\p{M}]*', 'Инди[яиюей]', 'индийск[\\p{L}\\p{M}]*', 'индиец', 'индийц[\\p{L}\\p{M}]*', 'индус[\\p{L}\\p{M}]*', 'хинди', 'Мумба[\\p{L}\\p{M}]*', 'Бомбе[\\p{L}\\p{M}]*', 'Ганди', 'Ближн[\\p{L}\\p{M}]* Восток[\\p{L}\\p{M}]*', 'Средн[\\p{L}\\p{M}]* Восток[\\p{L}\\p{M}]*',
    'араб[\\p{L}\\p{M}]*', 'Арави[\\p{L}\\p{M}]*', 'Перси[\\p{L}\\p{M}]*', 'персидск[\\p{L}\\p{M}]*', 'Иран[\\p{L}\\p{M}]*', 'иранск[\\p{L}\\p{M}]*', 'Ирак[\\p{L}\\p{M}]*', 'иракск[\\p{L}\\p{M}]*', 'Сири[\\p{L}\\p{M}]*', 'сирийск[\\p{L}\\p{M}]*', 'Ливан[\\p{L}\\p{M}]*', 'Израил[\\p{L}\\p{M}]*', 'израильск[\\p{L}\\p{M}]*',
    'израильтян[\\p{L}\\p{M}]*', 'Палестин[\\p{L}\\p{M}]*', 'палестинск[\\p{L}\\p{M}]*', 'Иордани[\\p{L}\\p{M}]*', 'Турци[\\p{L}\\p{M}]*', 'турецк[\\p{L}\\p{M}]*', 'турок', 'турк[\\p{L}\\p{M}]*', 'Стамбул[\\p{L}\\p{M}]*', 'Османск[\\p{L}\\p{M}]*', 'курд[\\p{L}\\p{M}]*', 'Багдад[\\p{L}\\p{M}]*',
    'Тегеран[\\p{L}\\p{M}]*', 'Дамаск[\\p{L}\\p{M}]*', 'Иерусалим[\\p{L}\\p{M}]*', 'Мекк[\\p{L}\\p{M}]*', 'Афганистан[\\p{L}\\p{M}]*', 'афганск[\\p{L}\\p{M}]*', 'афганц[\\p{L}\\p{M}]*', 'талиб[\\p{L}\\p{M}]*', 'ислам[\\p{L}\\p{M}]*', 'мусульман[\\p{L}\\p{M}]*', 'мечет[\\p{L}\\p{M}]*', 'Коран[\\p{L}\\p{M}]*', 'Аллах[\\p{L}\\p{M}]*',
    'Мухаммед[\\p{L}\\p{M}]*', 'Магомет[\\p{L}\\p{M}]*', 'Рамадан[\\p{L}\\p{M}]*', 'имам[\\p{L}\\p{M}]*', 'шейх[\\p{L}\\p{M}]*', 'султан[\\p{L}\\p{M}]*', 'джихад[\\p{L}\\p{M}]*', 'Библи(?!о)[\\p{L}\\p{M}]*', 'библейск[\\p{L}\\p{M}]*', 'Евангели[\\p{L}\\p{M}]*', 'Бытие', 'псал[\\p{L}\\p{M}]*', 'Иисус[\\p{L}\\p{M}]*', 'Христ[\\p{L}\\p{M}]*',
    'Моисе[\\p{L}\\p{M}]*', 'Авраам[\\p{L}\\p{M}]*', 'Но[йяюе]', 'Адам[\\p{L}\\p{M}]*', 'фараон[\\p{L}\\p{M}]*', 'сатан[\\p{L}\\p{M}]*', 'Мессия', 'Вифлеем[\\p{L}\\p{M}]*', 'Назарет[\\p{L}\\p{M}]*', 'Иуд[аеуы]', 'Пилат[\\p{L}\\p{M}]*', 'Ирод[\\p{L}\\p{M}]*', 'Голиаф[\\p{L}\\p{M}]*', 'Соломон[\\p{L}\\p{M}]*',
    'апостол[\\p{L}\\p{M}]*', 'пророк[\\p{L}\\p{M}]*', 'Бог', 'Бога', 'Богу', 'Богом', 'Боге', 'Господ[\\p{L}\\p{M}]*', 'Богородиц[\\p{L}\\p{M}]*'],
  uk: ['Африк[\\p{L}\\p{M}]*', 'африканськ[\\p{L}\\p{M}]*', 'африканц[\\p{L}\\p{M}]*', 'Єгипт[\\p{L}\\p{M}]*', 'єгипетськ[\\p{L}\\p{M}]*', 'Марокко', 'Алжир[\\p{L}\\p{M}]*', 'Нігері[\\p{L}\\p{M}]*', 'Кені[\\p{L}\\p{M}]*', 'Ефіопі[\\p{L}\\p{M}]*', 'Каїр[\\p{L}\\p{M}]*', 'Ніл[\\p{L}\\p{M}]*',
    'Інді[яїюєі]', 'індійськ[\\p{L}\\p{M}]*', 'індієць', 'індійц[\\p{L}\\p{M}]*', 'індус[\\p{L}\\p{M}]*', 'гінді', 'Мумба[\\p{L}\\p{M}]*', 'Ганді', 'Близьк[\\p{L}\\p{M}]* Сх[\\p{L}\\p{M}]*', 'араб[\\p{L}\\p{M}]*', 'Аравії', 'Аравія', 'Перс[\\p{L}\\p{M}]*', 'перськ[\\p{L}\\p{M}]*',
    'Іран[\\p{L}\\p{M}]*', 'іранськ[\\p{L}\\p{M}]*', 'Ірак[\\p{L}\\p{M}]*', 'іракськ[\\p{L}\\p{M}]*', 'Сирі[\\p{L}\\p{M}]*', 'сирійськ[\\p{L}\\p{M}]*', 'Ліван[\\p{L}\\p{M}]*', 'Ізраїл[\\p{L}\\p{M}]*', 'ізраїльськ[\\p{L}\\p{M}]*', 'Палестин[\\p{L}\\p{M}]*', 'палестинськ[\\p{L}\\p{M}]*', 'Йордані[\\p{L}\\p{M}]*',
    'Туреччин[\\p{L}\\p{M}]*', 'турецьк[\\p{L}\\p{M}]*', 'турок', 'турк[\\p{L}\\p{M}]*', 'Стамбул[\\p{L}\\p{M}]*', 'Османськ[\\p{L}\\p{M}]*', 'курд[\\p{L}\\p{M}]*', 'Багдад[\\p{L}\\p{M}]*', 'Тегеран[\\p{L}\\p{M}]*', 'Дамаск[\\p{L}\\p{M}]*', 'Єрусалим[\\p{L}\\p{M}]*', 'Мекк[\\p{L}\\p{M}]*', 'Афганістан[\\p{L}\\p{M}]*',
    'афганськ[\\p{L}\\p{M}]*', 'талібан[\\p{L}\\p{M}]*', 'іслам[\\p{L}\\p{M}]*', 'мусульман[\\p{L}\\p{M}]*', 'мечет[\\p{L}\\p{M}]*', 'Коран[\\p{L}\\p{M}]*', 'Аллах[\\p{L}\\p{M}]*', 'Мухаммед[\\p{L}\\p{M}]*', 'Рамадан[\\p{L}\\p{M}]*', 'імам[\\p{L}\\p{M}]*', 'шейх[\\p{L}\\p{M}]*', 'султан[\\p{L}\\p{M}]*', 'джихад[\\p{L}\\p{M}]*',
    'Біблі(?!о)[\\p{L}\\p{M}]*', 'біблійн[\\p{L}\\p{M}]*', 'Євангелі[\\p{L}\\p{M}]*', 'Буття', 'псал[\\p{L}\\p{M}]*', 'Ісус[\\p{L}\\p{M}]*', 'Христ[\\p{L}\\p{M}]*', 'Мойсе[\\p{L}\\p{M}]*', 'Авраам[\\p{L}\\p{M}]*', 'Но[єяю]', 'Адам[\\p{L}\\p{M}]*', 'фараон[\\p{L}\\p{M}]*', 'сатан[\\p{L}\\p{M}]*', 'Месі[яї]',
    'Віфлеєм[\\p{L}\\p{M}]*', 'Назарет[\\p{L}\\p{M}]*', 'Юд[аиіу]', 'Пилат[\\p{L}\\p{M}]*', 'Ірод[\\p{L}\\p{M}]*', 'Голіаф[\\p{L}\\p{M}]*', 'Соломон[\\p{L}\\p{M}]*', 'апостол[\\p{L}\\p{M}]*', 'пророк[\\p{L}\\p{M}]*', 'Бог', 'Бога', 'Богу', 'Богом', 'Бозі', 'Господ[\\p{L}\\p{M}]*',
    'Богородиц[\\p{L}\\p{M}]*'],
  pl: ['Afryk[\\p{L}\\p{M}]*', 'afrykańsk[\\p{L}\\p{M}]*', 'Afrykan[\\p{L}\\p{M}]*', 'Sahar[\\p{L}\\p{M}]*', 'Egipt[\\p{L}\\p{M}]*', 'egipsk[\\p{L}\\p{M}]*', 'Maroko', 'Marok[\\p{L}\\p{M}]*', 'Algieri[\\p{L}\\p{M}]*', 'Nigeri[\\p{L}\\p{M}]*', 'Keni[\\p{L}\\p{M}]*', 'Etiopi[\\p{L}\\p{M}]*', 'Kair[\\p{L}\\p{M}]*', 'Nil[\\p{L}\\p{M}]*',
    'Indi[aiąę]', 'indyjsk[\\p{L}\\p{M}]*', 'Hindus[\\p{L}\\p{M}]*', 'hinduist[\\p{L}\\p{M}]*', 'hindi', 'Bombaj[\\p{L}\\p{M}]*', 'Delhi', 'Gandhi[\\p{L}\\p{M}]*', 'Bliski[\\p{L}\\p{M}]* Wsch[\\p{L}\\p{M}]*', 'Bliskim Wschodzie', 'Arab[\\p{L}\\p{M}]*', 'arabsk[\\p{L}\\p{M}]*', 'Persj[\\p{L}\\p{M}]*',
    'persk[\\p{L}\\p{M}]*', 'Iran[\\p{L}\\p{M}]*', 'irańsk[\\p{L}\\p{M}]*', 'Irak[\\p{L}\\p{M}]*', 'irack[\\p{L}\\p{M}]*', 'Syri[\\p{L}\\p{M}]*', 'syryjsk[\\p{L}\\p{M}]*', 'Liban[\\p{L}\\p{M}]*', 'Izrael[\\p{L}\\p{M}]*', 'izraelsk[\\p{L}\\p{M}]*', 'Palestyn[\\p{L}\\p{M}]*', 'palestyńsk[\\p{L}\\p{M}]*',
    'Jordani[\\p{L}\\p{M}]*', 'Turcj[\\p{L}\\p{M}]*', 'tureck[\\p{L}\\p{M}]*', 'Turek', 'Turc[yiy]', 'Turk[\\p{L}\\p{M}]*', 'Stambu[\\p{L}\\p{M}]*', 'osmańsk[\\p{L}\\p{M}]*', 'Kurd[\\p{L}\\p{M}]*', 'kurdyjsk[\\p{L}\\p{M}]*', 'Bagdad[\\p{L}\\p{M}]*', 'Teheran[\\p{L}\\p{M}]*', 'Damaszk[\\p{L}\\p{M}]*',
    'Jerozolim[\\p{L}\\p{M}]*', 'Mekk[\\p{L}\\p{M}]*', 'Afganistan[\\p{L}\\p{M}]*', 'afgańsk[\\p{L}\\p{M}]*', 'talib[\\p{L}\\p{M}]*', 'islam[\\p{L}\\p{M}]*', 'muzułma[\\p{L}\\p{M}]*', 'meczet[\\p{L}\\p{M}]*', 'Koran[\\p{L}\\p{M}]*', 'Allah[\\p{L}\\p{M}]*', 'Mahomet[\\p{L}\\p{M}]*', 'Ramadan[\\p{L}\\p{M}]*', 'imam[\\p{L}\\p{M}]*',
    'szejk[\\p{L}\\p{M}]*', 'sułtan[\\p{L}\\p{M}]*', 'dżihad[\\p{L}\\p{M}]*', 'Bibli(?!o)[\\p{L}\\p{M}]*', 'biblijn[\\p{L}\\p{M}]*', 'Matk[\\p{L}\\p{M}]* Bosk[\\p{L}\\p{M}]*', 'Ewangeli[\\p{L}\\p{M}]*', 'Księg[aię] Rodzaju', 'psalm[\\p{L}\\p{M}]*', 'Jezus[\\p{L}\\p{M}]*', 'Chrystus[\\p{L}\\p{M}]*', 'Mojżesz[\\p{L}\\p{M}]*', 'Abraham[\\p{L}\\p{M}]*',
    'Noe[\\p{L}\\p{M}]*', 'Adam[\\p{L}\\p{M}]*', 'faraon[\\p{L}\\p{M}]*', 'szatan[\\p{L}\\p{M}]*', 'Mesjasz[\\p{L}\\p{M}]*', 'Betlejem', 'Nazaret[\\p{L}\\p{M}]*', 'Judasz[\\p{L}\\p{M}]*', 'Piłat[\\p{L}\\p{M}]*', 'Herod[\\p{L}\\p{M}]*', 'Goliat[\\p{L}\\p{M}]*', 'Salomon[\\p{L}\\p{M}]*', 'apostoł[\\p{L}\\p{M}]*',
    'prorok[\\p{L}\\p{M}]*', 'Bóg', 'Boga', 'Bogu', 'Bogiem', 'Panie Boże', 'Boże(?!\\s+Narodzeni)', 'Pan Bóg', 'Matk[aię] Boż[\\p{L}\\p{M}]*', 'Duch[\\p{L}\\p{M}]* Święt[\\p{L}\\p{M}]*'],
};

const boundary = (alts, flags) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{M}\\p{N}])`, flags);
const EN_NAME_RE = boundary(EN_NAMES.map((w) => w.replace(/ /g, '\\s+')), 'u');
const EN_WORD_RE = boundary(EN_WORDS, 'iu');
const TARGET_RE = Object.fromEntries(Object.entries(TARGET).map(([l, alts]) => [l, boundary(alts.map((w) => w.replace(/ /g, '\\s+')), 'iu')]));
// Words whose capital matters in the target language too (Señor/Senhor "Lord" vs señor "sir", Chúa).
const CAPITAL_ONLY = { es: [], pt: [], vi: ['Chúa'], ru: [], uk: [], pl: [] };
// Names written with a capital that are ordinary words in lower case: Сахара (Sahara) and сахара (of sugar), Газа
// (Gaza) and газа (of gas), Дели (Delhi) and дели ("divide!").
const CAPITAL_NAMES = {
  ru: ['Сахар[аеуы]', 'Газ[аеуы]', 'Дели'],
  uk: ['Сахар[аиіу]', 'Газ[аиіу]', 'Делі'],
  pl: ['Gaz[aieyę]'],
};
const CAPITAL_RE = Object.fromEntries(Object.entries(CAPITAL_NAMES).map(([l, alts]) => [l, new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'gu')]));

/** The matched words that put a sentence on these topics, or [] when it is not on them. */
export function topicHits(lang, text, translation) {
  const hits = [];
  const strip = (s) => s.normalize('NFC').replace(/́/g, '');
  const t = strip(text ?? '');
  const tr = translation ?? '';
  for (const re of [EN_NAME_RE, EN_WORD_RE]) {
    const m = tr.match(new RegExp(re.source, re.flags + 'g'));
    if (m) hits.push(...m);
  }
  const re = TARGET_RE[lang];
  if (re) {
    for (const m of t.matchAll(new RegExp(re.source, re.flags + 'g'))) {
      const w = m[0];
      if (CAPITAL_ONLY[lang].some((c) => c.toLowerCase() === w.toLowerCase()) && w[0] !== w[0].toUpperCase()) continue;
      hits.push(w);
    }
  }
  if (CAPITAL_RE[lang]) {
    // At the start of a sentence the capital says nothing (Сахара нет: "there's no sugar"); the translation decides.
    const first = t.search(/[\p{L}]/u);
    for (const m of t.matchAll(CAPITAL_RE[lang])) if (m.index !== first) hits.push(m[0]);
  }
  return [...new Set(hits)];
}

const textKey = (s) => s.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim();

export function topicsFile(lang) {
  return fileURLToPath(new URL(`../../data/review/topics/${lang}.jsonl`, import.meta.url));
}

/** lemma + sentence → decision. */
export function loadTopicDecisions(lang, file = topicsFile(lang)) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    map.set(`${r.lemma}\t${textKey(r.text)}`, r);
  }
  return map;
}

export const TOPIC_CREDIT = 'Written by AI (Claude) in November 2026 to replace a sentence on a topic left out of this app; not checked by a native speaker';

/**
 * Replace or drop sentences on these topics (in place). Returns { credits, stats, open }: open lists the sentences
 * on these topics with no decision yet (dropped, so they never reach the app).
 */
export function applyTopics(lang, entries, decisions, credits = []) {
  const stats = { checked: 0, replaced: 0, dropped: 0, kept: 0, undecided: 0 };
  const open = [];
  const added = [];
  for (const e of entries) {
    const out = [];
    for (const x of e.examples ?? []) {
      stats.checked++;
      const hits = topicHits(lang, x.text, x.translation);
      const d = decisions.get(`${e.lemma}\t${textKey(x.text)}`);
      if (!hits.length || d?.keep) {
        if (hits.length) stats.kept++;
        out.push(x);
        continue;
      }
      if (d?.replace && !topicHits(lang, d.replace.text, d.replace.translation).length) {
        out.push({ ...x, text: d.replace.text, translation: d.replace.translation, target: d.replace.target, source: 'ai-claude', ref: null });
        added.push({ lemma: e.lemma, text: d.replace.text, credit: TOPIC_CREDIT });
        stats.replaced++;
        continue;
      }
      if (d?.drop) stats.dropped++;
      else {
        stats.undecided++;
        open.push({ lemma: e.lemma, pos: e.pos, rank: e.frequencyRank, text: x.text, translation: x.translation, target: x.target, sense: x.sense ?? null, gloss: e.senses[x.sense ?? 0]?.gloss ?? e.senses[0]?.gloss, hits });
      }
    }
    e.examples = out;
  }
  const present = new Set(entries.flatMap((e) => (e.examples ?? []).map((x) => `${e.lemma}\t${textKey(x.text)}`)));
  return { credits: [...credits.filter((c) => present.has(`${c.lemma}\t${textKey(c.text)}`)), ...added], stats, open };
}

export function topicsReport(stats) {
  return [
    '## Sentences on left-out topics',
    '',
    `Sentences about Africa, India, the Middle East, Islam or the Bible are left out of this app. ${stats.replaced.toLocaleString('en')} were replaced by AI-written sentences set in Europe, Asia or North America that use the word the same way, ${(stats.dropped + stats.undecided).toLocaleString('en')} were dropped (the word itself is on these topics, or no replacement was written yet), and ${stats.kept.toLocaleString('en')} more matched a keyword without being about these topics.`,
    '',
  ];
}
