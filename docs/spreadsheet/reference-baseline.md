# Sheets reference baseline

## Pinned product

The structural reference is **Microsoft 365 Excel for Windows desktop, Current Channel, version 2508, build 19127.20222, released September 9, 2025**, English (United States), expanded desktop ribbon, White Office theme, Normal worksheet view, 100% worksheet zoom. Microsoft records this exact release in its [Microsoft 365 Apps update history](https://learn.microsoft.com/en-us/officeupdates/update-history-microsoft365-apps-by-date). This is a fixed historical reference, not a claim that the build is the newest supported release.

The surrounding window, application identity (`lope.sheets`, “Sheets”), menus, filesystem integration and materials belong to LopeOS. Outer chrome uses the shared glass material. Cell reading surfaces remain opaque. Writer files and ribbon primitives are not used or replaced.

## Evidence and uncertainty

No installed instance or full-window screenshot of **this exact build** was available during implementation. Exact dimensions, Windows DPI, ribbon breakpoint geometry, control spacing and icon silhouettes are therefore **UNVERIFIED**. The intended comparison capture is a 1440×900 window, 100% Windows scaling (96 DPI), English, White theme, expanded Home ribbon, blank Book1/Sheet1, A1 selected, 100% zoom. That describes a requested future capture, not an observed reference image. LopeOS screenshots record their own viewport and state separately; they do not establish pixel parity with Excel.

Microsoft's support pages contain cropped ribbon and dialog illustrations. Their build numbers and capture DPI are not stated. They establish feature locations and general interaction structure only; screenshots from Mac, Excel for the web and old perpetual editions are not used to invent a combined ribbon. The [Office theme guide](https://support.microsoft.com/en-us/office/foundations-experiences/change-the-look-and-feel-of-microsoft-365) documents White theme and cautions that older versions may look different.

## Structural inventory

This inventory records Windows desktop feature families. Exact presence of account-dependent controls and their placement in the pinned build remains unverified until a matching installation is captured. It is not a statement that every family is implemented.

| Area | Reference structure | LopeOS interpretation / evidence gap |
| --- | --- | --- |
| Document/title area | Quick access, workbook name, save state, search, account/sharing controls | Local Save/Undo/Redo, document name and command search. No decorative collaboration status. |
| File | New/Open/Save/Save As/Print/Export/Close/Info/Options/account workflows | Local file and recovery workflows; cloud account services are not Excel's services. |
| Home | Clipboard; Font; Alignment; Number; Styles; Cells; Editing | Dense commands and dialog launchers; exact control geometry unverified. |
| Insert | Tables; Illustrations; Add-ins; Charts; Sparklines; Filters; Links; Text; Symbols | Group membership evolves with tenant/build; missing commands are unresolved, not inferred from web screenshots. |
| Page Layout | Themes; Page Setup; Scale to Fit; Sheet Options; Arrange | Core page layout implemented; theme effects and object arrangement remain incomplete. |
| Formulas | Function Library; Defined Names; Formula Auditing; Calculation | Function registry must be consulted; visible categories do not imply every Excel function exists. |
| Data | Get & Transform Data; Queries & Connections; data types; Sort & Filter; Data Tools; Forecast; Outline | Local transforms are expressly not M, DAX or a Data Model. |
| Review | Proofing; Accessibility; Insights; Language; Comments; Notes; Protect | Workbook notes and editing constraints are separate from threaded collaboration and encryption. |
| View | Workbook Views; Show; Zoom; Window; Macros | Normal view and print preview are distinct from full Excel Page Layout/Page Break Preview. |
| Help | Help/training/feedback/support | Local compatibility information; no claim of Microsoft help service integration. |
| Draw / Automate / Developer / Power Pivot | Availability depends on touch/customization, license, account, add-ins and tenant policy | Not assumed universally present; no supported runtime claimed. |
| Table context | Table Design (properties, tools, external data, style options/styles) | Show only while selection intersects a table. |
| Pivot context | PivotTable Analyze and Design | Group/value settings and refresh belong to a real pivot; native cache/design parity incomplete. |
| Chart context | Chart Design and Format | Show only for a selected chart. |
| Picture context | Picture Format | Unresolved until a picture/drawing model and editor exist. |
| Formula editor | Name box, Cancel/Enter/Insert Function, multiline formula bar, autocomplete/signature/reference feedback | Fine geometry and reference-color correspondence need matched captures. |
| Worksheet | Headers, selection, fill handle, frozen/split panes, scrollbars, sheet navigation and status aggregates | Full logical coordinate space must remain virtualized. |
| Dialogs/panes | Format Cells; conditional formats; validation; Sort; Find/Replace; Go To/Special; Name Manager; Page Setup; pivot fields; chart formatting; queries | Feature-by-feature implementation status is in the feature inventory. |
| Ribbon states | Expanded, tabs-only, hidden; adaptive group collapse | Current LopeOS density/overflow is an implementation choice, not measured native breakpoint fidelity. |

Microsoft's [Windows keyboard documentation](https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel) establishes desktop navigation, range selection and formula editing behavior. Its platform sections are separate; Windows shortcuts must not be confused with web access keys. The [ribbon display guide](https://support.microsoft.com/en-us/office/foundations-experiences/show-or-hide-the-ribbon-in-office) describes expansion and collapse. Browser-reserved shortcuts remain host-dependent.

## Analysis behavior references

- [Create a PivotTable](https://support.microsoft.com/en-us/excel/get-started/create-a-pivottable-to-analyze-worksheet-data): Windows row/column/value/filter areas and refresh. Implemented grouping and drill-through are tested separately from native OOXML PivotTable compatibility.
- [Goal Seek](https://support.microsoft.com/en-us/excel/use-goal-seek-to-find-the-result-you-want-by-adjusting-an-input-value): one changing input and a target result. LopeOS uses a bounded safeguarded secant/bisection method and validates the residual.
- [Solver](https://support.microsoft.com/en-us/excel/define-and-solve-a-problem-by-using-solver): constraints, objectives and method choices. LopeOS's local pattern search is a different algorithm; it does not claim GRG, Simplex LP or Evolutionary Solver compatibility.
- [Power Query help](https://support.microsoft.com/en-us/excel/power-query-for-excel-help): staged data transformation and refresh. LopeOS's typed local pipeline does not parse Power Query M or offer paid/remote connectors.

## Visual release gate

Pixel fidelity remains open until captures from the exact pinned Windows build are available with viewport, DPI, zoom, language and workbook state recorded. Required comparisons: each standard ribbon; table/chart/pivot contexts; selection and formula editing; Format Cells and data dialogs; chart/pivot panes; print preview; narrow ribbon states. No screenshot from the current implementation should be described as a matched-reference audit until that comparison is performed.
