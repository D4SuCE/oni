# Сторож Яндекс Музыки — 2026-10-30 15:46

- Официальное приложение: **5.125.3** (прошлое: 5.125.3)
- Тесты API на аккаунте: **ПАДАЮТ**
- Отпечаток: не снимался (то же приложение)
- Распакованное приложение: `—`

## Вывод тестов API

```

> wave-player@3.0.2 test:api
> node --experimental-strip-types tests/api.test.ts

  ok   account
  ok   search
  ok   tracks by key
  ok   album with tracks
  ok   artist brief info + tracks
  ok   similar tracks
  ok   chart + new releases
  FAIL stream url plays (range request): TypeError: fetch failed
       lyrics: synced, 942 chars
  ok   lyrics endpoint accepts signature
  ok   library reads
  ok   like / unlike (reverted)
  ok   dislike / undislike (reverted)
  ok   playlist create / add / remove / rename / delete
       21 choices, 19 different requests, all taken; 21 different first batches
  ok   every choice in "Tune" reaches Yandex as a setting of its own, and Yandex takes it
  ok   wave: contexts, start, more, radioStarted feedback

14 passed, 1 failed

```