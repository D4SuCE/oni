# Сторож Яндекс Музыки — 2026-11-14 15:41

- Официальное приложение: **5.127.0** (прошлое: 5.127.0)
- Тесты API на аккаунте: **ПАДАЮТ**
- Отпечаток: не снимался (то же приложение)
- Распакованное приложение: `—`

## Вывод тестов API

```

> wave-player@3.6.3 test:api
> node --experimental-strip-types tests/api.test.ts

  ok   account
  ok   search
  ok   tracks by key
  ok   album with tracks
  ok   artist brief info + tracks
  ok   similar tracks
  ok   chart + new releases
       codec=mp3 bitrate=320
  ok   stream url plays (range request)
       lyrics: synced, 942 chars
  ok   lyrics endpoint accepts signature
  ok   library reads
  ok   like / unlike (reverted)
  ok   dislike / undislike (reverted)
  ok   playlist create / add / remove / rename / delete
  FAIL every choice in "Tune" reaches Yandex as a setting of its own, and Yandex takes it: Error: fetch failed
    at YandexMusic.call (file:///home/runner/work/oni/oni/src/api/yandex.ts:165:13)
    at async YandexMusic.waveStart (file:///home/runner/work/oni/oni/src/api/yandex.ts:535:15)
    at async file:///home/runner/work/oni/oni/tests/api.test.ts:183:15
    at async test (file:///home/runner/work/oni/oni/tests/api.test.ts:51:5)
    at async file:///home/runner/work/oni/oni/tests/api.test.ts:165:1
  ok   wave: contexts, start, more, radioStarted feedback

14 passed, 1 failed

```