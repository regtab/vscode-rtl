# Источник фикстур

Файлы `.rtl` скопированы из conformance-корпуса pyRegTab
(`pyregtab/conformance/`) без правок. Версия корпуса (его `VERSION`):

```
generated: 2026-08-26
sources: RtlTask001..150 + curated extras
```

| Файл | Источник | Что покрывает |
|---|---|---|
| `illustrative.rtl` | `positive/` | базовые AVP/REC, компаунд-контент |
| `task_001.rtl` | `positive/` | кванторы `{n}`/`+`, `ST*->REC` |
| `task_002.rtl` | `positive/` | условная ячейка, `NORM`, `REC(n)` |
| `task_009.rtl` | `positive/` | экстрактор `REPL`, subrow `{…}`, `BLANK` |
| `task_016.rtl` | `positive/` | `JOIN`, конъюнкция `&`, `STR` |
| `task_035.rtl` | `positive/` | contains `~`, отрицание `!~`, `REPL` |
| `task_068.rtl` | `positive/` | теги `#'…'`, кардинальность `*` |
| `task_107.rtl` | `positive/` | фрагменты `$V`, `FILL`, позиционные `LT` |
| `task_116.rtl` | `positive/` | фрагменты, `PREFIX`, диапазон `R1..3` |
| `ext_unbound_cell.rtl` | `negative/` | токенизация `EXT('…')` (семантически невалиден — для LSP-тестов фазы 2; здесь только подсветка) |
| `settings_unknown.rtl` | `negative/` | токенизация настроек `<…>` |
| `anch_named_attrs.rtl` | `semantic/` | настройка `<ANCH(n)>`, `COL->AVP`, именованная схема |
| `anch_named_inline_delim.rtl` | `semantic/` | инлайновый `REC(n)` внутри делимитированной спеки `{','}` |

Два кейса из `semantic/` приехали с корпусом, перепиненным на jRegTab 0.5.1
(pyRegTab 0.5.1): их `pattern.rtl` — единственные в наборе, где встречаются
настоящая настройка `<ANCH(n)>` и делимитированная спецификация `{','}`.
Сам `conformance/VERSION` при этом не менялся, поэтому блок выше актуален.

Снапшоты (`*.snap`) генерируются `npm run test:grammar:update`; при изменении
tmLanguage диф снапшотов ревьюится как часть PR.
