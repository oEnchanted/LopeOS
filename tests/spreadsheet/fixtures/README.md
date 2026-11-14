# Independent spreadsheet fixtures

`generate.py` creates deterministic synthetic workbooks using openpyxl 3.1.5. No personal/financial source data is used.

- `independent-budget.xlsx`: budget formulas, numbers, custom format, styles, table, validations, note, hyperlink, names, merged title, frozen panes, conditional formatting, hidden sheet, and print settings.
- `independent-budget-chart.xlsx`: the same workbook with an externally generated bar chart to verify loss disclosure and source retention.
- `independent-1904.xlsx`: zero/60 numeric date serials using the 1904 epoch.
- `independent-boundaries.xlsx`: only A1 and XFD1048576 populated.
- `roundtrip-budget.xlsx`: written by the current LopeOS IO tests, then read independently by `verify.py`.

`verify.py` records exact discrete checks in `docs/spreadsheet/independent-xlsx-results.json`. It validates raw serial 60 separately because a Gregorian date object cannot express Excel's historical fictional leap day. Microsoft Excel is not installed in the validation environment, so desktop recalculation and rendering are unverified.
