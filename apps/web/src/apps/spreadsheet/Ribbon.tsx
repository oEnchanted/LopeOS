import { useEffect, useState, type ReactNode } from "react";
import {
  Clipboard,
  Copy,
  Scissors,
  Paintbrush,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  WrapText,
  Merge,
  Table2,
  ChartColumn,
  ChartLine,
  ChartPie,
  Image,
  Link,
  Sigma,
  Search,
  SortAsc,
  Filter,
  FileInput,
  RefreshCw,
  ListFilter,
  Trash2,
  Columns3,
  Rows3,
  Plus,
  Minus,
  CheckCircle2,
  MessageSquare,
  LockKeyhole,
  Grid2X2,
  PanelTop,
  Printer,
  Settings2,
  Calculator,
  TextCursorInput,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  List,
  ArrowDownToLine,
  ArrowRightToLine,
  Percent,
  DollarSign,
  Square,
  BookOpen,
  WandSparkles,
  ListOrdered,
  Eye,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  FilePlus2,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import type {
  CellStyle,
  Workbook,
  Worksheet,
} from "../../../../../packages/spreadsheet-engine/src/model";
import type { SheetPreferences } from "./preferences";
export type RibbonAction = (id: string, value?: string) => void;
type Props = {
  tab: string;
  onTab(t: string): void;
  collapsed: boolean;
  onAction: RibbonAction;
  style: CellStyle;
  workbook: Workbook;
  sheet: Worksheet;
  tableContext: boolean;
  chartContext: boolean;
  pivotContext: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  saveState: string;
  preferences?: SheetPreferences;
};
const tabs = [
  "File",
  "Home",
  "Insert",
  "Page Layout",
  "Formulas",
  "Data",
  "Review",
  "View",
  "Help",
];
export function Ribbon(p: Props) {
  const [search, setSearch] = useState("");
  const action = p.onAction;
  const button = (
    id: string,
    label: string,
    Icon: LucideIcon,
    large = false,
    disabled?: string,
    checked?: boolean,
  ) => (
    <button
      key={id}
      className={`sheets-command ${large ? "large" : ""} ${checked ? "is-on" : ""}`}
      title={disabled ? `${label} — ${disabled}` : label}
      disabled={!!disabled || p.busy}
      aria-label={label}
      aria-pressed={checked === undefined ? undefined : checked}
      onClick={() => action(id)}
    >
      <Icon size={large ? 25 : 16} />
      <span>{label}</span>
      {large && <ChevronDown size={10} />}
    </button>
  );
  const group = (name: string, children: ReactNode, dialog?: string) => (
    <section className="sheets-ribbon-group" key={name} aria-label={name}>
      <div className="sheets-ribbon-tools">{children}</div>
      <div className="sheets-group-label">
        {p.preferences?.showGroupTitles !== false && name}
        {dialog && (
          <button
            aria-label={`${name} settings`}
            onClick={() => action(dialog)}
          >
            ↘
          </button>
        )}
      </div>
    </section>
  );
  const unsupported = "Not implemented; see File → Compatibility";
  const contextual = [
    ...(p.tableContext ? ["Table Design"] : []),
    ...(p.chartContext ? ["Chart Design", "Format"] : []),
    ...(p.pivotContext ? ["PivotTable Analyze"] : []),
  ];
  const quickCommands: Record<string, { id: string; label: string; icon: LucideIcon }> = {
    save: { id: "save", label: "Save", icon: Save },
    undo: { id: "undo", label: "Undo", icon: Undo2 },
    redo: { id: "redo", label: "Redo", icon: Redo2 },
    open: { id: "open", label: "Open", icon: FolderOpen },
    print: { id: "print", label: "Print Preview", icon: Printer },
    recalculate: { id: "recalculate", label: "Calculate Now", icon: Calculator },
  };
  const quick = (p.preferences?.quickAccess ?? ["save", "undo", "redo"]).flatMap(id => quickCommands[id] ? [quickCommands[id]] : []);
  const visibleTabs = [...tabs.filter(tab => tab === "File" || !p.preferences?.hiddenRibbonTabs.includes(tab)), ...contextual];
  const hiddenTabsKey = p.preferences?.hiddenRibbonTabs.join("|") ?? "";
  useEffect(() => {
    if (!visibleTabs.includes(p.tab)) p.onTab("Home");
  }, [p.tab, hiddenTabsKey, p.tableContext, p.chartContext, p.pivotContext]);
  return (
    <div className={`sheets-chrome glass-inset ${p.preferences?.showGroupTitles === false ? "sheets-hide-group-titles" : ""}`}>
      <div className="sheets-document-bar">
        <div className="sheets-quick-access">
          {quick.map((q) => (
            <button
              key={q.id}
              aria-label={q.label}
              title={q.label}
              disabled={
                p.busy ||
                (q.id === "undo" && !p.canUndo) ||
                (q.id === "redo" && !p.canRedo)
              }
              onClick={() => action(q.id)}
            >
              <q.icon size={15} />
            </button>
          ))}
        </div>
        <strong>
          {p.preferences?.showExtensions === false ? p.workbook.name.replace(/\.(?:lopebook|xlsx|xlsm|xlsb|xls|ods|csv|tsv)$/i, "") : p.workbook.name}
          <ChevronDown size={12} />
        </strong>
        <span className="sheets-save-state">{p.saveState}</span>
        <div className="sheets-command-search">
          <Search size={14} />
          <input
            aria-label="Search commands"
            placeholder="Search commands"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search) {
                action("command-search", search);
                setSearch("");
              }
            }}
          />
        </div>
      </div>
      <div
        className="sheets-ribbon-tabs"
        role="tablist"
        aria-label="Ribbon tabs"
      >
        {visibleTabs.map((t) => (
          <button
            key={t}
            role="tab"
            className={contextual.includes(t) ? "contextual" : ""}
            aria-selected={p.tab === t}
            onClick={() => p.onTab(t)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const all = visibleTabs;
                p.onTab(
                  all[
                    (all.indexOf(t) +
                      (e.key === "ArrowRight" ? 1 : all.length - 1)) %
                      all.length
                  ],
                );
              }
            }}
          >
            {t}
          </button>
        ))}
        <button
          className="sheets-ribbon-toggle"
          title={p.collapsed ? "Expand ribbon" : "Collapse ribbon"}
          aria-label={p.collapsed ? "Expand ribbon" : "Collapse ribbon"}
          onClick={() => action("collapse")}
        >
          {p.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {!p.collapsed && p.tab !== "File" && (
        <div
          className="sheets-ribbon"
          role="toolbar"
          aria-label={`${p.tab} commands`}
        >
          {p.tab === "Home" && (
            <>
              {group(
                "Clipboard",
                <>
                  {button("paste", "Paste", Clipboard, true)}
                  <div className="sheets-command-stack">
                    {button("cut", "Cut", Scissors)}
                    {button("copy", "Copy", Copy)}
                    {button("paint", "Format Painter", Paintbrush)}
                  </div>
                </>,
              )}
              {group(
                "Font",
                <div className="sheets-font-tools">
                  <div>
                    <select
                      aria-label="Font family"
                      value={p.style.fontFamily ?? "Aptos"}
                      onChange={(e) => action("fontFamily", e.target.value)}
                    >
                      {[
                        "Aptos",
                        "Arial",
                        "Calibri",
                        "Cambria",
                        "Georgia",
                        "Times New Roman",
                        "Verdana",
                        "monospace",
                      ].map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                    <input
                      aria-label="Font size"
                      type="number"
                      min="6"
                      max="96"
                      value={p.style.fontSize ?? 11}
                      onChange={(e) => action("fontSize", e.target.value)}
                    />
                  </div>
                  <div className="sheets-icon-row">
                    {button(
                      "bold",
                      "Bold",
                      Bold,
                      false,
                      undefined,
                      p.style.bold ?? false,
                    )}
                    {button(
                      "italic",
                      "Italic",
                      Italic,
                      false,
                      undefined,
                      p.style.italic ?? false,
                    )}
                    {button(
                      "underline",
                      "Underline",
                      Underline,
                      false,
                      undefined,
                      p.style.underline ?? false,
                    )}
                    {button("borders", "All borders", Grid2X2)}
                    <label title="Fill Color" className="sheets-color">
                      <Paintbrush size={16} />
                      <input
                        aria-label="Fill color"
                        type="color"
                        value={p.style.fill ?? "#ffffff"}
                        onChange={(e) => action("fill", e.target.value)}
                      />
                    </label>
                    <label title="Font Color" className="sheets-color">
                      <span>A</span>
                      <input
                        aria-label="Font color"
                        type="color"
                        value={p.style.color ?? "#202124"}
                        onChange={(e) => action("color", e.target.value)}
                      />
                    </label>
                  </div>
                </div>,
                "format",
              )}
              {group(
                "Alignment",
                <>
                  <div className="sheets-font-tools">
                    <div className="sheets-icon-row">
                      {button(
                        "align-left",
                        "Align Left",
                        AlignLeft,
                        false,
                        undefined,
                        p.style.horizontal === "left",
                      )}
                      {button(
                        "align-center",
                        "Center",
                        AlignCenter,
                        false,
                        undefined,
                        p.style.horizontal === "center",
                      )}
                      {button(
                        "align-right",
                        "Align Right",
                        AlignRight,
                        false,
                        undefined,
                        p.style.horizontal === "right",
                      )}
                    </div>
                    <div className="sheets-icon-row">
                      {button(
                        "indent-less",
                        "Decrease Indent",
                        ArrowDownToLine,
                      )}
                      {button(
                        "indent-more",
                        "Increase Indent",
                        ArrowRightToLine,
                      )}
                    </div>
                  </div>
                  <div className="sheets-command-stack">
                    {button(
                      "wrap",
                      "Wrap Text",
                      WrapText,
                      false,
                      undefined,
                      !!p.style.wrap,
                    )}
                    {button("merge", "Merge & Center", Merge)}
                  </div>
                </>,
                "format",
              )}
              {group(
                "Number",
                <div className="sheets-font-tools">
                  <select
                    aria-label="Number format"
                    value={p.style.numberFormat ?? "General"}
                    onChange={(e) => action("numberFormat", e.target.value)}
                  >
                    {[
                      ["General", "General"],
                      ["0", "Number"],
                      ["0.00", "Decimal"],
                      ["$#,##0.00", "Currency"],
                      ["0.00%", "Percentage"],
                      ["m/d/yyyy", "Short Date"],
                      ["yyyy-mm-dd", "ISO Date"],
                      ["@", "Text"],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <div className="sheets-icon-row">
                    {button("currency", "Accounting Number Format", DollarSign)}
                    {button("percent", "Percent Style", Percent)}
                    {button("decimals-more", "Increase Decimal", Plus)}
                    {button("decimals-less", "Decrease Decimal", Minus)}
                  </div>
                </div>,
                "format",
              )}
              {group(
                "Styles",
                <>
                  {button(
                    "conditional",
                    "Conditional Formatting",
                    ListFilter,
                    true,
                  )}
                  {button("table", "Format as Table", Table2, true)}
                  {button("cell-style", "Cell Styles", Square, true)}
                </>,
              )}
              {group(
                "Cells",
                <>
                  {button("insert-cells", "Insert", Plus, true)}
                  {button("delete-cells", "Delete", Trash2, true)}
                  {button("cell-size", "Format", Rows3, true)}
                </>,
              )}
              {group(
                "Editing",
                <>
                  <div className="sheets-command-stack">
                    {button("autosum", "AutoSum", Sigma)}
                    {button("fill-down", "Fill Down", ArrowDownToLine)}
                    {button("clear", "Clear Contents", Trash2)}
                  </div>
                  {button("sort", "Sort & Filter", SortAsc, true)}
                  {button("find", "Find & Select", Search, true)}
                </>,
              )}
            </>
          )}
          {p.tab === "Insert" && (
            <>
              {group(
                "Tables",
                <>
                  {button("pivot", "PivotTable", Table2, true)}
                  {button("table", "Table", Grid2X2, true)}
                </>,
              )}
              {group(
                "Illustrations",
                button("picture", "Pictures", Image, true, unsupported),
              )}
              {group(
                "Charts",
                <>
                  {button("chart-column", "Column or Bar", ChartColumn, true)}
                  {button("chart-line", "Line or Area", ChartLine, true)}
                  {button("chart-pie", "Pie or Doughnut", ChartPie, true)}
                  {button("chart", "All Charts", ChartColumn, true)}
                </>,
              )}
              {group(
                "Filters",
                <>
                  {button("slicer", "Slicer", ListFilter, true, unsupported)}
                  {button(
                    "timeline",
                    "Timeline",
                    ListOrdered,
                    true,
                    unsupported,
                  )}
                </>,
              )}
              {group("Links", button("hyperlink", "Link", Link, true))}
              {group(
                "Comments",
                button("note", "New Note", MessageSquare, true),
              )}
              {group(
                "Text",
                button(
                  "header-footer",
                  "Header & Footer",
                  TextCursorInput,
                  true,
                ),
              )}
            </>
          )}
          {p.tab === "Page Layout" && (
            <>
              {group(
                "Themes",
                button("cell-style", "Cell Styles", Paintbrush, true),
              )}
              {group(
                "Page Setup",
                <>
                  {button("margins", "Margins", Square, true)}
                  {button("orientation", "Orientation", FileSpreadsheet, true)}
                  {button("paper", "Size", FileSpreadsheet, true)}
                  {button("print-area", "Print Area", Grid2X2, true)}
                  {button("page-break", "Breaks", Rows3, true)}
                  {button("print-titles", "Print Titles", Rows3, true)}
                </>,
                "page-setup",
              )}
              {group(
                "Scale to Fit",
                button("page-setup", "Scale to Fit", Settings2, true),
              )}
              {group(
                "Sheet Options",
                <div className="sheets-command-stack">
                  {button(
                    "gridlines",
                    "Gridlines",
                    Grid2X2,
                    false,
                    undefined,
                    p.sheet.showGridlines,
                  )}
                  {button(
                    "print-gridlines",
                    "Print Gridlines",
                    Printer,
                    false,
                    undefined,
                    !!p.sheet.print.gridlines,
                  )}
                </div>,
              )}
              {group("Print", button("print", "Print Preview", Printer, true))}
            </>
          )}
          {p.tab === "Formulas" && (
            <>
              {group(
                "Function Library",
                <>
                  {button("function", "Insert Function", Sigma, true)}
                  {button("autosum", "AutoSum", Sigma, true)}
                  {button("functions-financial", "Financial", DollarSign, true)}
                  {button("functions-logical", "Logical", CheckCircle2, true)}
                  {button("functions-text", "Text", TextCursorInput, true)}
                  {button("functions-date", "Date & Time", BookOpen, true)}
                  {button(
                    "functions-lookup",
                    "Lookup & Reference",
                    Search,
                    true,
                  )}
                  {button("functions-math", "Math & Trig", Calculator, true)}
                </>,
              )}
              {group(
                "Defined Names",
                button("names", "Name Manager", List, true),
              )}
              {group(
                "Formula Auditing",
                <div className="sheets-command-stack">
                  {button("show-formulas", "Show Formulas", Eye)}
                  {button("errors", "Error Checking", CheckCircle2)}
                </div>,
              )}
              {group(
                "Calculation",
                <>
                  {button(
                    "calculation",
                    "Calculation Options",
                    Settings2,
                    true,
                  )}
                  {button("recalculate", "Calculate Now", Calculator, true)}
                </>,
              )}
            </>
          )}
          {p.tab === "Data" && (
            <>
              {group(
                "Get & Transform Data",
                <>
                  {button("import", "From Text/CSV", FileInput, true)}
                  {button("query", "Queries & Connections", List, true)}
                </>,
              )}
              {group(
                "Queries & Connections",
                button("refresh", "Refresh All", RefreshCw, true),
              )}
              {group(
                "Sort & Filter",
                <>
                  {button("sort", "Sort", SortAsc, true)}
                  {button("filter", "Filter", Filter, true)}
                  {button("clear-filter", "Clear Filter", ListFilter, true)}
                </>,
              )}
              {group(
                "Data Tools",
                <>
                  {button("text-columns", "Text to Columns", Columns3, true)}
                  {button("duplicates", "Remove Duplicates", Table2, true)}
                  {button("validation", "Data Validation", CheckCircle2, true)}
                </>,
              )}
              {group(
                "Forecast",
                button("goal-seek", "What-If Analysis", Calculator, true),
              )}
              {group(
                "Outline",
                <div className="sheets-command-stack">
                  {button("group", "Group", Plus)}
                  {button("ungroup", "Ungroup", Minus)}
                  {button("subtotal", "Subtotal", Sigma)}
                </div>,
              )}
              {group(
                "Analysis",
                button("solver", "Solver", WandSparkles, true),
              )}
            </>
          )}
          {p.tab === "Review" && (
            <>
              {group(
                "Proofing",
                button("spelling", "Spelling", CheckCircle2, true, unsupported),
              )}
              {group("Comments", button("note", "Notes", MessageSquare, true))}
              {group(
                "Protect",
                <>
                  {button(
                    "protect",
                    "Protect Sheet",
                    LockKeyhole,
                    true,
                    undefined,
                    p.sheet.protected,
                  )}
                  {button(
                    "protect-workbook",
                    "Protect Workbook",
                    LockKeyhole,
                    true,
                    unsupported,
                  )}
                </>,
              )}
              {group(
                "Changes",
                button("history", "Change History", List, true),
              )}
            </>
          )}
          {p.tab === "View" && (
            <>
              {group(
                "Workbook Views",
                <>
                  {button("normal", "Normal", Grid2X2, true)}
                  {button("print", "Page Layout", BookOpen, true)}
                  {button("print", "Page Break Preview", FileSpreadsheet, true)}
                </>,
              )}
              {group(
                "Show",
                <div className="sheets-command-stack">
                  {button(
                    "gridlines",
                    "Gridlines",
                    Grid2X2,
                    false,
                    undefined,
                    p.sheet.showGridlines,
                  )}
                  {button("formula-bar", "Formula Bar", Sigma)}
                  {button("show-formulas", "Show Formulas", Eye)}
                </div>,
              )}
              {group(
                "Zoom",
                <>
                  {button("zoom", "Zoom", Search, true)}
                  {button("zoom-100", "100%", Search, true)}
                  {button("zoom-selection", "Zoom to Selection", Square, true)}
                </>,
              )}
              {group(
                "Window",
                <>
                  {button("new-window", "New Workbook", FilePlus2, true)}
                  {button("freeze", "Freeze Panes", PanelTop, true)}
                  {button("split", "Split", Rows3, true, unsupported)}
                  {button("hide-sheet", "Hide", Eye, true)}
                  {button("unhide-sheet", "Unhide", Eye, true)}
                </>,
              )}
              {group(
                "Macros",
                button(
                  "macros",
                  "Macros",
                  Calculator,
                  true,
                  "VBA and XLM execution are not supported",
                ),
              )}
            </>
          )}
          {p.tab === "Table Design" && (
            <>
              {group(
                "Properties",
                button("table", "Table Name & Style", Table2, true),
              )}
              {group(
                "Tools",
                <>
                  {button("pivot", "Summarize with PivotTable", Table2, true)}
                  {button("duplicates", "Remove Duplicates", Table2, true)}
                  {button("convert-table", "Convert to Range", Grid2X2, true)}
                </>,
              )}
              {group(
                "Table Style Options",
                <>
                  {button("table-totals", "Total Row", Sigma, true)}
                  {button("table-bands", "Banded Rows", Rows3, true)}
                </>,
              )}
            </>
          )}
          {(p.tab === "Chart Design" || p.tab === "Format") && (
            <>
              {group(
                "Chart Layouts",
                button("chart-edit", "Chart Elements", ChartColumn, true),
              )}
              {group("Data", button("chart-edit", "Select Data", Table2, true))}
              {group(
                "Type",
                button("chart-edit", "Change Chart Type", ChartLine, true),
              )}
              {group(
                "Arrange",
                <>
                  {button("chart-edit", "Size & Position", Settings2, true)}
                  {button("chart-delete", "Delete Chart", Trash2, true)}
                </>,
              )}
            </>
          )}
          {p.tab === "PivotTable Analyze" && (
            <>
              {group("PivotTable", button("pivot", "Field List", Table2, true))}
              {group("Data", button("refresh", "Refresh", RefreshCw, true))}
              {group(
                "Actions",
                button("pivot-detail", "Show Details", List, true),
              )}
            </>
          )}
          {p.tab === "Help" && (
            <>
              {group(
                "Help",
                button("help", "Keyboard & Getting Started", CircleHelp, true),
              )}
              {group(
                "Compatibility",
                <>
                  {button("compatibility", "Feature Support", List, true)}
                  {button("functions", "Function Registry", Sigma, true)}
                </>,
              )}
            </>
          )}
        </div>
      )}
      {p.tab === "File" && (
        <div className="sheets-backstage">
          {button("new", "Blank Workbook", FilePlus2, true)}
          {button("open", "Open Workspace", FolderOpen, true)}
          {button("import", "Import Local File", FileInput, true)}
          {button("save", "Save", Save, true)}
          {button("save-as", "Save As", Save, true)}
          {button("export", "Export", FileSpreadsheet, true)}
          {button("print", "Print", Printer, true)}
          {button("budget", "Budget Example", Table2, true)}
          {button("preferences", "Preferences", Settings2, true)}
          {button("compatibility", "Compatibility", CircleHelp, true)}
        </div>
      )}
    </div>
  );
}
