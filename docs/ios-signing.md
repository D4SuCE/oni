# Подпись iOS-приложения и её автоматизация

Коротко: iOS запускает только подписанные приложения. Подпись состоит из
**сертификата** (кто подписал) и **provisioning profile** (какое приложение, на
каких устройствах и с какими возможностями). Собрать и подписать iOS-приложение
можно только на macOS с Xcode. С Windows это делается через облачный Mac:
GitHub Actions с macOS-раннером.

> Цены и лимиты Apple ниже указаны по состоянию на момент написания. Перед
> оплатой сверьтесь с developer.apple.com.

## Какой путь выбрать

| | Бесплатный Apple ID | Apple Developer Program (~$99 в год) |
| --- | --- | --- |
| Сколько живёт установка | 7 дней, потом нужна переподпись | Сертификат — 1 год, сборка TestFlight — 90 дней |
| Как ставить | SideStore / AltStore / Sideloadly | TestFlight (как обычное приложение) |
| Автообновление | Через «источник» SideStore | TestFlight обновляет сам |
| Подпись на CI | Нет: CI собирает **неподписанный** IPA, подписывает SideStore на телефоне | Да, полностью автоматически |
| Ограничения | 3 приложения на устройство, 10 App ID в неделю, часть entitlements недоступна | Почти нет. App Store, скорее всего, не пропустит неофициальный клиент, но TestFlight для себя работает |

**Рекомендация.** Для себя и бесплатно — путь A (SideStore). Если готовы
платить — путь B (TestFlight): удобнее всего, приложение ставится и
обновляется как обычное.

Фоновое воспроизведение (`UIBackgroundModes: audio`) — не отдельный
entitlement, оно работает на обоих путях.

---

## Путь A. Бесплатно: неподписанный IPA из CI + SideStore

Идея: CI каждый раз собирает IPA **без подписи**, а SideStore на телефоне
подписывает его вашим Apple ID и сам продлевает подпись раз в 7 дней — без
компьютера.

### Однократная настройка на телефоне
1. Установить SideStore по инструкции с сайта проекта (sidestore.io). Для первой
   установки один раз нужен компьютер: создаётся pairing-файл.
2. iOS 16 и новее: «Настройки → Конфиденциальность и безопасность → Режим
   разработчика» → включить, перезагрузить телефон.
3. Войти в SideStore своим Apple ID. Лучше отдельным, а не основным.

### Что делает CI (GitHub Actions, `macos-latest`)
```yaml
# .github/workflows/ios-unsigned.yml (набросок)
on: { push: { tags: ['v*'] }, workflow_dispatch: {} }
jobs:
  ipa:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci && npm run build && npx cap sync ios
      - name: Build without signing
        run: |
          xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
            -configuration Release -sdk iphoneos -derivedDataPath build \
            CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
          mkdir Payload && cp -R build/Build/Products/Release-iphoneos/App.app Payload/
          zip -qr Wave.ipa Payload
      - uses: softprops/action-gh-release@v2
        with: { files: Wave.ipa }
```

### Автообновление
SideStore поддерживает «источники»: JSON-файл со списком версий и ссылками на
IPA. CI после сборки обновляет `sidestore-source.json` (версия, дата,
`downloadURL` на релиз). Источник добавляется в SideStore один раз, после этого
новые версии приходят сами.

### Частые проблемы
- «Недоверенный разработчик»: «Настройки → Основные → VPN и управление
  устройством» → доверять своему Apple ID.
- Приложение перестало открываться через 7 дней: SideStore не смог продлить
  подпись. Откройте его, и он продлит. Нужен интернет и работающий
  LocalDevVPN/WireGuard из инструкции SideStore.
- Бандл ID должен быть уникальным. SideStore сам добавляет суффикс к
  `local.wave.player`.

---

## Путь B. Платно: полностью автоматическая подпись и TestFlight

### Однократно, руками (около 20 минут)
1. Вступить в Apple Developer Program.
2. В App Store Connect создать приложение с бандл ID, например
   `ru.<вы>.wave`. В Certificates, Identifiers & Profiles включить у этого ID
   нужные возможности: для фонового звука ничего не нужно.
3. App Store Connect → Users and Access → Integrations → **App Store Connect API**
   → создать ключ с ролью *App Manager*. Сохранить: `Key ID`, `Issuer ID` и
   файл `AuthKey_XXXX.p8`. Файл скачивается **один раз**.
4. Узнать `Team ID` (Membership details).
5. В GitHub-репозитории → Settings → Secrets and variables → Actions добавить:
   - `ASC_KEY_ID`, `ASC_ISSUER_ID`, `APPLE_TEAM_ID`;
   - `ASC_KEY_P8_BASE64` — содержимое `.p8` в base64
     (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))`).

Сертификаты и профили вручную создавать **не нужно**: Xcode с API-ключом
делает это сам (automatic signing + `-allowProvisioningUpdates`).

### Что делает CI
```yaml
# .github/workflows/ios-testflight.yml (набросок)
on:
  push: { tags: ['v*'] }
  schedule: [{ cron: '0 6 1 */2 *' }]   # раз в 2 месяца: сборки TestFlight живут 90 дней
  workflow_dispatch: {}
jobs:
  testflight:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci && npm run build && npx cap sync ios
      - name: API key
        run: |
          mkdir -p ~/.appstoreconnect/private_keys
          echo "${{ secrets.ASC_KEY_P8_BASE64 }}" | base64 --decode \
            > ~/.appstoreconnect/private_keys/AuthKey_${{ secrets.ASC_KEY_ID }}.p8
      - name: Archive (automatic signing)
        run: |
          xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release \
            -archivePath build/Wave.xcarchive -destination 'generic/platform=iOS' archive \
            DEVELOPMENT_TEAM=${{ secrets.APPLE_TEAM_ID }} CODE_SIGN_STYLE=Automatic \
            CURRENT_PROJECT_VERSION=${{ github.run_number }} \
            -allowProvisioningUpdates \
            -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_${{ secrets.ASC_KEY_ID }}.p8 \
            -authenticationKeyID ${{ secrets.ASC_KEY_ID }} \
            -authenticationKeyIssuerID ${{ secrets.ASC_ISSUER_ID }}
      - name: Export and upload to TestFlight
        run: |
          cat > ExportOptions.plist <<EOF
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0"><dict>
            <key>method</key><string>app-store-connect</string>
            <key>destination</key><string>upload</string>
            <key>teamID</key><string>${{ secrets.APPLE_TEAM_ID }}</string>
            <key>signingStyle</key><string>automatic</string>
          </dict></plist>
          EOF
          xcodebuild -exportArchive -archivePath build/Wave.xcarchive \
            -exportOptionsPlist ExportOptions.plist -exportPath build/export \
            -allowProvisioningUpdates \
            -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_${{ secrets.ASC_KEY_ID }}.p8 \
            -authenticationKeyID ${{ secrets.ASC_KEY_ID }} \
            -authenticationKeyIssuerID ${{ secrets.ASC_ISSUER_ID }}
```

Важные детали:
- `CURRENT_PROJECT_VERSION` (номер сборки) должен расти с каждой загрузкой,
  поэтому берётся `github.run_number`.
- Внутреннее тестирование TestFlight (до 100 человек из вашей команды App Store
  Connect) работает **без ревью Apple**: сборка становится доступна через
  несколько минут после обработки.
- Альтернатива для больших команд — **fastlane match**: сертификаты и профили
  хранятся зашифрованными в отдельном приватном git-репозитории, и все машины
  подписывают одним сертификатом. Для одного разработчика automatic signing с
  API-ключом проще: не нужно второго репозитория и пароля шифрования.

### Частые проблемы
- `No signing certificate "iOS Distribution" found` — у ключа роль ниже
  *App Manager* или не передан `-allowProvisioningUpdates`.
- `The bundle version must be higher` — не увеличен `CURRENT_PROJECT_VERSION`.
- Сборка висит в «Processing» — это нормально, обработка занимает 5–30 минут.
- Нужен `ITSAppUsesNonExemptEncryption = NO` в `Info.plist`, иначе каждую
  сборку придётся вручную подтверждать в App Store Connect (HTTPS этого не
  требует).

---

## Что понадобится от вас

Обоим путям нужен **удалённый репозиторий на GitHub**: macOS-раннеры есть
только в облаке. Сам я его не создаю и код никуда не отправляю — это ваше
решение. Для приватного репозитория бесплатных минут на GitHub Free хватает:
минуты macOS считаются с множителем ×10, а одна сборка занимает ~10–15 минут.

Для пути B дополнительно: аккаунт Apple Developer и четыре секрета из
шага 5 выше.
