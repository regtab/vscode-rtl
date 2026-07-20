# Скриншоты и GIF для README

Кадры в `images/` сняты автоматически (2026-07-20, VS Code 1.100.0 из
`.vscode-test`, дисплей 200% → всё в чётком 2x). Скрипты — в
`tools/screenshots/`; в `.vsix` каталог `images/` не попадает
(`.vscodeignore`), Marketplace подтягивает их из GitHub по перезаписанным
`vsce` ссылкам — поэтому перед публикацией снимки должны быть запушены.

## Как это устроено

1. **Демо-workspace** (см. «Материал» ниже) с настроенными
   `rtl.fixtures.input/expected` и пятью паттернами из data-wrangling-eval.
2. **Запуск**: `Code.exe --extensionDevelopmentPath=<репо>
   --user-data-dir=<чистый> --disable-extensions --remote-debugging-port=9333
   <workspace>` (свежий user-data-dir с `workbench.colorTheme: "Default Dark
   Modern"`, `window.zoomLevel: 0`, минимум хрома — см. историю).
3. **Управление** — `tools/screenshots/driver.mjs` (CDP по порту 9333, без
   зависимостей): команды `palette`, `quickopen`, `keys`, `click`, `dblclick`,
   `wheel`, `type`, `shot`. Размер окна — `tools/screenshots/win.ps1`
   (SetWindowPos, физические пиксели).
4. **GIF** — `gifrec.mjs` пишет кадры (screenshot-луп ~350 мс) во время
   сценария «{2} → дабл-клик → 3 → превью перерисовалось», `assemble.mjs`
   (нужны `npm i gifenc pngjs`) собирает `preview.gif` с 2x-даунскейлом.
   Известная грабля: `rawKeyDown` в CDP не выполняет Backspace/выделение —
   заменять текст только через `dblclick` + `Input.insertText`.

## Кадры

| Файл | Что в кадре | Материал |
|---|---|---|
| `preview.gif` | Hero: правка квантификатора `{2}`→`{3}`, превью перерисовывается — рваные записи с ∅ становятся чистым recordset | синтетический `quarterly.rtl` + `quarterly.csv` (город × квартал, структура task_026) с `// fixture:` директивой |
| `diagnostics.png` | Squiggle на ошибке + Problems «expected cell match constraint…» | вариант task_018 с опечаткой (`->AVP` без провайдера) |
| `expected-diff.png` | «✗ Recordset differs… — 1 missing, 1 extra», секции Missing/Extra | task_026, в expected_1.csv одно значение заменено |
| `test-explorer.png` | Testing view: 24/25, раскрытый красный узел, паттерн справа | 5 задач × 5 фикстур из data-wrangling-eval |
| `embedded-python.png` | RTL-подсветка в `RtlCompiler.compile("""…""")` + CodeLens | синтетический `extract.py` с паттерном task_036 |

## Материал

Демо-workspace собирается из `d:\YandexDisk\code2\data-wrangling-eval`:
`solutions/regtab/task_{013,018,023,026,036}.rtl` + их `fixtures/`, настройки:

```json
{
  "rtl.fixtures.input": [{ "pattern": "**/solutions/regtab/*.rtl",
    "input": "${workspaceFolder}/fixtures/${basename}/input_*.csv" }],
  "rtl.fixtures.expected": [{ "pattern": "**/solutions/regtab/*.rtl",
    "expected": "${workspaceFolder}/fixtures/${basename}/expected_*.csv" }],
  "rtl.fixtures.expectedHasHeader": true
}
```

Для красного теста — испортить одно значение в копии `expected_1.csv`
task_026. Оригиналы фикстур не трогать.
