# План: синхронизация с pyRegTab 0.5.1 (семантика `ANCH(n)`/`REC(n)`, пин ядра, hover)

**Статус:** В РАБОТЕ
**Дата:** 2026-08-26
**Триггер:** pyRegTab 0.5.1 (тег `v0.5.1`, merge `0eb6ea5`, PR #9) исправил
пост-трансформацию `ANCH(n)`/`REC(n)`: раньше вектор перестановки применялся
только к значениям записей, а схема возвращалась неизменной, и для
**именованных** атрибутов (полученных через `AVP`) связка имя ↔ значение
разъезжалась — столбец с именем якоря получал чужие значения.
**Репозиторий:** `github.com/regtab/vscode-rtl` (этот)
**Ветка:** `feature/pyregtab-051-sync`
**Связанные проекты:**
- `pyregtab` (`d:\YandexDisk\code2\pyregtab`) — Rust-ядро, от которого зависит
  `rtl-lsp`; источник `docs/rtl-reference.md` для hover-словаря; ядро правки —
  `src/spec.rs`, `apply_anchor_at_position`; план `plans/ANCH_MOVES_ATTRIBUTE.md`;
- `jregtab` (`d:\YandexDisk\code2\jregtab`) — нормативная грамматика `RTL.g4`
  (пин в `grammar/UPSTREAM`), происхождение фикса (jRegTab 0.5.1).

---

## 1. Контекст

`ANCH(n)` теперь переставляет **сам атрибут** — имя вместе со значениями — на
0-based позицию `n`; меняется только порядок схемы. Правило одно для именованных
и анонимных: анонимные имена не перенумеровываются (`$a_1..$a_4` при `ANCH(2)` →
`$a_2, $a_3, $a_1, $a_4`), при этом значения остаются на тех же позициях, что и
раньше. Граничные случаи прежние: позиция 0, позиция `>= len`, схема из одного
атрибута — recordset как есть. Синтаксис, грамматика (`RTL.g4` байт-в-байт та
же) и сериализатор не менялись.

Для расширения это важно ровно в одном месте: **match-preview показывает схему**
извлечённого recordset. `server/src/preview.rs:280` берёт
`schema: rs.schema.attributes` дословно из интерпретатора — расширение не выводит
схему само. Поэтому картинка для паттернов `AVP` + `ANCH(n)`/`REC(n)` меняется и
становится правильной **без единой правки кода preview**.

Подсветка, сниппеты и снапшоты TextMate от семантики исполнения не зависят.

## 2. Установленные факты

Разведка перед планом; каждый пункт проверен, а не предположен.

- `RTL.g4` в jRegTab **байт-в-байт одинаков** на `v0.5.0` и `v0.5.1`: sha256
  `4fffbdf3…` совпадает и с локальной копией, и со строкой `sha256:` в
  `grammar/UPSTREAM`. Строка хэша при бампе пина **не меняется**.
- Теги запушены и резолвятся: pyregtab `v0.5.1` → коммит `0eb6ea5`; jregtab
  `v0.5.1` → коммит `68be345` (объект аннотированного тега — `c126337`).
- Правило конфликта живо: `pyregtab/src/rtl/mod.rs:118` в 0.5.1 по-прежнему даёт
  `"Conflicting ANCH({sa}) and REC({ia})"`. Негативная фикстура
  `server/tests/corpus/negative/conflict_anch_rec.rtl` остаётся зелёной.
- **Ни один тест расширения не трогает `ANCH` семантически.** В `server/src/`
  три вхождения: генерируемый hover (`hover_data.rs:57-59`), список
  автодополнения (`main.rs:402`) и `every_grammar_keyword_has_hover`
  (`main.rs:767`), где проверяется только `lookup(kw).is_some()` — присутствие,
  а не текст. Перегенерация hover его не сломает.
- Корпусные тесты (`server/tests/corpus.rs`) — **compile-only**: наличие и
  позиция диагностик, не схема и не значения. 22 позитивных файла с `REC(n)` и
  ~45 с `AVP` требуют лишь нулевых диагностик.
- e2e `test/e2e/suite/smoke.test.js:87-115` использует `AVP` + голый `REC` (без
  `n`) и шлёт `expected` **без** `hasHeader` (строка 104) — схема там не
  сравнивается вовсе. Тест не поедет.
- Снапшотов и голденов в `server/` нет вообще (нет dev-dependencies, нет `insta`).
- Генератор hover харвестит **только pipe-таблицы**:
  `tables_after('## Settings prefix')[0]`. В разделе ровно одна таблица, поэтому
  новые абзацы прозы 0.5.1 и блок `!!! note "Inline equivalents"` в словарь
  **не попадут**.
- Правки `NORM`/`TRIM` из PR #8 уже в словаре: коммит `b16d3d3` генерировал из
  checkout'а, который был на коммит впереди тега `v0.5.0` (это и был `af7020c`).

## 3. Пин ядра (приоритет: высокий)

`server/Cargo.toml:19` — поднять тег; комментарий выше (строки 13-18) верен по
смыслу, дописывается только ссылка на этот план:

```toml
pyregtab = { git = "https://github.com/regtab/pyregtab.git", tag = "v0.5.1", default-features = false }
```

Затем `cargo build` в `server/` — пересобрать `server/Cargo.lock` и закоммитить
вместе с `Cargo.toml`. Ожидаемая запись (`Cargo.lock:436-443`):

```
version = "0.5.0"                       ->  version = "0.5.1"
source = "git+…?tag=v0.5.0#abca0c7f…"   ->  source = "git+…?tag=v0.5.1#0eb6ea50…"
```

## 4. Hover-словарь (приоритет: высокий)

`server/src/hover_data.rs` помечен `@generated`. **Не править руками** —
перегенерировать из соседнего checkout'а pyregtab (он уже на `v0.5.1`):

```
python tools/gen_hover_data.py
```

Ожидаемый диф — **ровно две записи**. Это проверяемое предсказание: всё сверх
него ревьюится, а не принимается на веру.

- `ANCH` (`hover_data.rs:57-59`): `Use position *n* in the first record as the
  attribute name for all records` → `Move the anchor attribute to 0-based
  position *n* in the schema`;
- `REC` (`hover_data.rs:153-161`, форма `prov->REC(n)`): `Same + use attribute
  at position *n* as the record's attribute name` → `Same + move the anchor
  attribute (name with its values) to position *n*`.

**Проверка:** `git diff --stat` показывает только `hover_data.rs`, а сам диф —
только эти две строки.

## 5. Сниппет (приоритет: низкий)

`snippets/rtl.json`, `"Settings prefix"` — формулировка «anchor column» вводит в
заблуждение: перемещается атрибут, а не берётся имя столбца. `prefix` и `body`
не трогаются, меняется только `description`:

```json
  "Settings prefix": {
    "prefix": "settings",
    "body": "<NORM, ANCH(${1:1})>",
    "description": "Table pattern settings: normalisation and anchor attribute position"
  },
```

## 6. Preview: тест на связку AVP + ANCH(n) (приоритет: высокий)

Код preview менять не нужно, но связка `AVP` + `ANCH(n)` не покрыта **нигде** —
регрессия прошла бы молча. Добавляется один тест в `server/src/preview.rs`, в
существующий `#[cfg(test)] mod tests`, рядом с `end_to_end_match_on_grid` (он же
образец вызова `run(...)`).

Данные берутся из conformance-кейса `anch_named_attrs`, чтобы тест зеркалил
upstream, а не был выдуман:

- сетка: `Dato,Lokaler,Klasse` / `20.05,AU,0` / `11.06,A2.1,1`;
- паттерн:

  ```
  <ANCH(1)>
  [ [ATTR]+ ]
  [ COL->AVP [VAL] [VAL: ROW*->REC] [VAL] ]+
  ```

- ожидание: `schema == ["Dato", "Lokaler", "Klasse"]` и значения под своими
  именами — `["20.05","AU","0"]`, `["11.06","A2.1","1"]`.

Логика, которую тест пиннит: извлечение идёт anchor-first, сырая схема —
`Lokaler, Dato, Klasse`; `ANCH(1)` двигает `Lokaler` на индекс 1 и восстанавливает
порядок колонок таблицы.

**Дискриминирующая проверка (обязательна).** Утверждение по схеме обязано быть
тем, что ловит баг: на ядре `v0.5.0` тест должен падать (схема осталась бы
`Lokaler, Dato, Klasse` при тех же значениях). Проверяется временным откатом
тега. Если тест зелёный на обоих ядрах — он бесполезен и требует усиления.

## 7. Пины, документация, фикстуры (приоритет: средний)

1. `grammar/UPSTREAM` — поднять до jRegTab 0.5.1, строку `sha256:` **не менять**
   (грамматика идентична). Использовать **commit-sha**, а не sha тег-объекта:
   `check_upstream` тянет `raw.githubusercontent.com/…/{commit}/{path}`, который
   понимает коммит-хэш и не понимает объект аннотированного тега `c126337`.

   ```
   commit: 68be345d74f47501531971d7d2ff63595649309b
   tag: v0.5.1
   path: src/main/antlr4/ru/icc/regtab/rtl/RTL.g4
   sha256: 4fffbdf3f2dcb13935b8f062b5c6c55321de08cf130a4a28fa0845f5b48d68c0
   ```

2. Строки версии грамматики — три места, все на 0.5.1:
   - `server/src/main.rs:25` — `GRAMMAR_VERSION = "RTL grammar jRegTab 0.5.1"`
     (уходит в ответ `initialize`; тестами не проверяется);
   - `README.md:159` — `…from **jRegTab 0.5.1**`;
   - `CLAUDE.md:35` — `текущий паритет — jRegTab 0.5.1`.

3. `CLAUDE.md:40` и `DEVELOPMENT.md:15` — текущий тег ядра `v0.5.0` → `v0.5.1`.
   **Не трогать** `CLAUDE.md:45` и `DEVELOPMENT.md:21`: там `S_delim` в 0.5.0 —
   исторический факт, обосновывающий сам пин, а не текущая версия.

4. Фикстуры подсветки — скопировать **оба** новых семантических кейса
   байт-в-байт (LF, UTF-8 без BOM; корпус помечен `-text` в `.gitattributes`):

   | Куда | Откуда |
   |---|---|
   | `test/grammar/fixtures/anch_named_attrs.rtl` | `conformance/semantic/anch_named_attrs/pattern.rtl` |
   | `test/grammar/fixtures/anch_named_inline_delim.rtl` | `conformance/semantic/anch_named_inline_delim/pattern.rtl` |

   Это закрывает две реальные дыры в снапшотах TextMate: сейчас ни одна фикстура
   не содержит настоящей настройки `<ANCH(1)>` (есть только `<FOO>` в
   `settings_unknown.rtl`) и ни одна не содержит делимитированной спецификации
   `{','}`. Снапшоты создаются через `npm run test:grammar:update` и **ревьюятся
   глазами**: `ANCH` обязан получить скоуп от правила
   `syntaxes/rtl.tmLanguage.json:177`, а не свалиться в общий текст.

5. `test/grammar/fixtures/CORPUS.md` — две строки в таблицу источников с явной
   пометкой, что источник `semantic/`, а не `positive/`/`negative/`. Цитату
   блока `VERSION` **не трогать**: `conformance/VERSION` в pyregtab 0.5.1 не
   менялся (проверено `git diff v0.5.0..v0.5.1`).

## 8. Версия и CHANGELOG

Правка фиксирует ядро и меняет видимое поведение preview — patch-релиз **0.8.9**
в `package.json` + запись в `CHANGELOG.md` в стиле существующих.

Публикацию (тег `v0.8.9` → Marketplace + Open VSX) **согласовать отдельно** —
это не часть данного плана.

## 9. Порядок работ

1. §3 (пин + `Cargo.lock`) — первым, чтобы дальше всё собиралось против 0.5.1.
2. §6 (тест preview) — сразу после пина, пока легко откатить тег и проверить
   дискриминирующее падение на 0.5.0.
3. §4 (регенерация hover), §5 (сниппет).
4. §7 (пины, доки, фикстуры + снапшоты).
5. §8 (версия, CHANGELOG).

## 10. Критерий готовности

```
cd server && cargo clippy --all-targets -- -D warnings   # блокирующий в CI
cd server && cargo test                                   # 25+ тестов, вкл. новый
npm test          # check:types + test:grammar + test:unit + check:sync
npm run build:client && npm run test:e2e                  # смоук в реальном VS Code
npx vsce package -o regtab.vsix                           # bin/ пустой; CI держит <200 КБ
```

- `server/Cargo.lock` содержит git-source с тегом `v0.5.1` и коммитом `0eb6ea5`;
- `cargo build` в `server/` проходит **без** соседнего checkout pyregtab;
- `hover_data.rs` перегенерирован скриптом, диф — ровно две записи;
- новый тест preview падает на ядре `v0.5.0` и проходит на `v0.5.1`;
- `check:sync` зелёный; с `JREGTAB_TOKEN` проходит и `check_upstream` на новом
  коммите;
- ни один существующий снапшот в `test/grammar/fixtures/*.snap` не изменился —
  добавились только два новых;
- ни один эталон не подогнан под старое поведение: в дифе нет правок
  `syntaxes/*.tmLanguage.json`, `grammar/RTL.g4`, `server/tests/corpus/**` и
  строки `sha256:` в `grammar/UPSTREAM`.

## 11. Риски

- **Перегенерация hover даёт больший диф, чем две записи** — значит соседний
  checkout разошёлся с тегом сильнее, чем на PR #8/#9. Ревьюить диф целиком:
  генератор индексирует таблицы позиционно (`prov[0..4]`, `atomic[0..1]`), и
  новая таблица в reference молча перекосит весь словарь.
- **Новый тест preview окажется недискриминирующим** — если он зелёный и на
  0.5.0, утверждение слабое. План Б: сравнивать полную пару схема ↔ запись.
- **Снапшот новой фикстуры зафиксирует неверную подсветку** —
  `vscode-tmgrammar-snap` пишет то, что есть, а не то, что должно быть. Скоупы
  `<ANCH(1)>` и `{','}` читаются глазами при первом создании; кривая подсветка —
  это находка (баг tmLanguage), а не повод принять снапшот.
- **Сеть на шаге `cargo build`** — git-зависимость требует доступа к GitHub в CI.

## 12. Результат

_Заполняется по факту реализации._

## 13. Что осознанно не трогается

- `server/src/preview.rs` (кроме нового теста), `client/src/preview.ts`,
  `client/src/previewRender.ts` — схема прокидывается из ядра как есть.
- `grammar/RTL.g4`, `syntaxes/*.tmLanguage.json`, строка `sha256:` — грамматика
  0.5.1 идентична 0.5.0.
- `server/tests/corpus/**` — корпус compile-only, новые кейсы семантические;
  негативная `conflict_anch_rec.rtl` остаётся валидной.
- `CLAUDE.md:45`, `DEVELOPMENT.md:21` — историческая ссылка на `S_delim` в 0.5.0.
- Публикация в Marketplace/Open VSX и пуш тега `v*` — только по отдельной команде.

**Бэклог, не в этот PR** (обе проблемы предсуществующие, не вызваны синком):

1. Вендоренный корпус протух: `server/tests/corpus/positive/` содержит 151 файл
   против 304 у pyregtab (304 было уже на `v0.5.0`), а
   `server/tests/corpus/VERSION` говорит `generated: 2026-07-07`, тогда как
   `test/grammar/fixtures/CORPUS.md` цитирует тот же VERSION как `2026-08-26` —
   два документа противоречат друг другу. Досинхронизация — это +153 файла,
   отдельная задача.
2. У `hover_data.rs` нет никакой проверки свежести — ни режима `--check` у
   `tools/gen_hover_data.py`, ни шага в `ci.yml` (в отличие от `RTL.g4` с
   sha256-пином и `check_grammar_sync.py`). Гейт потребовал бы соседнего
   checkout pyregtab в CI, от которого джоб `server` специально избавили.
