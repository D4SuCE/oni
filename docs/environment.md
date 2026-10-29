# Окружение Oni — подробно

Краткое — в CLAUDE.md, «Окружение»; здесь — всё остальное (адреса, секреты, аккаунты, облако). Обновлять
здесь, когда меняется окружение.

- Код: **D4SuCE/oni** (GitHub). С 22.10.2026 на время разработки **публичный** (решение
  пользователя: минуты macOS бесплатны); вернуть в приватный — по его команде
  (`gh repo edit D4SuCE/oni --visibility private --accept-visibility-change-consequences`).
  Перед открытием история проверена: токена нет. Секреты в код и логи не класть. Выпуски: публичный **D4SuCE/oni-releases**
  (установщики Windows, IPA, `sidestore.json`, страница со скриншотами). Токен в программу не
  встраивается — поэтому выпуски отдельно (решение пользователя).
- `main` в D4SuCE/oni защищён правилом (ruleset «main: только PR», 28.10.2026): только PR, зелёная `check`,
  без принудительной записи и удаления. Слияние — только squash (название PR + « (#N)»), ветки удаляются сами.
  Обойти правило не может никто, в том числе владелец; в крайнем случае — выключить ruleset в настройках и вернуть.
- Организация **oni-music** на GitHub (создана пользователем 29.10.2026, бесплатная, владелец — D4SuCE): репозиторий
  `oni-music/oni-music.github.io` (публичный) — страница ссылок «Поделиться» `https://oni-music.github.io/#track/<id>`.
  Исходник — папка `site/` в D4SuCE/oni, выкладка — `npm run site` (`scripts/publish-site.mjs`, через `gh api`);
  GitHub Pages обновляется примерно за минуту.
- Секрет репозитория `YANDEX_MUSIC_TOKEN` — для входа на iOS-симуляторе в CI (разрешено
  пользователем); из логов вычищается.
- CI: `.github/workflows/check.yml` (каждый push, Linux, дёшево) и `ios.yml` (минуты macOS ×10).
  По тегу `ios.yml` только собирает IPA (~1,5 мин ≈ 20 списанных); проверка на симуляторе (+3 мин,
  всего ≈ 50 списанных) — только вручную: `gh workflow run ios.yml --ref <ветка>` (по умолчанию
  `smoke=true`), один раз на партию iOS-правок перед выпуском. Не гонять её на каждую правку и не
  повторять «not acquired» без нужды. 22.10.2026 израсходовано 1 844 из 2 000 (письмо GitHub). Пока репозиторий публичный, минуты не списываются; прогоны iOS
  можно не экономить (но и не гонять впустую). Бюджет — `gh api users/D4SuCE/settings/billing/actions`
  (нужен `gh auth refresh -s user`).
- Папка данных Windows-версии — `%APPDATA%/Wave` (имя со старого названия, менять нельзя:
  потеряются вход и история).
- Сборка для себя: `npx electron-builder --win -c.directories.output=release/oni`
  (если папка занята запущенной копией — `release/oni-next`).
  Сборки не копить: `npm run release` сам удаляет установщики версии после выкладки (оставляет
  `notes.md`); сборки «для себя» удалять, когда проверены (22.10.2026 папка `release` весила 11 ГБ).
- Для установки SideStore на компьютере стоят iTunes и **iloader** (`%LOCALAPPDATA%/iloader`,
  winget `nabdev.iloader`) — по инструкции docs.sidestore.io. Тихая установка iTunes через winget
  не ставит Apple Mobile Device Support (без неё iloader не видит iPhone): её MSI достаётся из
  `iTunes64Setup.exe /extract` и ставится `msiexec /i AppleMobileDeviceSupport64.msi`.
- Сторож в облаке: `.github/workflows/ym-watch.yml` (каждый день 09:00 UTC = 12:00 МСК; `scripts/ym-watch.mjs`),
  состояние — ветка `ym-watch` (`snapshot.json`, `report.md`, `pending.md` — ждёт разбора), код новой версии —
  артефакт `yandex-app` запуска. Агент — routine Claude Code «Oni — сторож Яндекс Музыки» (10:00 UTC,
  https://claude.ai/code/routines), окружение `Default` с переменными `GH_TOKEN` и `YANDEX_MUSIC_TOKEN`.
  Секрет `RELEASES_TOKEN` в D4SuCE/oni — токен с правом выпусков D4SuCE/oni-releases (для `release.yml`).
  Обновления приложения Яндекса: `https://desktop.app.music.yandex.net/stable/latest.yml` (узлы CDN отвечают
  разными версиями, пока новая раскатывается — берётся самая новая из нескольких ответов).
- Автопилот: две routine «Oni — разработка» (дважды в час, Opus 5.5) делают по одной задаче из «Очереди задач»
  в ROADMAP по `docs/autopilot.md`; замок — ветка `autopilot`. Выключить — на https://claude.ai/code/routines.
  24.10.2026 пользователь удалил их на аккаунте d4suce (сторож пока там). **25.10.2026 ночью созданы на d4suceusa**
  (выбор пользователя — облако, «путь Б»: ПК не нужен, каждый запуск — новый чат): «Oni — разработка (:10)»
  `trig_01AB2cC8ZymgrLdFpaCSZN57` и «(:40)» `trig_011V6qEhea3p3dmS1y5zspDd`, Opus 5.5, окружение `Default`
  (`env_01FQFjofqG7StSuhtPrd7bLD`: `GH_TOKEN`, `YANDEX_MUSIC_TOKEN` есть, `YANDEX_DISK_TOKEN` нет — шаги пульта в облаке
  пропускаются). Облаку открыт только D4SuCE/oni (oni-releases — нет; выпуски выкладывает `release.yml`).
  **Метки (`vX.Y.Z`) облако создать не может** (25.10.2026: посредник обрывает `git push` метки, API `git/refs` — 403):
  автопилот доводит выпуск до коммита «Release x.y.z» в `main`, метку ставит и отправляет пользователь на ПК.
  Запись в GitHub из облака d4suceusa заработала 25.10.2026 в 11:56 МСК (пользователь подключил GitHub на claude.ai).
  **25.10.2026, 11:57 МСК — обе routine выключены** (пользователь работает в чате); включить — по его команде
  (RemoteTrigger `update` `{"enabled": true}` или на https://claude.ai/code/routines).
- Аккаунты Claude (24.10.2026): Oni ведётся с **d4suceusa@gmail.com** — облачные routine, окружение и лимиты
  там; d4suce@gmail.com — основной, для других проектов. Пользователь запускает так: папка проекта →
  терминал (Windows PowerShell) → `claude` (d4suce) или `claude d4suceusa` (можно и почтой; новая почта
  заводит новый аккаунт), `claude-accounts` — список. Это функция из `~/.claude-accounts/claude-accounts.ps1`,
  подключена в `$PROFILE` (для этого политика PowerShell CurrentUser = RemoteSigned). У каждого аккаунта,
  кроме основного (`~/.claude`), своя папка `~/.claude-accounts/<имя>` (`CLAUDE_CONFIG_DIR`: свой вход,
  история, память проектов). Хуки уведомлений везде вызывают общий `~/.claude/notify.ps1`.
  Вход хранится в папке аккаунта: `/login` внутри `claude d4suceusa` меняет только его, внутри `claude` — основной
  (24.10.2026 в основной по ошибке попал вход d4suceusa; теперь `claude` предупреждает, если почта не d4suce).
- Лимиты (25.10.2026, аккаунт d4suceusa): строка состояния Claude Code — `~/.claude-accounts/d4suceusa/limits/statusline.mjs`
  (показывает 5-часовой и недельный лимит, пишет их в `limits.json` рядом), хук `PostToolUse` — `guard.mjs` там же: на 93%
  пятичасового лимита велит не начинать нового, на 97% — сохранить всё (коммит, push, ROADMAP/CHANGELOG) и закончить
  (желание пользователя: работать, пока лимита не станет около 97%). Работает только в терминале на ПК (облачные routine
  строку состояния не получают).
- Сторож на ПК (запасной, задача Планировщика «Oni - Yandex Music watch»; данные — `%LOCALAPPDATA%/oni-watch`) выключен,
  когда заработал облачный; его скрипты удалены 25.10.2026 (есть в истории git до коммита оптимизации).
- Официальное приложение Яндекс Музыки стоит у пользователя
  (`%LOCALAPPDATA%/Programs/YandexMusic`, Electron): адреса неизвестных запросов API можно найти
  в его `resources/app.asar` (так найден `ugc/tracks/<id>/change`).
