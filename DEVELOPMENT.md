# Разработка

## Состав

| Слой | Где | Сборка |
|---|---|---|
| Декларативный (грамматики, сниппеты) | `syntaxes/`, `snippets/`, `language-configuration.json` | не требуется |
| TS-клиент | `client/src/extension.ts` | `npm run build:client` (esbuild → `dist/extension.js`) |
| LSP-сервер `rtl-lsp` | `server/` (Rust, tower-lsp) | `cargo build --release` в `server/` |

## Зависимость от pyregtab

`rtl-lsp` использует чистое Rust-ядро pyregtab
(`default-features = false` — без pyo3). Пока пререквизитная работа
(cargo-фича `python`, `compile_permissive`, позиции ошибок) живёт в main
pyregtab и не выпущена релизом, зависимость — **path**
на соседний checkout: `../../pyregtab` (его main должен быть
выкачан). CI раскладывает репозитории так же (checkout pyregtab рядом).
После релиза pyregtab с этой работой зависимость переключается на
закреплённый git-тег (план §3.2).

На Windows с тулчейном `x86_64-pc-windows-gnu`: если сборка падает с
«error calling dlltool», проверьте, что `parking_lot_core` закреплён на
0.9.9 в `server/Cargo.lock` (raw-dylib новых версий требует dlltool,
которого нет в rust-mingw по умолчанию).

## Тесты

- `npm test` — типы клиента, снапшоты грамматики, юнит-тесты клиента
  (извлечение литералов, привязка фикстур/expected), sync-check с `RTL.g4`.
- `cd server && cargo test` — юнит-тесты диагностики, канонизации и
  expected-сравнения + conformance-корпус (позитив: ноль диагностик;
  негатив: точные позиции; `ext_unbound_*` обязаны компилироваться в
  пермиссивном режиме).
- `npm run test:e2e` — смоук через `@vscode/test-electron`: расширение
  активируется, сервер поднимается, битый `.rtl` даёт диагностику,
  канонизация открывает read-only-вид, expected-diff считается end-to-end,
  ошибка в Python-литерале подчёркивается в хост-координатах
  (нужен собранный бинарь в `bin/`).

## Сборка VSIX

- Универсальный (только подсветка): `npx vsce package` при **пустом** `bin/`.
- Платформенный: положить `rtl-lsp(.exe)` в `bin/`, затем
  `npx vsce package --target win32-x64` (и т.д. — список таргетов в
  `release.yml`).

## Публикация

Только вручную и только с явного одобрения владельца: push тега `v*`
запускает `release.yml` (нужен секрет `VSCE_PAT`; `OVSX_PAT` опционален —
без него шаг Open VSX корректно пропускается). Альтернатива — ручная
загрузка VSIX через marketplace.visualstudio.com/manage (PAT не нужен).
