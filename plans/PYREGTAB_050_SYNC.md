# План: синхронизация с pyRegTab 0.5.0 (пин зависимости, пустые токены, устаревшие пины)

**Статус:** ВЫПОЛНЕН (0.8.8; публикация не запускалась)
**Дата:** 2026-08-26
**Триггер:** pyRegTab 0.5.0 (2026-08-26) изменил семантику исполнения
делимитированной спецификации `S_delim` — ломающее изменение, которое доехало
до `rtl-lsp` молча, через плавающую зависимость на `pyregtab@main`.
**Репозиторий:** `github.com/regtab/vscode-rtl` (этот)
**Связанные проекты:**
- `pyregtab` (`d:\YandexDisk\code2\pyregtab`) — Rust-ядро, от которого зависит
  `rtl-lsp`; источник `docs/rtl-reference.md` для hover-словаря;
- `jregtab` — нормативная грамматика `RTL.g4` (пин в `grammar/UPSTREAM`).

---

## 1. Контекст

В pyRegTab 0.5.0 делимитированная спецификация `(VAL){","}` перестала обрезать
токены и выбрасывать пустые. Теперь `n` подстрок всегда дают `n` элементов с
номерами `0..n-1`, пробелы сохраняются, обрезка — opt-in через экстрактор
атома (`(VAL=TRIM){","}`). Синтаксис, грамматика и сериализатор не менялись,
поэтому подсветка, сниппеты и снапшоты TextMate не затронуты.

Проверка расширения показала: **тесты сервера зелёные** (28/28 против
pyregtab 0.5.0), крэшей нет. Но есть три проблемы разного веса.

Что проверено и **не** требует правок:
- 11 `.rtl`-фикстур в `test/grammar/fixtures/` байт-в-байт совпадают с текущим
  conformance-корпусом (задач 045/055/101, единственных с делимитированной
  спекой, там нет) — снапшоты не поедут;
- `bin/` в `.gitignore`, в VSIX кладётся свежесобранный сервер — устаревшего
  бинарника расширение не поставляет;
- `byte_span_to_chars` в `server/src/preview.rs` корректно обрабатывает спан
  нулевой ширины: для `"a,,b"` со спаном `(2,2)` возвращает `(2,2)`;
- сниппеты, `fixtures.ts`, e2e-тесты делимитированной семантики не касаются.

## 2. Проблема 1 — плавающая зависимость (приоритет: высокий)

`server/Cargo.toml` тянет ядро path-зависимостью на соседний checkout, а оба
workflow (`ci.yml`, джоб `server`; `release.yml`, джоб `build`) делают
`actions/checkout` репозитория `regtab/pyregtab` с **`ref: main`**. Семантика
исполнения RTL — часть контракта расширения, и плавающий `main` меняет
поведение preview без единого сигнала. Именно так и произошло.

Комментарий в `server/Cargo.toml` сам предписывает лечение и называет условие:

> Switch to the planned pinned git dependency … once pyregtab releases a
> version containing the `python` feature split.

Условие выполнено: раздел `[features]` с `python`/`default` есть начиная с
pyregtab 0.4.0, репозиторий `regtab/pyregtab` **публичный**, релиз 0.5.0 с
тегом `v0.5.0` опубликован. Токен для fetch не нужен.

### Что делать

1. `server/Cargo.toml` — заменить path-зависимость на пин по тегу и переписать
   комментарий (старый описывает временное решение, которого больше нет):

   ```toml
   [dependencies]
   # Чистое Rust-ядро RTL (компилятор, матчер, интерпретатор) из pyRegTab.
   # Пин на релизный тег принципиален: семантика исполнения RTL — часть
   # контракта расширения, и плавающий main менял бы поведение preview без
   # единого сигнала (так и вышло с S_delim в pyregtab 0.5.0). Обновление
   # версии — осознанная правка этой строки, см. plans/PYREGTAB_050_SYNC.md.
   pyregtab = { git = "https://github.com/regtab/pyregtab.git", tag = "v0.5.0", default-features = false }
   ```

2. `server/Cargo.lock` — пересобрать (`cargo build` в `server/`) и закоммитить.
   Сейчас в нём записан `pyregtab 0.3.0`: lock устарел на две версии и молча
   переписывается при любой сборке. После пина в нём появится `source =
   "git+https://github.com/regtab/pyregtab.git?tag=v0.5.0#<rev>"` — это и есть
   фиксация конкретного коммита.

3. `.github/workflows/ci.yml` — в джобе `server` удалить шаг
   `actions/checkout` с `repository: regtab/pyregtab`. Первый checkout с
   `path: vscode-rtl` **оставить как есть**: все `working-directory:` в джобе
   на него завязаны, менять их — лишний диф.

4. `.github/workflows/release.yml` — то же самое в джобе `build`. Джоб
   `build-universal` pyregtab не выкачивает, его не трогать.

5. `DEVELOPMENT.md`, раздел «Зависимость от pyregtab» (строки ~11–19) —
   переписать: сборка больше не требует соседнего checkout pyregtab, cargo
   тянет ядро по тегу. Соседний checkout остаётся нужен **только** для
   `tools/gen_hover_data.py` (читает `../pyregtab/docs/rtl-reference.md`).
   Описать процедуру обновления: поднять тег в `Cargo.toml` → `cargo build` →
   прогнать тесты → перегенерировать hover → обновить `grammar/UPSTREAM`,
   `CORPUS.md` и README, если корпус/грамматика сдвинулись.

6. `CLAUDE.md`, строка ~40 — снять устаревшее «Пререквизит в pyregtab ещё НЕ
   сделан», записать актуальное состояние (пин `v0.5.0`).

**Проверка:** `cd server && cargo build` в дереве, где рядом **нет**
`../../pyregtab`, — должно собраться (временно переименуйте каталог соседа,
либо соберите из отдельного клона).

## 3. Проблема 2 — пустые токены невидимы в preview (приоритет: средний)

Настоящий функциональный дефект. `client/src/preview.ts`, `renderCell`:

```ts
let [from, to] = it.span;
from = Math.max(from, pos);
to = Math.min(to, chars.length);
if (to <= from) {
  continue; // overlap or out of range — already covered
}
```

Пустой делимитированный токен даёт спан нулевой ширины, `from === to`, и ветка
его **проглатывает**. Для ячейки `"a,,b"` подсветка показывает `a`, две тусклые
запятые и `b` — без намёка на то, что между ними выведен пустой `VAL`. При этом
таблица recordset ниже пустую запись покажет: панели рассогласованы.

Ветка писалась под «overlap or out of range»; пустой токен попал под неё
случайно — до 0.5.0 такие токены отбрасывались ещё в ядре, и случай был
недостижим.

### Что делать

1. Разделить два случая. Настоящее перекрытие (`to < from`) по-прежнему
   пропускать; нулевую ширину (`to === from`) рендерить маркером:

   ```ts
   if (to < from) {
     continue; // overlap — already covered
   }
   if (from > pos) {
     html += `<span class="filler">${esc(chars.slice(pos, from).join(""))}</span>`;
   }
   const tags = it.tags.length ? ` #'${it.tags.join("' #'")}'` : "";
   const tip = `${it.role.toUpperCase()}[${it.index}]${tags} → "${it.s}"`;
   if (to === from) {
     // Пустой элемент (например, токен между соседними делимитерами):
     // нулевой ширины, но выведен — показываем маркером, не сдвигая текст.
     html += `<span class="${it.role} empty" title="${esc(tip)}"></span>`;
     continue; // pos не двигаем
   }
   html += `<span class="${it.role}" title="${esc(tip)}">${
     esc(chars.slice(from, to).join("")) || "&nbsp;"
   }</span>`;
   pos = to;
   ```

   Маркер **не должен** вставлять текст в ячейку: символ-заглушка исказил бы
   отображаемое содержимое. Пустой `<span>` плюс ширина из CSS.

   **Поправки, найденные при реализации** (фрагмент выше содержал два
   дефекта, оба закрыты тестами):

   - `continue; // pos не двигаем` — неверно. Filler до `from` уже выведен,
     и если не поднять `pos = to` (`to === from`, текста не съедает),
     следующий элемент выведет тот же filler повторно: `"a,,b"`
     отрисовывается как `a,,,b`. В коде `pos = to` перед `continue`.
   - `esc` не экранировал `"`, а tip пустого элемента — `VALUE[1] → ""`.
     Неэкранированная кавычка обрывала атрибут `title`, то есть у
     бестекстового маркера пропадала единственная подсказка, которая его
     идентифицирует. В `esc` добавлено `&quot;`.

2. CSS в том же файле (рядом с `.value`/`.attribute`/`.auxiliary`, ~строка 225):

   ```css
   .empty { display: inline-block; width: 3px; height: 1em; vertical-align: text-bottom; }
   ```

   Цвет фона наследуется от классов роли, поэтому маркер сохраняет цветовую
   легенду.

3. Легенду в шапке preview не трогать: маркер — не новая роль, а вырожденный
   случай существующих.

### Тестируемость

`renderCell` сейчас module-private в `preview.ts`, а `preview.ts` импортирует
`vscode`. Скрипт `test:unit` собирает тесты esbuild-ом **без**
`--external:vscode`, поэтому тест, транзитивно тянущий `vscode`, не соберётся.
В репозитории уже есть готовый образец решения — `client/src/fixturesCore.ts`
с явным комментарием «no `vscode` import — unit-testable».

Повторить этот приём: вынести чистые функции рендеринга (`renderCell`, `esc`,
и что ещё окажется нужно) в новый `client/src/previewRender.ts` без импорта
`vscode`, импортировать их из `preview.ts`. Затем добавить
`test/unit/previewRender.test.ts`:

- `"a,,b"` с тремя элементами (`"a"` `(0,1)`, `""` `(2,2)`, `"b"` `(3,4)`) —
  в выводе три span-а роли, средний пустой, с классом `empty`; текст ячейки
  восстанавливается из вывода без искажений;
- ведущий пробел токена (`" b"`, спан `(2,4)`) попадает **внутрь** подсветки,
  а не в `filler`;
- настоящее перекрытие (`to < from`) по-прежнему пропускается;
- элементов нет → ячейка целиком `unmatched` (регресс существующего поведения).

## 4. Проблема 3 — устаревшие пины и документация (приоритет: низкий)

Функционально безвредно, но пины врут.

1. `grammar/UPSTREAM` — сейчас `commit: 7a9b789… / tag: v0.4.1` (коммит
   **jRegTab**). Поднять до v0.5.0:

   ```
   commit: 035ff1a139e885e4cea85aa66a33e89a6b30f8c9
   tag: v0.5.0
   ```

   Строки `path:` и `sha256:` **не менять**: `RTL.g4` между v0.4.1 и v0.5.0
   байт-в-байт идентичен (проверено), хеш прежний. После правки прогнать
   `python tools/check_grammar_sync.py` — должен остаться зелёным (offline-часть
   сверяет sha256 вендоренной копии; upstream-кросс-чек включается только при
   наличии `JREGTAB_TOKEN`).

2. `README.md`, строка ~159 — «normative RTL grammar `RTL.g4` from **jRegTab
   0.4.1**» → «**jRegTab 0.5.0**».

3. `test/grammar/fixtures/CORPUS.md` — процитированная версия корпуса
   устарела:

   ```
   generated: 2026-07-07   →   generated: 2026-08-26
   ```

   Строку `sources:` не трогать, таблицу файлов не трогать — сами фикстуры
   не менялись.

4. **Hover для `TRIM`** сейчас — просто «Trim». Важная оговорка: файл
   `server/src/hover_data.rs` **генерируемый**
   (`tools/gen_hover_data.py` харвестит таблицы из
   `pyregtab/docs/rtl-reference.md`), править руками нельзя. Текст берётся из
   строки таблицы экстракторов `| \`TRIM\` | Trim |`.

   Поэтому улучшение hover — **кросс-репозиторная** правка:
   а) в pyregtab расширить эту строку таблицы, например на
      «Strip leading/trailing whitespace; the way to trim delimited tokens»;
   б) здесь перегенерировать: `python tools/gen_hover_data.py` и закоммитить
      результат.

   Пункт (а) сделан на стороне pyregtab отдельным коммитом (`af7020c`,
   после тега `v0.5.0`); генератор здесь прогнан, hover для `TRIM`
   («Strip leading/trailing whitespace only») и `NORM` («Trim + collapse
   internal whitespace») обновлён.

5. **Бэклог, не в этот PR:** hover-записи для самой делимитированной
   спецификации `(…){"δ"}` в словаре нет вообще, хотя именно её семантика
   теперь неочевидна. Генератор харвестит фиксированный набор секций
   (`tables_after(...)`), поэтому новая запись потребует его расширения и
   таблицы-источника в `rtl-reference.md`. Отдельная задача.

## 5. Версия и CHANGELOG

Правка меняет поведение preview (видимые пустые элементы) и фиксирует ядро —
patch-релиз **0.8.8** в `package.json` + запись в `CHANGELOG.md` в стиле
существующих:

```markdown
## 0.8.8

- Language server pinned to pyRegTab `v0.5.0` instead of tracking `main`, so
  RTL execution semantics can no longer change under the extension between
  builds.
- pyRegTab 0.5.0 changes the delimited content specification `(VAL){","}`:
  tokens are passed through verbatim — surrounding whitespace is kept and
  empty tokens derive items. Trimming is opt-in via `(VAL=TRIM){","}`. The
  match preview now shows empty items as a zero-width marker instead of
  silently omitting them.
- Grammar pin and corpus references updated to jRegTab 0.5.0 (`RTL.g4` itself
  is unchanged).
```

Публикацию (тег `v0.8.8` → Marketplace + Open VSX) **согласовать отдельно** —
это не часть данного плана.

## 6. Порядок работ

1. §2 (пин) — сначала, чтобы всё дальнейшее собиралось против фиксированного
   ядра.
2. §4 п. 1–3 (пины и доки) — механические, дешёвые.
3. §3 (рендер) — вынос `previewRender.ts`, правка, тесты.
4. §4 п. 4 — регенерация hover.
5. §5 — версия и CHANGELOG.

## 7. Критерий готовности

```
cd server && cargo clippy --all-targets -- -D warnings   # блокирующий в CI
cd server && cargo test                                   # 28+ тестов
npm test          # check:types + test:grammar + test:unit + check:sync
npm run test:e2e  # смоук в реальном VS Code
```

- `cargo build` в `server/` проходит **без** соседнего checkout pyregtab;
- `server/Cargo.lock` содержит git-source с тегом `v0.5.0`;
- ни один снапшот в `test/grammar/fixtures/*.snap` не изменился;
- новый `test/unit/previewRender.test.ts` падает, если вернуть
  `if (to <= from) continue;` — иначе тест бесполезен;
- в дифе нет правок `syntaxes/*.tmLanguage.json` и `grammar/RTL.g4`.

## 8. Риски

- **Регенерация `hover_data.rs`** может дать больший диф, чем ожидается, если
  `rtl-reference.md` в pyregtab разошёлся с последней генерацией сильнее, чем
  на секции про S_delim. Диф ревьюить целиком, а не по диагонали.
- **Сборка git-зависимости в CI** требует сети на шаге `cargo build`; раньше
  ядро приезжало через `actions/checkout`. Если у раннера ограничен доступ —
  вернуться к path-зависимости, но с `ref: v0.5.0` в обоих workflow вместо
  `main` (детерминизм достигается и так, ценой сохранения соседнего checkout).
- **Маркер нулевой ширины** в webview может оказаться незаметным в тёмной
  теме — проверить глазами на `"a,,b"` через `npm run test:e2e`/живой preview,
  при необходимости поднять ширину до 4px или добавить `outline`.
