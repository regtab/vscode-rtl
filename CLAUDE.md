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

- **Идентификатор расширения** `regtab.regtab` (name-часть `regtab`), publisher
  `regtab`, displayName «Regular Table Language (RTL)». История: id
  `regtab.regtab-rtl` + displayName «RegTab — Regular Table Language» были
  опубликованы, но **удалены пользователем 2026-07-24** — а удаление в Marketplace
  **безвозвратно ретейрит и id, и displayName** (оба выдают «already exists /
  display name is taken»), поэтому пришлось взять новые. Хук «RegTab matches
  tables the way RegEx matches text» (ассоциация RegEx↔RegTab) сохранён в
  description. После публикации id неизменен; displayName менять можно (и мы это
  сделали апдейтом). **Больше листинг не удалять** — сожжёт `regtab` и текущий
  displayName. Имя «RegTab Tools» зарезервировано под будущий extension pack
  (линтер-плюс, визуальный дизайнер), для одиночного расширения не использовать.
  Детали блокировок публикации — [[marketplace-injection-keyword-block]].
- **Нормативная грамматика** — `RTL.g4` (закреплена из jRegTab, копия в pyregtab;
  текущий паритет — jRegTab 0.4.1). Токены RTL **case-insensitive**.
- **Единый источник истины для tmLanguage** — после фазы 0 этот репозиторий; в
  `pyregtab/ide/` и `jregtab/ide/` остаются только указатели. Изменение `RTL.g4`
  в upstream-проектах требует синхронной правки грамматик здесь (CI: sync-check).
- **`rtl-lsp`** — автономный Rust-бинарь на tower-lsp поверх ядра pyregtab:
  git-зависимость, **закреплённая на релизный тег** (сейчас `v0.5.0`,
  `default-features = false` — без pyo3), коммит зафиксирован в
  `server/Cargo.lock`. Соседний checkout pyregtab для сборки не нужен (нужен
  только генератору hover). Пин обязателен: семантика исполнения RTL — часть
  контракта расширения, плавающий `main` уже менял поведение preview молча
  (`S_delim` в 0.5.0). Обновление тега — осознанная правка `server/Cargo.toml`
  по процедуре из DEVELOPMENT.md. Пререквизиты ядра выпущены: фича `python`
  (гейтинг pyo3, с 0.4.0), `compile_permissive` (заглушки `EXT('…')`), span
  ошибок.
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
