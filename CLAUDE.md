# vscode-rtl

Расширение VS Code для RTL (Regular Table Language) — DSL паттернов таблиц проекта
RegTab. Универсальное: обслуживает все реализации RegTab (jRegTab, pyRegTab, будущие),
не требуя у пользователя ни Python, ни JDK.

**Дорожная карта — `plans/VSCODE_RTL_PLUGIN_PLAN.md`.** Реализация идёт по его фазам
(0: перенос подсветки и публикация → 1: сниппеты/тесты грамматики → 2: LSP-диагностика →
3: языковые фичи → 4: превью матчинга). Прежде чем менять архитектурные решения,
сверяйся с планом; изменение решения = правка плана в том же PR.

## Связанные проекты (локальные пути)

| Проект | Путь | Что берём |
|---|---|---|
| pyRegTab | `d:\YandexDisk\code2\pyregtab` | Прототип расширения `ide/vscode/` (tmLanguage `.rtl`, Python-инъекция, language-configuration, package.json); нормативная грамматика `grammar/RTL.g4`; Rust-ядро компилятора `src/rtl/*` (база будущего `rtl-lsp`); conformance-корпус `conformance/{positive,negative}` (тестовые `.rtl`); справочник `docs/rtl-reference.md` (источник hover-контента и сниппетов); `tools/check_grammar_sync.py` |
| jRegTab | `d:\YandexDisk\code2\jregtab` | Происхождение нормативной `RTL.g4`; готовая Java-инъекция `ide/vscode/syntaxes/rtl-java-injection.tmLanguage.json`; свой `ide/README.md` |
| data-wrangling-eval | `d:\YandexDisk\code2\data-wrangling-eval` | Реальный пример standalone-использования `.rtl`: решения `solutions/regtab/task_NNN.rtl`, данные `fixtures/task_NNN/{input_k.csv, expected_k.csv, task_match_options.json}` — эталонный сценарий для превью и `rtl.fixtures.*` |

## Ключевые факты и инварианты

- **Идентификатор расширения** `regtab.regtab-rtl` (переименован 2026-07-19:
  Marketplace требует глобально уникальную name-часть, «rtl» занят
  right-to-left-расширением; displayName «RegTab — Regular Table
  Language», решение 2026-07-18: ассоциация RegEx↔RegTab, хук «RegTab matches
  tables the way RegEx matches text» в description), publisher `regtab`. После
  публикации id не меняется; displayName менять можно. Имя «RegTab Tools»
  зарезервировано под будущий extension pack (линтер-плюс, визуальный дизайнер),
  для одиночного расширения не использовать.
- **Нормативная грамматика** — `RTL.g4` (закреплена из jRegTab, копия в pyregtab;
  текущий паритет — jRegTab 0.4.1). Токены RTL **case-insensitive**.
- **Единый источник истины для tmLanguage** — после фазы 0 этот репозиторий; в
  `pyregtab/ide/` и `jregtab/ide/` остаются только указатели. Изменение `RTL.g4`
  в upstream-проектах требует синхронной правки грамматик здесь (CI: sync-check).
- **`rtl-lsp`** (фаза 2+) — автономный Rust-бинарь на tower-lsp поверх ядра pyregtab
  (git-зависимость `default-features = false`). Пререквизит в pyregtab ещё НЕ сделан:
  cargo-фича `python` (гейтинг pyo3), `compile_permissive` (заглушки `EXT('…')`),
  span ошибок. Без пермиссивного режима валидные `.rtl` с `EXT` дают ложные ошибки.
- **Находимость в Marketplace**: запрос «RTL» занят right-to-left-расширениями —
  в названиях/keywords использовать «Regular Table Language», «RegTab»,
  «table extraction».
- Канонизация через `AtpToRtlSerializer` — нормализация, не стилевой форматтер
  (наследуемые действия опускаются на уровень атомов). Реализована **только** как
  read-only-команда «RTL: Show Canonical Form» (решение 2026-07-17): сериализация
  теряет комментарии (в т.ч. `// fixture:`), поэтому форматтера/format-on-save
  нет и не будет.

## Соглашения

- Документы (планы, README разделов) — на русском; код, идентификаторы, тексты
  UI расширения и страница Marketplace — на английском.
- Тестовые `.rtl` копируются из conformance-корпуса pyregtab с фиксацией его версии
  (`conformance/VERSION`), не редактируются вручную.
- Коммиты/релизы: semver расширения независим от версий jRegTab/pyRegTab; версия
  грамматики фиксируется в README и в ответе `initialize` сервера.
- **Публикация в Marketplace/Open VSX — только с явного одобрения пользователя**
  (каждый раз): не запускать `vsce publish`/`ovsx publish` и не пушить теги `v*`
  (release.yml публикует) самостоятельно.
