// Interface strings. Russian is the source language; every other dictionary is
// typed against it, so a missing key is a compile error. Content that comes from
// Yandex (track titles, wave contexts, genres) is shown as Yandex returns it.

import { create } from 'zustand';
import type { Diversity, Language, Mood } from './wave/engine.ts';

export type Lang = 'ru' | 'en';

/** Language names are always shown in their own language. */
export const LANGS: [Lang, string][] = [
  ['ru', 'Русский'],
  ['en', 'English'],
];

/** Russian plural: ruPlural(5, 'трек', 'трека', 'треков') */
function ruPlural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  return `${n} ${word}`;
}

const enPlural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ru = {
  common: {
    play: 'Слушать',
    shuffle: 'Вперемешку',
    retry: 'Повторить',
    cancel: 'Отмена',
    done: 'Готово',
    delete: 'Удалить',
    create: 'Создать',
    save: 'Сохранить',
    clear: 'Очистить',
    close: 'Закрыть',
    back: 'Назад',
    more: 'Ещё',
    off: 'выкл.',
    like: 'Мне нравится',
    liked: 'Мне нравится',
    dontRecommend: 'Не рекомендовать',
    newPlaylist: 'Новый плейлист',
    myWave: 'Моя волна',
    list: 'Список',
    artist: 'Исполнитель',
    playlist: 'Плейлист',
    album: 'Альбом',
    single: 'Сингл',
    compilation: 'Сборник',
    tracks: 'Треки',
    albums: 'Альбомы',
    artists: 'Исполнители',
    playlists: 'Плейлисты',
    failed: (msg: string) => `Не получилось: ${msg}`,
  },
  count: {
    tracks: (n: number) => ruPlural(n, 'трек', 'трека', 'треков'),
    tracksShort: (n: number) => `${n} тр.`,
    files: (n: number) => ruPlural(n, 'файл', 'файла', 'файлов'),
    days: (n: number) => ruPlural(n, 'день', 'дня', 'дней'),
    plays: (n: number) => ruPlural(n, 'прослушивания', 'прослушиваний', 'прослушиваний'),
    duration: (h: number, m: number) => (h ? `${h} ч ${m} мин` : `${m} мин`),
  },
  nav: {
    home: 'Главная',
    search: 'Поиск',
    library: 'Коллекция',
    settings: 'Настройки',
  },
  player: {
    position: 'Позиция',
    shuffle: 'Перемешать',
    prev: 'Назад',
    pause: 'Пауза',
    play: 'Играть',
    next: 'Дальше',
    repeat: 'Повтор',
    volume: 'Громкость',
    expand: 'Развернуть',
    nothing: 'Ничего не играет',
    source: 'Источник',
    queue: 'Очередь',
    fullscreen: 'Полный экран',
    cantPlay: (title: string) => `Не удалось воспроизвести «${title}»`,
    playbackError: (title: string) => `Ошибка воспроизведения «${title}»`,
    waveEmpty: 'Волна не вернула треков',
    waveFailed: (msg: string) => `Волна не запустилась: ${msg}`,
  },
  nowPlaying: {
    noLyrics: 'Текст для этого трека недоступен',
    now: 'Сейчас',
    upNext: 'Далее',
    wavePicking: 'Волна подбирает треки…',
    queueEmpty: 'Очередь пуста',
    removeFromQueue: 'Убрать из очереди',
    collapse: 'Свернуть (Esc)',
    lyrics: 'Текст',
    lyricsMissing: 'Текста нет',
  },
  menu: {
    newPlaylist: 'Новый плейлист…',
    playNext: 'Играть следующим',
    addToQueue: 'В конец очереди',
    addToPlaylist: 'Добавить в плейлист',
    unlike: 'Убрать из «Мне нравится»',
    goToAlbum: 'Перейти к альбому',
    goToArtist: 'Перейти к исполнителю',
    removeFromPlaylist: 'Удалить из плейлиста',
  },
  toast: {
    loginFailed: (msg: string) => `Не удалось войти: ${msg}`,
    disliked: 'Больше не будет звучать',
    added: (title: string) => `Добавлено в «${title}»`,
    addFailed: (msg: string) => `Не удалось добавить: ${msg}`,
  },
  home: {
    greeting: (hour: number): string => (hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'),
    yourPlaylists: 'Ваши плейлисты',
    newReleases: 'Новые релизы',
    chart: 'Чарт',
    findYours: 'Найти своё',
  },
  artist: {
    popular: 'Популярные треки',
    showLess: 'Свернуть',
    showAll: 'Показать все',
    appearsOn: 'Участвует',
    similar: 'Похожие исполнители',
  },
  library: {
    loadingLikes: 'Загружаю лайки',
    likedEmpty: 'Здесь появятся треки, которые вы лайкнете',
    noAlbums: 'Нет сохранённых альбомов',
    noArtists: 'Нет любимых исполнителей',
  },
  login: {
    tagline: 'Яндекс Музыка в новом интерфейсе. Войдите в свой аккаунт Яндекса, чтобы продолжить.',
    withYandex: 'Войти через Яндекс',
    orToken: 'или вставьте OAuth-токен',
  },
  playlist: {
    yours: 'Ваш плейлист',
    byOwner: (owner: string) => `Плейлист · ${owner}`,
    removeFailed: (msg: string) => `Не удалось удалить: ${msg}`,
    renameTitle: 'Переименовать плейлист',
    rename: 'Переименовать',
    deleteTitle: 'Удалить плейлист?',
    deleteMessage: (title: string) => `«${title}» будет удалён без возможности восстановления.`,
    delete: 'Удалить плейлист',
    uploadHint: 'Загрузить свои mp3 в этот плейлист',
    upload: 'Загрузить mp3',
    uploading: (name: string) => `Загружаю «${name}»…`,
    processing: (files: string) => `Яндекс обрабатывает ${files}…`,
    uploadDone: 'Загрузка завершена',
    uploadPending: 'Файлы приняты, но ещё обрабатываются — обновите плейлист позже',
    tooManyFiles: 'Слишком много загруженных файлов на аккаунте',
    uploadFailed: (status: number) => `Загрузка не удалась: HTTP ${status}`,
    emptyOwn: 'Плейлист пуст. Добавляйте треки через меню «⋯» или загрузите свои mp3.',
    empty: 'Плейлист пуст',
  },
  search: {
    track: (artists: string) => `Трек · ${artists}`,
    album: (artists: string) => `Альбом · ${artists}`,
    best: 'Лучший результат',
    placeholder: 'Треки, альбомы, исполнители, плейлисты',
    start: 'Начните вводить запрос',
    nothing: 'Ничего не нашлось',
    source: (query: string) => `Поиск: ${query}`,
  },
  settings: {
    account: 'Аккаунт',
    plusActive: 'Плюс активен',
    noPlus: 'Без подписки Плюс: доступны только 30-секундные фрагменты',
    logout: 'Выйти',
    language: 'Язык',
    languageHint: 'Язык интерфейса приложения',
    playback: 'Воспроизведение',
    normalize: 'Выравнивание громкости',
    normalizeHint: 'Слишком громкие треки приглушаются до общего уровня (по данным громкости от Яндекса)',
    shortcuts: 'Горячие клавиши',
    keySpace: 'Пробел',
    playPause: 'Пауза / воспроизведение',
    nextTrack: 'Следующий трек',
    prevTrack: 'Предыдущий трек',
    volume: 'Громкость',
    like: 'Мне нравится',
    search: 'Поиск',
    collapse: 'Свернуть полноэкранный плеер',
    disclaimer: 'Wave — неофициальный клиент Яндекс Музыки. Не связан с Яндексом.',
    about: 'О приложении',
    version: (v: string) => `Версия ${v}`,
    logHint: 'Журнал ошибок пригодится, если что-то сломалось',
  },
  wave: {
    kicker: (days: number) => `Без повторов · фильтр ${days ? `${days} дн.` : 'выкл.'}`,
    tagline: 'Бесконечный поток музыки, подобранной для вас',
    resume: 'Продолжить',
    tune: 'Настроить',
    tuneTitle: 'Настройка волны',
    yandexPicks: 'Что подбирает Яндекс',
    activity: 'Занятие',
    anyActivity: 'Любое',
    character: 'Характер',
    mood: 'Настроение',
    language: 'Язык',
    diversity: { default: 'Как обычно', favorite: 'Любимое', discover: 'Незнакомое', popular: 'Популярное' } as Record<Diversity, string>,
    moods: { all: 'Любое', active: 'Бодрое', fun: 'Весёлое', calm: 'Спокойное', sad: 'Грустное' } as Record<Mood, string>,
    languages: { any: 'Любой', russian: 'Русский', 'not-russian': 'Иностранный', 'without-words': 'Без слов' } as Record<Language, string>,
    repeatFilter: 'Фильтр повторов',
    repeatFilterHint: 'Работает поверх рекомендаций Яндекса: треки, которые не проходят фильтр, тихо пропускаются, и подгружаются новые.',
    noRepeat: 'Не повторять прослушанное',
    hideOverplayed: 'Скрывать заигранные треки',
    afterPlays: (plays: string) => `после ${plays}`,
    artistGap: 'Разносить треки одного артиста',
    artistGapValue: (tracks: string) => `минимум ${tracks} между`,
    hideSkipped: 'Скрывать то, что я пропускаю',
    hideSkippedHint: 'Трек, пропущенный в первые 30 секунд дважды, больше не попадётся',
    onlyNew: 'Только новое',
    onlyNewHint: 'Только треки, которых вы ещё не слышали в этом приложении',
    history: 'История прослушиваний',
    historyInfo: (tracks: string) => `В памяти ${tracks}. Хранится только на этом устройстве.`,
    clearHistoryTitle: 'Очистить историю?',
    clearHistoryMessage: 'Фильтр повторов начнёт учиться заново.',
    statsLine: (repeats: number, received: number) => `отсеяно повторов: ${repeats} из ${received}`,
    statsTitle: (s: { received: number; recent: number; overplayed: number; duplicate: number; skipped: number; disliked: number }) =>
      `Получено от Яндекса: ${s.received}. Недавно звучали: ${s.recent}, заиграны: ${s.overplayed}, повторы в сессии: ${s.duplicate}, пропущенные: ${s.skipped}, дизлайки: ${s.disliked}`,
  },
  errors: {
    noTransport: 'Нет платформенного транспорта: запустите приложение через Electron',
    title: 'Что-то пошло не так',
    screenHint: 'Интерфейс остановился из-за ошибки. Обычно помогает перезагрузка, подробности записаны в журнал.',
    viewTitle: 'Эта страница не открылась из-за ошибки',
    reload: 'Перезагрузить',
    home: 'На главную',
    openLog: 'Открыть журнал',
  },
};

export type Dict = typeof ru;

const en: Dict = {
  common: {
    play: 'Play',
    shuffle: 'Shuffle',
    retry: 'Retry',
    cancel: 'Cancel',
    done: 'Done',
    delete: 'Delete',
    create: 'Create',
    save: 'Save',
    clear: 'Clear',
    close: 'Close',
    back: 'Back',
    more: 'More',
    off: 'off',
    like: 'Like',
    liked: 'Liked songs',
    dontRecommend: "Don't recommend",
    newPlaylist: 'New playlist',
    myWave: 'My Wave',
    list: 'List',
    artist: 'Artist',
    playlist: 'Playlist',
    album: 'Album',
    single: 'Single',
    compilation: 'Compilation',
    tracks: 'Tracks',
    albums: 'Albums',
    artists: 'Artists',
    playlists: 'Playlists',
    failed: (msg) => `Something went wrong: ${msg}`,
  },
  count: {
    tracks: (n) => enPlural(n, 'track', 'tracks'),
    tracksShort: (n) => enPlural(n, 'track', 'tracks'),
    files: (n) => enPlural(n, 'file', 'files'),
    days: (n) => enPlural(n, 'day', 'days'),
    plays: (n) => enPlural(n, 'play', 'plays'),
    duration: (h, m) => (h ? `${h} h ${m} min` : `${m} min`),
  },
  nav: {
    home: 'Home',
    search: 'Search',
    library: 'Library',
    settings: 'Settings',
  },
  player: {
    position: 'Position',
    shuffle: 'Shuffle',
    prev: 'Previous',
    pause: 'Pause',
    play: 'Play',
    next: 'Next',
    repeat: 'Repeat',
    volume: 'Volume',
    expand: 'Expand',
    nothing: 'Nothing playing',
    source: 'Source',
    queue: 'Queue',
    fullscreen: 'Full screen',
    cantPlay: (title) => `Couldn't play “${title}”`,
    playbackError: (title) => `Playback error: “${title}”`,
    waveEmpty: 'My Wave returned no tracks',
    waveFailed: (msg) => `My Wave failed to start: ${msg}`,
  },
  nowPlaying: {
    noLyrics: 'Lyrics are not available for this track',
    now: 'Now playing',
    upNext: 'Up next',
    wavePicking: 'My Wave is picking tracks…',
    queueEmpty: 'Queue is empty',
    removeFromQueue: 'Remove from queue',
    collapse: 'Collapse (Esc)',
    lyrics: 'Lyrics',
    lyricsMissing: 'No lyrics',
  },
  menu: {
    newPlaylist: 'New playlist…',
    playNext: 'Play next',
    addToQueue: 'Add to queue',
    addToPlaylist: 'Add to playlist',
    unlike: 'Remove from Liked songs',
    goToAlbum: 'Go to album',
    goToArtist: 'Go to artist',
    removeFromPlaylist: 'Remove from playlist',
  },
  toast: {
    loginFailed: (msg) => `Couldn't sign in: ${msg}`,
    disliked: "You won't hear this again",
    added: (title) => `Added to “${title}”`,
    addFailed: (msg) => `Couldn't add: ${msg}`,
  },
  home: {
    greeting: (hour) => (hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'),
    yourPlaylists: 'Your playlists',
    newReleases: 'New releases',
    chart: 'Chart',
    findYours: 'Find your own',
  },
  artist: {
    popular: 'Popular tracks',
    showLess: 'Show less',
    showAll: 'Show all',
    appearsOn: 'Appears on',
    similar: 'Similar artists',
  },
  library: {
    loadingLikes: 'Loading liked songs',
    likedEmpty: 'Tracks you like will show up here',
    noAlbums: 'No saved albums',
    noArtists: 'No favorite artists',
  },
  login: {
    tagline: 'Yandex Music with a new interface. Sign in to your Yandex account to continue.',
    withYandex: 'Sign in with Yandex',
    orToken: 'or paste an OAuth token',
  },
  playlist: {
    yours: 'Your playlist',
    byOwner: (owner) => `Playlist · ${owner}`,
    removeFailed: (msg) => `Couldn't remove: ${msg}`,
    renameTitle: 'Rename playlist',
    rename: 'Rename',
    deleteTitle: 'Delete playlist?',
    deleteMessage: (title) => `“${title}” will be deleted permanently.`,
    delete: 'Delete playlist',
    uploadHint: 'Upload your own mp3 files to this playlist',
    upload: 'Upload mp3',
    uploading: (name) => `Uploading “${name}”…`,
    processing: (files) => `Yandex is processing ${files}…`,
    uploadDone: 'Upload complete',
    uploadPending: 'Files were accepted but are still processing — refresh the playlist later',
    tooManyFiles: 'Too many uploaded files on this account',
    uploadFailed: (status) => `Upload failed: HTTP ${status}`,
    emptyOwn: 'This playlist is empty. Add tracks from the “⋯” menu or upload your own mp3 files.',
    empty: 'This playlist is empty',
  },
  search: {
    track: (artists) => `Track · ${artists}`,
    album: (artists) => `Album · ${artists}`,
    best: 'Top result',
    placeholder: 'Tracks, albums, artists, playlists',
    start: 'Start typing to search',
    nothing: 'Nothing found',
    source: (query) => `Search: ${query}`,
  },
  settings: {
    account: 'Account',
    plusActive: 'Plus is active',
    noPlus: 'No Plus subscription: only 30-second previews are available',
    logout: 'Sign out',
    language: 'Language',
    languageHint: 'App interface language',
    playback: 'Playback',
    normalize: 'Volume normalization',
    normalizeHint: 'Overly loud tracks are turned down to a common level (using loudness data from Yandex)',
    shortcuts: 'Keyboard shortcuts',
    keySpace: 'Space',
    playPause: 'Play / pause',
    nextTrack: 'Next track',
    prevTrack: 'Previous track',
    volume: 'Volume',
    like: 'Like',
    search: 'Search',
    collapse: 'Collapse the full-screen player',
    disclaimer: 'Wave is an unofficial Yandex Music client. Not affiliated with Yandex.',
    about: 'About',
    version: (v) => `Version ${v}`,
    logHint: 'The error log helps when something breaks',
  },
  wave: {
    kicker: (days) => `No repeats · filter ${days ? `${days} d` : 'off'}`,
    tagline: 'An endless stream of music picked for you',
    resume: 'Resume',
    tune: 'Tune',
    tuneTitle: 'Tune My Wave',
    yandexPicks: 'What Yandex picks',
    activity: 'Activity',
    anyActivity: 'Any',
    character: 'Character',
    mood: 'Mood',
    language: 'Language',
    diversity: { default: 'As usual', favorite: 'Favorites', discover: 'Discover', popular: 'Popular' },
    moods: { all: 'Any', active: 'Energetic', fun: 'Fun', calm: 'Calm', sad: 'Sad' },
    languages: { any: 'Any', russian: 'Russian', 'not-russian': 'Foreign', 'without-words': 'Instrumental' },
    repeatFilter: 'Repeat filter',
    repeatFilterHint: "Works on top of Yandex's recommendations: tracks that don't pass the filter are skipped silently and new ones are fetched.",
    noRepeat: "Don't repeat what I've heard",
    hideOverplayed: 'Hide overplayed tracks',
    afterPlays: (plays) => `after ${plays}`,
    artistGap: 'Space out tracks by the same artist',
    artistGapValue: (tracks) => `at least ${tracks} in between`,
    hideSkipped: 'Hide what I skip',
    hideSkippedHint: 'A track skipped within the first 30 seconds twice won’t come up again',
    onlyNew: 'Only new',
    onlyNewHint: "Only tracks you haven't heard in this app yet",
    history: 'Listening history',
    historyInfo: (tracks) => `${tracks} remembered. Stored only on this device.`,
    clearHistoryTitle: 'Clear history?',
    clearHistoryMessage: 'The repeat filter will start learning from scratch.',
    statsLine: (repeats, received) => `repeats filtered: ${repeats} of ${received}`,
    statsTitle: (s) =>
      `Received from Yandex: ${s.received}. Played recently: ${s.recent}, overplayed: ${s.overplayed}, repeats this session: ${s.duplicate}, skipped: ${s.skipped}, disliked: ${s.disliked}`,
  },
  errors: {
    noTransport: 'No platform transport: run the app through Electron',
    title: 'Something went wrong',
    screenHint: 'The interface stopped because of an error. Reloading usually helps; details are saved to the log.',
    viewTitle: "This page couldn't open because of an error",
    reload: 'Reload',
    home: 'Go home',
    openLog: 'Open log',
  },
};

const DICTS: Record<Lang, Dict> = { ru, en };
const STORAGE_KEY = 'ui.lang';

function storedLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch {
    /* storage unavailable */
  }
  return 'ru';
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: storedLang() }));

export function setLang(lang: Lang) {
  useLang.setState({ lang });
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

/** Strings for the current language; re-renders the component when it changes. */
export function useT() {
  return DICTS[useLang((s) => s.lang)];
}

/** Strings for the current language, for code outside React components. */
export function tr() {
  return DICTS[useLang.getState().lang];
}
