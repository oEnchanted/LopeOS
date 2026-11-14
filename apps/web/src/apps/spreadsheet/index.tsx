import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  X,
  Sigma,
  Grid2X2,
  BookOpen,
} from "lucide-react";
import type { AppContext } from "../../../../../packages/contracts/src";
import { WorkbookEngine } from "../../../../../packages/spreadsheet-engine/src/calculation";
import {
  createWorkbook,
  createSheet,
  cellAddress,
  parseAddress,
  parseRange,
  cellValue,
  inputCell,
  setCell,
  usedRange,
  formatValue,
  newId,
  isError,
  type Workbook,
  type Worksheet,
  type Cell,
  type CellStyle,
  type Range,
  type Scalar,
  type Chart,
} from "../../../../../packages/spreadsheet-engine/src/model";
import { adjustFormula } from "../../../../../packages/spreadsheet-engine/src/references";
import {
  importXlsx,
  exportXlsx,
  xlsxExportWarnings,
  serializeWorkbook,
  deserializeWorkbook,
  importDelimited,
  exportDelimited,
  parseDelimited,
  type DelimitedOptions,
} from "../../../../../packages/spreadsheet-engine/src/io";
import {
  importXlsxOffthread as importXlsxAsync,
  exportXlsxOffthread as exportXlsxAsync,
  importDelimitedOffthread,
  exportDelimitedOffthread,
  serializeWorkbookOffthread,
  deserializeWorkbookOffthread,
} from "../../../../../packages/spreadsheet-engine/src/io-worker-client";
import {
  saveRecovery,
  loadRecovery,
  removeRecovery,
  listRecoveries,
} from "../../../../../packages/spreadsheet-engine/src/persistence";
import {
  sortData,
  filterData,
  removeDuplicates,
  textToColumns,
  pivotData,
  runQuery,
  goalSeek,
  solve,
  sheetData,
  applyDataToSheet,
  type FilterClause,
  type QueryStep,
  type DataSet,
} from "../../../../../packages/spreadsheet-engine/src/analysis";
import { createBudgetWorkbook } from "../../../../../packages/spreadsheet-engine/src/fixtures";
import { functionRegistry } from "../../../../../packages/spreadsheet-engine/src/registry";
import {
  Grid,
  normalized,
  includes,
  rangeLabel,
  type GridHandle,
} from "./Grid";
import { Ribbon } from "./Ribbon";
import { SheetDialog, type DialogSpec, type FormField } from "./Dialogs";
import { ChartView } from "./ChartView";
import { FormulaAssist, referenceRanges } from "./FormulaAssist";
import { generatePrintHTML } from "./print";
import { useAppCommands } from "../hooks";
import { PreferencesWindow } from "./PreferencesWindow";
import { SheetGallery } from "./SheetGallery";
import { useSystemAppearance } from "./systemAppearance";
import { useSheetPreferences, workbookWithPreferences, workbookCellStyle, correctTypedText, typedHyperlink, listFillValue, playSheetSound, type SheetPreferences } from "./preferences";
import "./spreadsheet.css";
const options = (items: string[]) =>
  items.map((value) => ({ value, label: value }));
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
const textField = (name: string, label: string, value = ""): FormField => ({
  name,
  label,
  value,
});
const numberField = (
  name: string,
  label: string,
  value: number,
): FormField => ({ name, label, value: String(value), type: "number" });
const selectField = (
  name: string,
  label: string,
  items: string[],
  value = items[0],
): FormField => ({
  name,
  label,
  value,
  type: "select",
  options: options(items),
});
const initialSelection: Range = {
  start: { row: 0, col: 0 },
  end: { row: 0, col: 0 },
};
const MAX_EDIT_CELLS = 100000;
const isCellReference = (name: string) => {
  try {
    parseAddress(name);
    return true;
  } catch {
    return /^R[0-9]+C[0-9]+$/i.test(name);
  }
};

export default function Spreadsheet({ context }: { context: AppContext }) {
  const [preferences, updatePreference] = useSheetPreferences(context.services.settings);
  const systemAppearance = useSystemAppearance();
  const theme = preferences.appearance === "system" ? systemAppearance.theme : preferences.appearance === "dark" ? "dark" : "light";
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [initialEngine] = useState(() => new WorkbookEngine(workbookWithPreferences(preferences)));
  const engine = useRef<WorkbookEngine>(initialEngine);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [workbook, setWorkbook] = useState(engine.current.workbook),
    [selection, setSelection] = useState<Range>(initialSelection),
    [extraSelections, setExtraSelections] = useState<Range[]>([]),
    [tab, setTab] = useState("Home"),
    [collapsed, setCollapsed] = useState(preferences.collapsed),
    [zoom, setZoom] = useState(preferences.defaultZoom),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [formulaExpanded, setFormulaExpanded] = useState(false),
    [formulaBar, setFormulaBar] = useState(preferences.formulaBar),
    [formulaView, setFormulaView] = useState(preferences.showFormulas),
    [dialog, setDialog] = useState<DialogSpec | null>(null),
    [status, setStatus] = useState("Ready"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [calcBusy, setCalcBusy] = useState(false),
    [recovered, setRecovered] = useState(false),
    [path, setPath] = useState(""),
    [version, setVersion] = useState<string | undefined>(),
    [savedRevision, setSavedRevision] = useState(0),
    [recoveryRevision, setRecoveryRevision] = useState(-1),
    [filter, setFilter] = useState<{
      sheetId: string;
      range: Range;
      clauses: FilterClause[];
    } | null>(null),
    [selectedChart, setSelectedChart] = useState<string | null>(null),
    [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
      null,
    ),
    [printHTML, setPrintHTML] = useState("");
  const menuRef = useRef<HTMLDivElement>(null),
    grid = useRef<GridHandle>(null),
    formulaInput = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    frame = useRef<HTMLIFrameElement>(null),
    worker = useRef<Worker | null>(null),
    calcId = useRef(0),
    ready = useRef(false),
    alive = useRef(true),
    clipboard = useRef<{
      sheetId: string;
      range: Range;
      cells: Record<string, Cell>;
      cut: boolean;
      text: string;
    } | null>(null),
    paint = useRef<CellStyle | null>(null),
    history = useRef<string[]>([]),
    activeAbort = useRef<AbortController | null>(null),
    saved = useRef({ path, version, savedRevision });
  saved.current = { path, version, savedRevision };
  const sheet =
      workbook.sheets.find((s) => s.id === workbook.activeSheetId) ??
      workbook.sheets[0],
    activeAddress = cellAddress(selection.start.row, selection.start.col),
    activeCell = sheet.cells[activeAddress],
    activeStyle = { ...workbookCellStyle(workbook), ...activeCell?.style },
    dirty = workbook.revision !== savedRevision,
    bookRef = useRef(workbook);
  bookRef.current = workbook;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const commitRef = useRef<() => boolean>(() => true);
  commitRef.current = () => !editing || commit(0, 0);
  const recoveryGeneration = useRef(0);
  const recoveryKey = `window:${context.windowId}`,
    tableContext = sheet.tables.find((t) =>
      includes(t.range, selection.start.row, selection.start.col),
    ),
    chart = sheet.charts.find((c) => c.id === selectedChart),
    pivotContext = sheet.pivots.length > 0;
  useEffect(() => setFormulaBar(preferences.formulaBar), [preferences.formulaBar]);
  useEffect(() => setFormulaView(preferences.showFormulas), [preferences.showFormulas]);
  useEffect(() => setCollapsed(preferences.collapsed), [preferences.collapsed]);
  useEffect(() => setZoom(preferences.defaultZoom), [preferences.defaultZoom]);
  useEffect(() => { if (preferences.hiddenRibbonTabs.includes(tab)) setTab("Home"); }, [preferences.hiddenRibbonTabs, tab]);
  function updateSettings<K extends keyof SheetPreferences>(key: K, value: SheetPreferences[K]) {
    updatePreference(key, value);
    if (key === "gridlines") transaction("Sheet view", (_, s) => { s.showGridlines = value as boolean; });
  }
  function show(spec: Omit<DialogSpec, "id">) {
    setDialog({ ...spec, id: Date.now() + Math.random() });
    setContextMenu(null);
  }
  const inform = (title: string, description: string) =>
    show({ title, description });
  function sync(label?: string) {
    const next = engine.current.workbook;
    setWorkbook({ ...next });
    setError("");
    if (label) {
      history.current.unshift(`${new Date().toLocaleTimeString()} · ${label}`);
      history.current = history.current.slice(0, 100);
      setStatus(label);
    }
    if (next.calculationMode === "automatic") recalculate();
  }
  function transaction(
    label: string,
    mutate: (wb: Workbook, s: Worksheet) => void,
  ) {
    if (
      sheet.protected &&
      !["Unprotect sheet", "Sheet view", "Print settings"].includes(label)
    )
      throw new Error(
        "This worksheet is protected. Use Review → Protect Sheet to unprotect it.",
      );
    engine.current.transact(label, (wb) =>
      mutate(wb, wb.sheets.find((s) => s.id === sheet.id)!),
    );
    sync(label);
  }
  function safely(fn: () => void | Promise<void>) {
    try {
      Promise.resolve(fn()).catch((e) => setError(message(e)));
    } catch (e) {
      setError(message(e));
    }
  }
  function createCalcWorker() {
    worker.current?.terminate();
    const w = new Worker(new URL("./calculation.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (!alive.current || e.data.id !== calcId.current) return;
      setCalcBusy(false);
      if (e.data.error) {
        setError(e.data.error);
        return;
      }
      const current = engine.current.workbook;
      if (!engine.current.applyCalculation(e.data.result)) return;
      setWorkbook({ ...engine.current.workbook });
    };
    w.onerror = (e) => {
      setCalcBusy(false);
      setError(`Calculation stopped: ${e.message}`);
    };
    return w;
  }
  function recalculate(force = false) {
    if (!ready.current) return;
    setCalcBusy(true);
    const id = ++calcId.current;
    (worker.current ?? createCalcWorker()).postMessage({
      id,
      workbook: engine.current.workbook,
      force,
    });
  }
  async function waitForCalculation(force = false) {
    if (engine.current.workbook.calculationMode === "manual" && !force) return;
    const snapshot = engine.current.workbook,
      controller = new AbortController();
    activeAbort.current = controller;
    setBusy(true);
    const calc = new Worker(
      new URL("./calculation.worker.ts", import.meta.url),
      { type: "module" },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          calc.terminate();
          reject(
            new Error(
              "Calculation exceeded 30 seconds. Cancel or simplify the workbook before saving calculated values.",
            ),
          );
        }, 30000);
        const finish = () => clearTimeout(timer);
        controller.signal.addEventListener(
          "abort",
          () => {
            finish();
            calc.terminate();
            reject(new Error("Calculation cancelled."));
          },
          { once: true },
        );
        calc.onmessage = (event) => {
          finish();
          if (event.data.error) {
            reject(new Error(event.data.error));
            return;
          }
          if (!engine.current.applyCalculation(event.data.result)) {
            reject(
              new Error(
                "Workbook changed while preparing the file. Try saving again.",
              ),
            );
            return;
          }
          setWorkbook({ ...engine.current.workbook });
          resolve();
        };
        calc.onerror = (e) => {
          finish();
          reject(new Error(e.message));
        };
        calc.postMessage({ id: 0, workbook: snapshot, force: true });
      });
    } finally {
      calc.terminate();
      activeAbort.current = null;
      setBusy(false);
    }
  }
  function install(
    wb: Workbook,
    newPath = "",
    fileVersion?: string,
    isRecovery = false,
  ) {
    calcId.current++;
    engine.current = new WorkbookEngine(wb);
    setWorkbook({ ...wb });
    setPath(newPath);
    setVersion(fileVersion);
    setSavedRevision(isRecovery ? -1 : wb.revision);
    setSelection(initialSelection);
    setExtraSelections([]);
    setEditing(false);
    setTab("Home");
    setFilter(null);
    setSelectedChart(null);
    setError("");
    setPrintHTML("");
    setGalleryOpen(false);
    setZoom(preferences.defaultZoom);
    setRecoveryRevision(-1);
    setRecovered(isRecovery);
    history.current = [];
    setStatus(
      isRecovery ? "Recovered your unsaved workbook" : "Workbook opened",
    );
    context.services.settings.set(`sheets.document.${context.windowId}`, {
      path: newPath,
    });
    recalculate();
    playSheetSound(preferences.eventSounds);
    requestAnimationFrame(() => {
      grid.current?.reveal(0, 0);
      grid.current?.focus();
    });
  }
  function ask(
    title: string,
    description: string,
    submit = "Continue",
  ): Promise<boolean> {
    return new Promise((resolve) => {
      show({ title, description, submit, onSubmit: () => resolve(true) });
      pendingAsk.current = resolve;
    });
  }
  const pendingAsk = useRef<((answer: boolean) => void) | null>(null);
  function closeDialog() {
    setDialog(null);
    pendingAsk.current?.(false);
    pendingAsk.current = null;
  }
  async function guard() {
    if (!commitRef.current()) return false;
    if (engine.current.workbook.revision === saved.current.savedRevision)
      return true;
    return ask(
      "Keep your changes?",
      "This workbook has changes that have not been saved to a file. A recovery copy is kept locally when storage is available. Continue to leave this workbook without saving?",
      "Continue without saving",
    );
  }
  useEffect(() => {
    alive.current = true;
    const unguard = context.lifecycle.onBeforeClose(
      async () => !busyRef.current && (await guard()),
    );
    ready.current = false;
    (async () => {
      try {
        const launch =
          typeof context.launchArgs.path === "string"
            ? context.launchArgs.path
            : context.services.settings.get<{ path?: string }>(
                `sheets.document.${context.windowId}`,
                {},
              ).path;
        let recovery: Workbook | undefined;
        try {
          if (preferences.recoveryEnabled) recovery = await loadRecovery(recoveryKey);
        } catch (cause) {
          setError(message(cause));
        }
        ready.current = true;
        if (recovery) {
          install(recovery, launch ?? "", undefined, true);
          setRecovered(true);
        } else if (launch) {
          await openPath(launch);
        } else { recalculate(); setGalleryOpen(preferences.showStartScreen); }
      } catch (e) {
        ready.current = true;
        setError(message(e));
      }
    })();
    return () => {
      alive.current = false;
      ready.current = false;
      worker.current?.terminate();
      activeAbort.current?.abort();
      unguard();
      pendingAsk.current?.(false);
    };
  }, []);
  useEffect(() => {
    context.lifecycle.setTitle(`${dirty ? "● " : ""}${workbook.name} — Sheets`);
  }, [workbook.name, dirty]);
  useEffect(() => {
    if (!ready.current || !preferences.recoveryEnabled) return;
    const generation = ++recoveryGeneration.current,
      controller = new AbortController();
    const timer = setTimeout(() => {
      const snapshot = structuredClone(engine.current.workbook);
      serializeWorkbookOffthread(snapshot, controller.signal)
        .then((serialized) => {
          if (
            controller.signal.aborted ||
            generation !== recoveryGeneration.current
          )
            return;
          return saveRecovery(snapshot, {
            key: recoveryKey,
            serialized,
            signal: controller.signal,
          });
        })
        .then((entry) => {
          if (
            entry &&
            alive.current &&
            generation === recoveryGeneration.current
          )
            setRecoveryRevision(snapshot.revision);
        })
        .catch((e) => {
          if (alive.current && !controller.signal.aborted) setError(message(e));
        });
    }, preferences.recoveryInterval * 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workbook.revision, workbook.id, workbook.activeSheetId, preferences.recoveryEnabled, preferences.recoveryInterval]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (
        engine.current.workbook.revision !== saved.current.savedRevision ||
        editingRef.current
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useEffect(() => {
    if (contextMenu) {
      requestAnimationFrame(() =>
        menuRef.current?.querySelector("button")?.focus(),
      );
      const hide = () => setContextMenu(null);
      window.addEventListener("pointerdown", hide);
      return () => window.removeEventListener("pointerdown", hide);
    }
  }, [contextMenu]);
  function select(range: Range, add = false) {
    if (add) setExtraSelections((prev) => [...prev, selection]);
    else setExtraSelections([]);
    setSelection(range);
    setSelectedChart(null);
    if (paint.current) {
      const style = paint.current;
      paint.current = null;
      safely(() => applyStyle(style, range));
    }
    setStatus("Ready");
  }
  function move(row: number, col: number, expand = false) {
    const target = {
      row: Math.max(0, Math.min(1048575, row)),
      col: Math.max(0, Math.min(16383, col)),
    };
    select({ start: expand ? selection.start : target, end: target });
    grid.current?.reveal(target.row, target.col);
  }
  function startEdit(value?: string) {
    if (busy) return;
    if (sheet.protected) {
      setError("Unprotect the worksheet before editing.");
      return;
    }
    const shown = cellPresentation(activeAddress);
    setDraft(
      value ??
        activeCell?.formula ??
        (shown?.value == null
          ? ""
          : isError(shown.value)
            ? shown.value.code
            : String(shown.value)),
    );
    setEditing(true);
  }
  function commit(dr = 1, dc = 0): boolean {
    try {
      const text = correctTypedText(draft, preferences);
      const cell = inputCell(text, activeCell);
      if (workbook.metadata?.defaultCellStyle) cell.style = { ...workbookCellStyle(workbook), ...cell.style };
      const hyperlink = typedHyperlink(text, preferences);
      if (hyperlink) cell.hyperlink = hyperlink;
      engine.current.setCell(sheet.id, activeAddress, cell);
      sync(`Edited ${activeAddress}`);
      setEditing(false);
      if (dc === 0 && dr !== 0) {
        const sign = Math.sign(dr);
        const direction = preferences.enterDirection;
        dr = preferences.moveAfterEnter ? (direction === "down" ? sign : direction === "up" ? -sign : 0) : 0;
        dc = preferences.moveAfterEnter ? (direction === "right" ? sign : direction === "left" ? -sign : 0) : 0;
      }
      move(selection.start.row + dr, selection.start.col + dc);
      requestAnimationFrame(() => grid.current?.focus());
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  }
  function cancelEdit() {
    setEditing(false);
    setDraft("");
    grid.current?.focus();
  }
  function fillCells(source: Range, target: Range) {
    const value = cellValue(sheet.cells[cellAddress(source.start.row, source.start.col)]);
    if (source.start.row !== source.end.row || source.start.col !== source.end.col || typeof value !== "string" || listFillValue(value, 0, preferences) === undefined) {
      engine.current.fillRange(sheet.id, source, target);
      return;
    }
    const edits: {sheetId:string; address:string; input:Cell}[] = [];
    visitCells(target, address => {
      const point = parseAddress(address);
      const offset = target.end.row !== target.start.row ? point.row - source.start.row : point.col - source.start.col;
      edits.push({sheetId:sheet.id,address,input:{value:listFillValue(value,offset,preferences)!,style:sheet.cells[cellAddress(source.start.row,source.start.col)]?.style}});
    });
    engine.current.batch(edits,"Fill custom list");
  }
  function visitCells(
    range: Range,
    fn: (address: string) => void,
    sparse = false,
  ) {
    const r = normalized(range),
      count = (r.end.row - r.start.row + 1) * (r.end.col - r.start.col + 1);
    if (count > MAX_EDIT_CELLS) {
      if (!sparse)
        throw new Error(
          "This edit is limited to 100,000 cells. Select a smaller range.",
        );
      for (const a of Object.keys(sheet.cells)) {
        const p = parseAddress(a);
        if (includes(r, p.row, p.col)) fn(a);
      }
      return;
    }
    for (let row = r.start.row; row <= r.end.row; row++)
      for (let col = r.start.col; col <= r.end.col; col++)
        fn(cellAddress(row, col));
  }
  function applyStyle(style: CellStyle, range = selection) {
    transaction("Format cells", (_, s) => {
      visitCells(range, (a) => {
        s.cells[a] = {
          ...(s.cells[a] ?? { value: null }),
          style: { ...s.cells[a]?.style, ...style },
        };
      });
    });
  }
  function validateInput(address: string, input: string) {
    const cell = inputCell(input, sheet.cells[address]);
    if (cell.formula) return;
    const problem = engine.current.validate(sheet.id, address, cell.value);
    if (problem) throw new Error(problem);
  }
  async function openPath(filePath: string) {
    const controller = new AbortController();
    activeAbort.current = controller;
    setBusy(true);
    try {
      const fs = context.services.files;
      if (/\.xlsx$/i.test(filePath)) {
        if (!fs.readBinary)
          throw new Error("Binary file reads are unavailable.");
        const read = await fs.readBinary(filePath),
          result = await importXlsxAsync(read.data, filePath.split("/").pop(), {
            signal: controller.signal,
          });
        install(result.workbook, filePath, read.version);
        if (result.warnings.length)
          inform("Workbook compatibility", result.warnings.join("\n"));
      } else {
        const read = await fs.read(filePath);
        if (/\.(csv|tsv)$/i.test(filePath)) {
          importCSV(
            read.content,
            filePath.split("/").pop()!,
            filePath,
            read.version,
          );
        } else
          install(
            await deserializeWorkbookOffthread(read.content, controller.signal),
            filePath,
            read.version,
          );
      }
    } finally {
      activeAbort.current = null;
      setBusy(false);
    }
  }
  async function open() {
    if (!(await guard())) return;
    const result = await context.services.dialogs.openFile({
      extensions: [".xlsx", ".lopebook", ".csv", ".tsv"],
    });
    if (result) await openPath(result);
  }
  async function save(as = false) {
    await waitForCalculation(preferences.alwaysRecalculateBeforeSave);
    const controller = new AbortController();
    activeAbort.current = controller;
    setBusy(true);
    try {
      const snapshot = structuredClone(engine.current.workbook);
      let target = saved.current.path;
      if (as || !target || /\.(csv|tsv)$/i.test(target))
        target =
          (await context.services.dialogs.saveFile({
            defaultName: `${snapshot.name.replace(/\.(xlsx|csv|tsv|lopebook)$/i, "")}.${preferences.defaultFormat}`,
          })) ?? "";
      if (!target) return;
      if (!/\.(lopebook|xlsx)$/i.test(target))
        throw new Error(
          "Save editable workbooks as .lopebook or .xlsx. Use Export for CSV/TSV.",
        );
      const warnings = /\.xlsx$/i.test(target)
        ? xlsxExportWarnings(snapshot)
        : [];
      if (
        warnings.length &&
        !(await ask(
          "Confirm XLSX conversion",
          warnings.join("\n") +
            "\nSave as .lopebook to preserve the full native model.",
          "Export with these limitations",
        ))
      )
        return;
      const data = /\.xlsx$/i.test(target)
          ? await exportXlsxAsync(snapshot, {
              allowLossy: true,
              signal: controller.signal,
            })
          : new TextEncoder().encode(
              await serializeWorkbookOffthread(snapshot, controller.signal),
            ),
        fs = context.services.files;
      if (!fs.writeBinary)
        throw new Error("Binary writes are unavailable from this filesystem.");
      controller.signal.throwIfAborted();
      activeAbort.current = null;
      let expected =
        saved.current.path === target ? saved.current.version : undefined;
      try {
        const result = await fs.writeBinary(
          target,
          data,
          expected ? { version: expected } : { createOnly: true },
        );
        expected = result.version;
      } catch (e) {
        if (!/exist|conflict/i.test(message(e))) throw e;
        if (saved.current.path === target && saved.current.version)
          throw new Error(
            "The file changed in another window. Use Save As to preserve both versions.",
          );
        if (
          !(await ask(
            "Replace existing file?",
            `${target} already exists. Replace it with this workbook?`,
            "Replace",
          ))
        )
          return;
        const existing = await fs.stat(target);
        if (!existing.version)
          throw new Error(
            "Cannot safely replace a file without a version. Choose a new filename.",
          );
        expected = (
          await fs.writeBinary(target, data, { version: existing.version })
        ).version;
      }
      setPath(target);
      setVersion(expected);
      setSavedRevision(snapshot.revision);
      context.services.settings.set(`sheets.document.${context.windowId}`, {
        path: target,
      });
      setStatus("Saved to workspace");
      playSheetSound(preferences.eventSounds);
    } finally {
      activeAbort.current = null;
      setBusy(false);
    }
  }
  async function importLocal(file: File) {
    if (!(await guard())) return;
    const controller = new AbortController();
    activeAbort.current = controller;
    if (file.size > 64 * 1024 * 1024)
      throw new Error("Import is limited to 64 MB compressed files.");
    setBusy(true);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const result = await importXlsxAsync(
          new Uint8Array(await file.arrayBuffer()),
          file.name,
          { signal: controller.signal },
        );
        install(result.workbook);
        setSavedRevision(-1);
        if (result.warnings.length)
          inform("Workbook compatibility", result.warnings.join("\n"));
      } else if (/\.lopebook$/i.test(file.name)) {
        install(
          await deserializeWorkbookOffthread(
            await file.text(),
            controller.signal,
          ),
        );
        setSavedRevision(-1);
      } else if (/\.(csv|tsv|txt)$/i.test(file.name))
        importCSV(await file.text(), file.name);
      else
        throw new Error(
          "Supported imports: XLSX, .lopebook, CSV, and TSV. XLSM/XLSB/XLS/ODS need separate compatible parsers.",
        );
    } finally {
      activeAbort.current = null;
      setBusy(false);
    }
  }
  function importCSV(
    text: string,
    name: string,
    newPath = "",
    fileVersion?: string,
  ) {
    const delimiter = name.endsWith(".tsv") ? "\t" : ",";
    show({
      title: "Import Text / CSV",
      description:
        "Preview uses UTF-8. Text preserves leading zeros and long identifiers. Numeric conversion applies only to columns you specify; formula-looking fields remain text.",
      content: (
        <pre className="sheets-import-preview">{text.slice(0, 2000)}</pre>
      ),
      fields: [
        selectField(
          "delimiter",
          "Delimiter",
          [",", ";", "|", "Tab"],
          delimiter === "\t" ? "Tab" : delimiter,
        ),
        textField("numeric", "Numeric columns (1-based, comma separated)", ""),
      ],
      submit: "Import",
      onSubmit: async (v) => {
        const types: DelimitedOptions["types"] = {};
        v.numeric
          .split(",")
          .filter(Boolean)
          .forEach((n) => {
            if (!/^\d+$/.test(n.trim()) || +n < 1)
              throw new Error(
                "Enter positive column numbers separated by commas.",
              );
            types[+n - 1] = "number";
          });
        const wb = await importDelimitedOffthread(text, {
          delimiter: (v.delimiter === "Tab"
            ? "\t"
            : v.delimiter) as DelimitedOptions["delimiter"],
          name,
          types,
        });
        install(wb, newPath, fileVersion);
        setSavedRevision(-1);
      },
    });
  }
  async function download(format: string) {
    await waitForCalculation();
    const snapshot = engine.current.workbook;
    if (format === "xlsx") {
      const warnings = xlsxExportWarnings(snapshot);
      if (
        warnings.length &&
        !(await ask(
          "Confirm XLSX conversion",
          warnings.join("\n"),
          "Export with limitations",
        ))
      )
        return;
    } else if ((format === "csv" || format === "tsv") && preferences.warnBeforeCsvExport) {
      if (
        !(await ask(
          "Export one worksheet?",
          `${format.toUpperCase()} exports ${sheet.name} as text values only. Formulas, styles, charts, and other sheets are not included.`,
          "Export worksheet",
        ))
      )
        return;
    }
    const controller = new AbortController();
    activeAbort.current = controller;
    setBusy(true);
    try {
      const bytes =
        format === "xlsx"
          ? await exportXlsxAsync(snapshot, {
              allowLossy: true,
              signal: controller.signal,
            })
          : new TextEncoder().encode(
              format === "lopebook"
                ? await serializeWorkbookOffthread(snapshot, controller.signal)
                : await exportDelimitedOffthread(sheet, {
                    delimiter: format === "tsv" ? "\t" : ",",
                    signal: controller.signal,
                  }),
            );
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${snapshot.name.replace(/\.[^.]+$/, "")}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Exported ${format.toUpperCase()}`);
    } finally {
      activeAbort.current = null;
      setBusy(false);
    }
  }
  function dataRange() {
    return selection.start.row === selection.end.row &&
      selection.start.col === selection.end.col
      ? (tableContext?.range ?? usedRange(sheet))
      : normalized(selection);
  }
  function getData(range = dataRange()) {
    return sheetData(sheet, range);
  }
  function dataToNewSheet(data: DataSet, name: string) {
    transaction(`Created ${name}`, (wb) => {
      const s = createSheet(uniqueSheetName(name));
      applyDataToSheet(s, data, { row: 0, col: 0 });
      wb.sheets.push(s);
      wb.activeSheetId = s.id;
    });
    setSelection(initialSelection);
  }
  function uniqueSheetName(base: string) {
    let candidate = base.slice(0, 25),
      n = 1;
    while (engine.current.workbook.sheets.some((s) => s.name === candidate))
      candidate = `${base.slice(0, 25)} ${++n}`;
    return candidate;
  }
  async function copy(cut = false) {
    let text = "";
    const r = normalized(selection),
      cells: Record<string, Cell> = {};
    visitCells(r, (a) => {
      if (sheet.cells[a]) cells[a] = structuredClone(sheet.cells[a]);
    });
    for (let row = r.start.row; row <= r.end.row; row++) {
      const values = [];
      for (let col = r.start.col; col <= r.end.col; col++) {
        const val = formatValue(
          sheet.cells[cellAddress(row, col)],
          workbook.dateSystem,
        );
        values.push(
          /[\t\n"]/u.test(val) ? `"${val.replace(/"/g, '""')}"` : val,
        );
      }
      text += values.join("\t") + (row < r.end.row ? "\n" : "");
    }
    clipboard.current = { sheetId: sheet.id, range: r, cells, cut, text };
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setStatus(
        "Copied inside Sheets. Browser clipboard permission is unavailable.",
      );
      return;
    }
    setStatus(
      cut ? "Cut range — choose a destination and paste" : "Copied range",
    );
  }
  async function paste(text?: string) {
    if (text === undefined) {
      try {
        text = await navigator.clipboard.readText();
      } catch {
        if (!clipboard.current)
          throw new Error(
            "Use Ctrl+V or ⌘V in the worksheet to paste from the browser clipboard.",
          );
        text = clipboard.current.text;
      }
    }
    const clip = clipboard.current;
    if (clip && text === clip.text && clip.sheetId === sheet.id) {
      for (const [a, c] of Object.entries(clip.cells)) {
        const pt = parseAddress(a),
          dest = cellAddress(
            selection.start.row + pt.row - clip.range.start.row,
            selection.start.col + pt.col - clip.range.start.col,
          );
        validateInput(dest, c.formula ?? String(c.value ?? ""));
      }
      engine.current.copyRange(sheet.id, clip.range, selection.start, {
        cut: clip.cut,
      });
      if (clip.cut) clipboard.current = null;
      sync("Pasted cells");
      return;
    }
    const rows = parseDelimited(text, "\t");
    if (
      rows.length * Math.max(0, ...rows.map((r) => r.length)) >
      MAX_EDIT_CELLS
    )
      throw new Error("Paste is limited to 100,000 cells.");
    const edits: { sheetId: string; address: string; input: string }[] = [];
    rows.forEach((row, r) =>
      row.forEach((value, c) => {
        const address = cellAddress(
          selection.start.row + r,
          selection.start.col + c,
        );
        validateInput(address, value);
        edits.push({ sheetId: sheet.id, address, input: value });
      }),
    );
    engine.current.batch(edits);
    sync("Pasted cells");
  }
  function onKey(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey,
      key = e.key.toLowerCase();
    if (mod) {
      if (["c", "x", "v"].includes(key)) {
        if (key === "v") return;
        e.preventDefault();
        safely(() => copy(key === "x"));
        return;
      }
      if (key === "a") {
        e.preventDefault();
        select({
          start: { row: 0, col: 0 },
          end: { row: 1048575, col: 16383 },
        });
        return;
      }
      if (key === " ") {
        e.preventDefault();
        select({
          start: { row: 0, col: selection.start.col },
          end: { row: 1048575, col: selection.end.col },
        });
        return;
      }
      const mapped: Record<string, string> = {
        s: e.shiftKey ? "save-as" : "save",
        o: "open",
        z: e.shiftKey ? "redo" : "undo",
        y: "redo",
        b: "bold",
        i: "italic",
        u: "underline",
        f: "find",
        h: "replace",
        g: "goto",
        d: "fill-down",
        r: "fill-right",
        "`": "show-formulas",
        ",": "preferences",
      };
      if (mapped[key]) {
        e.preventDefault();
        e.stopPropagation();
        action(mapped[key]);
        return;
      }
    }
    if (e.key === " " && e.shiftKey) {
      e.preventDefault();
      select({
        start: { row: selection.start.row, col: 0 },
        end: { row: selection.end.row, col: 16383 },
      });
      return;
    }
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        "Tab",
        "Home",
        "End",
        "PageDown",
        "PageUp",
      ].includes(e.key)
    ) {
      e.preventDefault();
      let { row, col } = e.shiftKey ? selection.end : selection.start;
      const end = usedRange(sheet).end;
      if (e.key === "ArrowUp") row = mod ? 0 : row - 1;
      if (e.key === "ArrowDown") row = mod ? end.row : row + 1;
      if (e.key === "ArrowLeft") col = mod ? 0 : col - 1;
      if (e.key === "ArrowRight") col = mod ? end.col : col + 1;
      if (e.key === "Enter" && preferences.moveAfterEnter) {
        const delta = e.shiftKey ? -1 : 1;
        if (preferences.enterDirection === "down") row += delta;
        if (preferences.enterDirection === "up") row -= delta;
        if (preferences.enterDirection === "right") col += delta;
        if (preferences.enterDirection === "left") col -= delta;
      }
      if (e.key === "Tab") col += e.shiftKey ? -1 : 1;
      if (e.key === "Home") {
        col = 0;
        if (mod) row = 0;
      }
      if (e.key === "End") {
        col = end.col;
        if (mod) row = end.row;
      }
      if (e.key === "PageDown") row += 20;
      if (e.key === "PageUp") row -= 20;
      move(row, col, e.shiftKey && !["Enter", "Tab"].includes(e.key));
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      startEdit();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      action("clear");
      return;
    }
    if (e.key === "Escape") {
      setContextMenu(null);
      setSelectedChart(null);
      return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      startEdit(e.key);
    }
  }
  function writeRefreshedData(
    wb: Workbook,
    dest: Worksheet,
    data: DataSet,
    start: { row: number; col: number },
  ) {
    const previous = (
        wb.metadata?.outputRanges as Record<string, Range> | undefined
      )?.[dest.id],
      next = {
        start,
        end: {
          row: start.row + data.rows.length,
          col: start.col + data.columns.length - 1,
        },
      };
    for (const [address, cell] of Object.entries(dest.cells)) {
      const point = parseAddress(address);
      if (
        includes(next, point.row, point.col) &&
        (!previous || !includes(previous, point.row, point.col)) &&
        (cell.value !== null || cell.formula)
      )
        throw new Error(
          "The refreshed result would overwrite cells outside its previous output. Move those cells before refreshing.",
        );
    }
    if (previous)
      for (const address of Object.keys(dest.cells)) {
        const point = parseAddress(address);
        if (includes(previous, point.row, point.col))
          delete dest.cells[address];
      }
    const output = applyDataToSheet(dest, data, start);
    if (previous)
      for (const chart of dest.charts)
        if (rangeLabel(chart.range) === rangeLabel(previous))
          chart.range = output;
    wb.metadata = {
      ...wb.metadata,
      outputRanges: {
        ...((wb.metadata?.outputRanges as object) ?? {}),
        [dest.id]: output,
      },
    };
  }
  function formatDialog() {
    show({
      title: "Format Cells",
      fields: [
        selectField(
          "numberFormat",
          "Category / number format",
          [
            "General",
            "0",
            "0.00",
            "#,##0.00",
            "$#,##0.00",
            "0.00%",
            "m/d/yyyy",
            "yyyy-mm-dd",
            "@",
          ],
          activeStyle.numberFormat ?? "General",
        ),
        textField("custom", "Custom format", activeStyle.numberFormat ?? ""),
        selectField(
          "fontFamily",
          "Font",
          [
            "Aptos",
            "Arial",
            "Calibri",
            "Georgia",
            "Times New Roman",
            "monospace",
          ],
          activeStyle.fontFamily ?? "Aptos",
        ),
        numberField("fontSize", "Size", activeStyle.fontSize ?? 11),
        selectField(
          "horizontal",
          "Horizontal alignment",
          ["left", "center", "right", "justify"],
          activeStyle.horizontal ?? "left",
        ),
        selectField(
          "vertical",
          "Vertical alignment",
          ["top", "middle", "bottom"],
          activeStyle.vertical ?? "bottom",
        ),
        {
          name: "wrap",
          label: "Wrap text",
          type: "checkbox",
          value: String(!!activeStyle.wrap),
        },
        numberField("indent", "Indent", activeStyle.indent ?? 0),
        numberField(
          "rotation",
          "Rotation (degrees)",
          activeStyle.rotation ?? 0,
        ),
      ],
      onSubmit: (v) => {
        if (
          +v.fontSize < 6 ||
          +v.fontSize > 96 ||
          +v.rotation < -90 ||
          +v.rotation > 90
        )
          throw new Error("Font size must be 6–96 and rotation −90–90.");
        applyStyle({
          ...v,
          fontSize: +v.fontSize,
          numberFormat: v.custom || v.numberFormat,
          horizontal: v.horizontal as CellStyle["horizontal"],
          vertical: v.vertical as CellStyle["vertical"],
          wrap: v.wrap === "true",
          indent: +v.indent,
          rotation: +v.rotation,
        });
      },
    });
  }
  function chartDialog(kind: Chart["type"] = preferences.chartType, existing?: Chart) {
    show({
      title: existing ? "Edit Chart" : "Insert Chart",
      fields: [
        textField("title", "Chart title", existing?.title ?? "Chart Title"),
        textField(
          "range",
          "Source range (headers in first row)",
          rangeLabel(existing?.range ?? dataRange()),
        ),
        selectField(
          "type",
          "Chart type",
          ["column", "bar", "line", "area", "scatter", "pie", "doughnut"],
          existing?.type ?? kind,
        ),
        numberField("width", "Width", existing?.width ?? 440),
        numberField("height", "Height", existing?.height ?? 290),
        {
          name: "legend",
          label: "Show legend",
          type: "checkbox",
          value: String(existing?.showLegend ?? preferences.chartLegend),
        },
        { name: "labels", label: "Show data labels", type: "checkbox", value: String(existing?.showLabels ?? preferences.chartLabels) },
      ],
      onSubmit: (v) => {
        const range = parseRange(v.range);
        if (
          range.end.col === range.start.col ||
          range.end.row === range.start.row
        )
          throw new Error(
            "Select a label column, at least one value column, and a header row.",
          );
        if (
          +v.width < 240 ||
          +v.width > 1500 ||
          +v.height < 200 ||
          +v.height > 1000
        )
          throw new Error("Use width 240–1500 and height 200–1000.");
        const id = existing?.id ?? newId("chart");
        transaction("Chart settings", (_, s) => {
          const chart: Chart = {
            id,
            title: v.title,
            range,
            type: v.type as Chart["type"],
            width: +v.width,
            height: +v.height,
            x: existing?.x ?? 360,
            y: existing?.y ?? 65,
            showLegend: v.legend === "true",
            showLabels: v.labels === "true",
          };
          if (existing)
            s.charts = s.charts.map((c) => (c.id === id ? chart : c));
          else s.charts.push(chart);
        });
        setSelectedChart(id);
        setTab("Chart Design");
      },
    });
  }
  function pageSetup() {
    const p = sheet.print;
    const unit = preferences.measurementUnit, factor = unit === "centimeters" ? 2.54 : 1;
    show({
      title: "Page Setup",
      fields: [
        selectField(
          "orientation",
          "Orientation",
          ["portrait", "landscape"],
          p.orientation,
        ),
        selectField(
          "paperSize",
          "Paper size",
          ["Letter", "A4", "Legal", "A3"],
          p.paperSize,
        ),
        numberField("scale", "Scale (%)", p.scale),
        numberField(
          "fitToWidth",
          "Fit to pages wide (0 = use scale)",
          p.fitToWidth ?? 0,
        ),
        numberField("top", `Top margin (${unit})`, p.margins.top * factor),
        numberField("bottom", `Bottom margin (${unit})`, p.margins.bottom * factor),
        numberField("left", `Left margin (${unit})`, p.margins.left * factor),
        numberField("right", `Right margin (${unit})`, p.margins.right * factor),
        textField("area", "Print area", p.area ? rangeLabel(p.area) : ""),
        textField(
          "repeatRows",
          "Rows to repeat (e.g. 1:2)",
          p.repeatRows ? `${p.repeatRows[0] + 1}:${p.repeatRows[1] + 1}` : "",
        ),
        textField("header", "Header", p.header ?? ""),
        textField("footer", "Footer", p.footer ?? "Page &P of &N"),
        {
          name: "gridlines",
          label: "Print gridlines",
          type: "checkbox",
          value: String(!!p.gridlines),
        },
      ],
      onSubmit: (v) => {
        if (+v.scale < 10 || +v.scale > 400)
          throw new Error("Scale must be between 10% and 400%.");
        for (const side of ["top", "bottom", "left", "right"])
          if (!Number.isFinite(+v[side]) || +v[side] < 0 || +v[side] > 3 * factor)
            throw new Error(`Margins must be between 0 and ${3 * factor} ${unit}.`);
        const repeat = v.repeatRows ? parseRange(v.repeatRows) : undefined;
        transaction("Print settings", (_, s) => {
          s.print = {
            ...s.print,
            orientation: v.orientation as "portrait" | "landscape",
            paperSize: v.paperSize as typeof p.paperSize,
            scale: +v.scale,
            fitToWidth: +v.fitToWidth || undefined,
            margins: {
              top: +v.top / factor,
              bottom: +v.bottom / factor,
              left: +v.left / factor,
              right: +v.right / factor,
            },
            area: v.area ? parseRange(v.area) : undefined,
            repeatRows: repeat ? [repeat.start.row, repeat.end.row] : undefined,
            header: v.header,
            footer: v.footer,
            gridlines: v.gridlines === "true",
          };
        });
      },
    });
  }
  function action(id: string, value?: string) {
    safely(async () => {
      if (
        editing &&
        id !== "function" &&
        !id.startsWith("functions") &&
        !commitRef.current()
      )
        return;
      if (
        id.startsWith("functions-") ||
        id === "function" ||
        id === "functions"
      ) {
        show({
          title: "Insert Function",
          description:
            "Functions are evaluated locally. The registry distinguishes tested functions from unverified library implementations.",
          fields: [
            textField("function", "Function name", "SUM"),
            textField("arguments", "Arguments", rangeLabel(selection)),
          ],
          content: (
            <p className="sheets-function-list">
              {functionRegistry.map((f) => f.name).join(" · ")}
            </p>
          ),
          submit: "Insert",
          onSubmit: (v) => {
            startEdit(`=${v.function.toUpperCase()}(${v.arguments})`);
          },
        });
        return;
      }
      switch (id) {
        case "preferences":
          setPreferencesOpen(true);
          setContextMenu(null);
          break;
        case "custom-list-import": {
          const entries: string[] = [];
          visitCells(selection, address => { const value = cellValue(cellPresentation(address)); if (value !== null && value !== "" && !isError(value)) entries.push(String(value)); });
          if (!entries.length || entries.length > 366 || entries.some(v => v.length > 100)) throw new Error("Select 1–366 filled cells with entries of at most 100 characters.");
          updatePreference("customLists", [...preferences.customLists, entries]);
          setStatus(`Imported custom list with ${entries.length} entries`);
          break;
        }
        case "clear-recovery":
          await removeRecovery(recoveryKey);
          setRecoveryRevision(-1);
          setStatus("Recovery copy for this window removed");
          break;
        case "new":
          if (await guard()) install(workbookWithPreferences(preferences));
          break;
        case "new-window":
          context.services.launch("lope.sheets");
          break;
        case "open":
          await open();
          break;
        case "import":
          fileInput.current?.click();
          break;
        case "save":
          await save();
          break;
        case "save-as":
          await save(true);
          break;
        case "export":
          show({
            title: "Export Workbook",
            fields: [
              selectField("format", "File format", [
                "xlsx",
                "lopebook",
                "csv",
                "tsv",
              ]),
            ],
            onSubmit: (v) => {
              setTimeout(() => safely(() => download(v.format)), 0);
            },
          });
          break;
        case "budget":
          if (await guard()) {
            install(createBudgetWorkbook());
            setSavedRevision(-1);
          }
          break;
        case "undo":
          engine.current.undo();
          sync("Undo");
          break;
        case "redo":
          engine.current.redo();
          sync("Redo");
          break;
        case "cut":
          await copy(true);
          break;
        case "copy":
          await copy();
          break;
        case "paste":
          await paste();
          break;
        case "paint":
          paint.current = { ...activeStyle };
          setStatus("Select a destination to apply the copied format");
          break;
        case "bold":
        case "italic":
        case "underline":
          applyStyle({ [id]: !activeStyle[id] });
          break;
        case "fontFamily":
        case "fill":
        case "color":
        case "numberFormat":
          applyStyle({ [id]: value });
          break;
        case "fontSize":
          if (Number(value) >= 6 && Number(value) <= 96)
            applyStyle({ fontSize: Number(value) });
          break;
        case "align-left":
        case "align-center":
        case "align-right":
          applyStyle({ horizontal: id.slice(6) as CellStyle["horizontal"] });
          break;
        case "wrap":
          applyStyle({ wrap: !activeStyle.wrap });
          break;
        case "indent-less":
        case "indent-more":
          applyStyle({
            indent: Math.max(
              0,
              Math.min(
                15,
                (activeStyle.indent ?? 0) + (id === "indent-more" ? 1 : -1),
              ),
            ),
          });
          break;
        case "currency":
          applyStyle({ numberFormat: "$#,##0.00" });
          break;
        case "percent":
          applyStyle({ numberFormat: "0.00%" });
          break;
        case "decimals-more":
        case "decimals-less": {
          const dec =
              (activeStyle.numberFormat ?? "0").match(/\.([0#]+)/)?.[1]
                .length ?? 0,
            n = Math.max(
              0,
              Math.min(10, dec + (id === "decimals-more" ? 1 : -1)),
            );
          applyStyle({
            numberFormat:
              (activeStyle.numberFormat?.includes("$") ? "$" : "") +
              "#,##0" +
              (n ? "." + "0".repeat(n) : "") +
              (activeStyle.numberFormat?.includes("%") ? "%" : ""),
          });
          break;
        }
        case "borders":
          applyStyle({
            borders: Object.fromEntries(
              ["top", "bottom", "left", "right"].map((k) => [
                k,
                { style: "thin", color: "#a1aaa5" },
              ]),
            ),
          });
          break;
        case "format":
          formatDialog();
          break;
        case "cell-style":
          show({
            title: "Cell Styles",
            fields: [
              selectField("style", "Style", [
                "Normal",
                "Heading",
                "Accent",
                "Good",
                "Warning",
                "Total",
              ]),
            ],
            onSubmit: (v) => {
              const styles: Record<string, CellStyle> = {
                Normal: { fill: "#ffffff", color: "#202124", bold: false },
                Heading: {
                  fill: "#226d50",
                  color: "#ffffff",
                  bold: true,
                  fontSize: 14,
                },
                Accent: { fill: "#e2f1e9", color: "#175a3f" },
                Good: { fill: "#dcf3de", color: "#245d2d" },
                Warning: { fill: "#fff0cc", color: "#855b08" },
                Total: {
                  bold: true,
                  borders: { top: { style: "double", color: "#226d50" } },
                },
              };
              applyStyle(styles[v.style]);
            },
          });
          break;
        case "merge": {
          const r = normalized(selection),
            existing = sheet.merges.find((m) =>
              includes(m, r.start.row, r.start.col),
            );
          if (!existing) {
            let filled = 0;
            visitCells(r, (a) => {
              if (cellValue(sheet.cells[a]) !== null) filled++;
            });
            if (
              filled > 1 &&
              !(await ask(
                "Merge cells?",
                "Only the upper-left value is retained in a merged cell. Undo can restore the original cells.",
                "Merge",
              ))
            )
              break;
          }
          transaction(existing ? "Unmerge cells" : "Merge cells", (_, s) => {
            if (existing) s.merges = s.merges.filter((m) => m !== existing);
            else {
              if (
                s.merges.some(
                  (m) =>
                    !(
                      m.end.row < r.start.row ||
                      m.start.row > r.end.row ||
                      m.end.col < r.start.col ||
                      m.start.col > r.end.col
                    ),
                )
              )
                throw new Error("This selection overlaps an existing merge.");
              visitCells(r, (a) => {
                if (a !== cellAddress(r.start.row, r.start.col))
                  delete s.cells[a];
              });
              s.merges.push(r);
              const a = cellAddress(r.start.row, r.start.col);
              s.cells[a] = {
                ...(s.cells[a] ?? { value: null }),
                style: { ...s.cells[a]?.style, horizontal: "center" },
              };
            }
          });
          break;
        }
        case "clear":
          engine.current.clearRange(sheet.id, normalized(selection));
          sync("Cleared contents");
          break;
        case "fill-down":
        case "fill-right": {
          const r = normalized(selection),
            source = {
              start: r.start,
              end:
                id === "fill-down"
                  ? { row: r.start.row, col: r.end.col }
                  : { row: r.end.row, col: r.start.col },
            };
          fillCells(source, r);
          sync("Filled cells");
          break;
        }
        case "insert-cells":
        case "delete-cells":
          show({
            title: id === "insert-cells" ? "Insert Cells" : "Delete Cells",
            fields: [
              selectField("axis", "Shift entire", ["Rows", "Columns"]),
              numberField("count", "Count", 1),
            ],
            onSubmit: (v) => {
              const count = +v.count;
              if (!Number.isInteger(count) || count < 1 || count > 100000)
                throw new Error("Use a count of 1–100,000.");
              if (v.axis === "Rows") {
                if (id === "insert-cells")
                  engine.current.insertRows(
                    sheet.id,
                    selection.start.row,
                    count,
                  );
                else
                  engine.current.deleteRows(
                    sheet.id,
                    selection.start.row,
                    count,
                  );
              } else if (id === "insert-cells")
                engine.current.insertColumns(
                  sheet.id,
                  selection.start.col,
                  count,
                );
              else
                engine.current.deleteColumns(
                  sheet.id,
                  selection.start.col,
                  count,
                );
              sync(id === "insert-cells" ? "Inserted cells" : "Deleted cells");
            },
          });
          break;
        case "cell-size":
          show({
            title: "Row and Column Format",
            fields: [
              numberField(
                "width",
                "Column width (pixels)",
                sheet.columns[selection.start.col]?.width ?? 96,
              ),
              numberField(
                "height",
                "Row height (pixels)",
                sheet.rows[selection.start.row]?.height ?? 22,
              ),
              selectField("hidden", "Visibility", [
                "Show selected rows and columns",
                "Hide selected rows",
                "Hide selected columns",
              ]),
            ],
            onSubmit: (v) => {
              if (
                +v.width < 24 ||
                +v.width > 800 ||
                +v.height < 16 ||
                +v.height > 800
              )
                throw new Error(
                  "Width 24–800 and height 16–800 pixels required.",
                );
              const r = normalized(selection);
              if (r.end.row - r.start.row > 100000)
                throw new Error("Select fewer than 100,000 rows.");
              transaction("Resize cells", (_, s) => {
                for (let c = r.start.col; c <= r.end.col; c++)
                  s.columns[c] = {
                    ...s.columns[c],
                    width: +v.width,
                    hidden: v.hidden === "Hide selected columns",
                  };
                for (let row = r.start.row; row <= r.end.row; row++)
                  s.rows[row] = {
                    ...s.rows[row],
                    height: +v.height,
                    hidden: v.hidden === "Hide selected rows",
                  };
              });
            },
          });
          break;
        case "autosum": {
          const r = normalized(selection);
          const formula =
            selection.start.row === selection.end.row &&
            selection.start.col === selection.end.col
              ? `=SUM(${cellAddress(0, r.start.col)}:${cellAddress(Math.max(0, r.start.row - 1), r.start.col)})`
              : `=SUM(${rangeLabel(r)})`;
          const address =
            selection.start.row === selection.end.row &&
            selection.start.col === selection.end.col
              ? activeAddress
              : cellAddress(r.end.row + 1, r.start.col);
          engine.current.setCell(sheet.id, address, formula);
          sync("Inserted SUM");
          const p = parseAddress(address);
          move(p.row, p.col);
          break;
        }
        case "table": {
          const r = tableContext?.range ?? dataRange();
          show({
            title: tableContext ? "Table Settings" : "Create Table",
            fields: [
              textField(
                "name",
                "Table name",
                tableContext?.name ?? `Table${sheet.tables.length + 1}`,
              ),
              textField("range", "Range", rangeLabel(r)),
              {
                name: "bands",
                label: "Banded rows",
                type: "checkbox",
                value: String(tableContext?.bandedRows ?? true),
              },
            ],
            onSubmit: (v) => {
              if (!/^[A-Za-z_][\w]*$/.test(v.name) || isCellReference(v.name))
                throw new Error(
                  "Use a unique table name, without spaces or cell addresses.",
                );
              const range = parseRange(v.range);
              const columns = getData(range).columns;
              transaction("Table settings", (_, s) => {
                if (
                  workbook.sheets.some((sh) =>
                    sh.tables.some(
                      (t) =>
                        t.id !== tableContext?.id &&
                        t.name.toLowerCase() === v.name.toLowerCase(),
                    ),
                  )
                )
                  throw new Error("That table name is already in use.");
                const table = {
                  id: tableContext?.id ?? newId("table"),
                  name: v.name,
                  range,
                  columns,
                  headerRow: true,
                  totalsRow: tableContext?.totalsRow ?? false,
                  bandedRows: v.bands === "true",
                  style: "TableStyleMedium2",
                };
                if (tableContext)
                  s.tables = s.tables.map((t) =>
                    t.id === tableContext.id ? table : t,
                  );
                else s.tables.push(table);
              });
              setTab("Table Design");
            },
          });
          break;
        }
        case "convert-table":
          if (tableContext)
            transaction("Converted table to range", (_, s) => {
              s.tables = s.tables.filter((t) => t.id !== tableContext.id);
            });
          setTab("Home");
          break;
        case "table-bands":
          if (tableContext)
            transaction("Table banding", (_, s) => {
              s.tables.find((t) => t.id === tableContext.id)!.bandedRows =
                !tableContext.bandedRows;
            });
          break;
        case "table-totals":
          if (tableContext)
            transaction("Table totals", (_, s) => {
              const t = s.tables.find((t) => t.id === tableContext.id)!;
              if (!t.totalsRow) {
                const row = t.range.end.row + 1;
                for (
                  let col = t.range.start.col;
                  col <= t.range.end.col;
                  col++
                ) {
                  const a = cellAddress(row, col);
                  if (s.cells[a])
                    throw new Error(
                      "The totals row would overwrite cells. Insert a blank row below the table.",
                    );
                  setCell(
                    s,
                    a,
                    col === t.range.start.col
                      ? "Total"
                      : `=SUBTOTAL(109,${cellAddress(t.range.start.row + 1, col)}:${cellAddress(t.range.end.row, col)})`,
                  );
                }
                t.range.end.row++;
                t.totalsRow = true;
              } else {
                for (let col = t.range.start.col; col <= t.range.end.col; col++)
                  delete s.cells[cellAddress(t.range.end.row, col)];
                t.range.end.row--;
                t.totalsRow = false;
              }
            });
          break;
        case "sort": {
          const range = dataRange(),
            data = getData(range);
          show({
            title: "Sort",
            description:
              "Complete records move together. The first row is treated as column headings. Add a second key for a multi-level sort.",
            fields: [
              selectField("field", "Sort by", data.columns),
              selectField("direction", "Order", ["asc", "desc"]),
              selectField("second", "Then by", ["(none)", ...data.columns]),
              selectField("secondDirection", "Then order", ["asc", "desc"]),
            ],
            onSubmit: (v) => {
              const sorted = sortData(data, [
                { field: v.field, direction: v.direction as "asc" | "desc" },
                ...(v.second === "(none)"
                  ? []
                  : [
                      {
                        field: v.second,
                        direction: v.secondDirection as "asc" | "desc",
                      },
                    ]),
              ]);
              transaction("Sorted records", (_, s) => {
                const snapshot = structuredClone(s.cells);
                sorted.rowIds?.forEach((rid, i) => {
                  const sourceRow = Number(rid.slice(rid.lastIndexOf(":") + 1)),
                    targetRow = range.start.row + 1 + i;
                  for (let col = range.start.col; col <= range.end.col; col++) {
                    const old = snapshot[cellAddress(sourceRow, col)],
                      address = cellAddress(targetRow, col);
                    if (old) {
                      s.cells[address] = {
                        ...old,
                        ...(old.formula
                          ? {
                              formula: adjustFormula(
                                old.formula,
                                targetRow - sourceRow,
                                0,
                              ),
                            }
                          : {}),
                      };
                    } else delete s.cells[address];
                  }
                });
              });
            },
          });
          break;
        }
        case "filter": {
          const range = dataRange(),
            data = getData(range);
          show({
            title: "Filter",
            fields: [
              selectField("field", "Column", data.columns),
              selectField("operator", "Condition", [
                "contains",
                "eq",
                "neq",
                "gt",
                "gte",
                "lt",
                "lte",
                "blank",
                "notBlank",
                "error",
                "notError",
              ]),
              textField("value", "Value"),
              selectField("type", "Value type", ["text", "number"]),
            ],
            onSubmit: (v) => {
              const clauses: FilterClause[] = [
                  {
                    field: v.field,
                    operator: v.operator as FilterClause["operator"],
                    value: v.type === "number" ? Number(v.value) : v.value,
                  },
                ],
                visible = new Set(filterData(data, clauses).rowIds);
              setFilter({ sheetId: sheet.id, range, clauses });
              transaction("Applied filter", (wb, s) => {
                for (const row of Object.values(s.rows)) delete row.filtered;
                data.rowIds?.forEach((id) => {
                  if (!visible.has(id)) {
                    const row = Number(id.slice(id.lastIndexOf(":") + 1));
                    s.rows[row] = { ...s.rows[row], filtered: true };
                  }
                });
                wb.metadata = {
                  ...wb.metadata,
                  filters: {
                    ...((wb.metadata?.filters as object) ?? {}),
                    [s.id]: { range, clauses },
                  },
                };
              });
              setStatus("Filter applied");
            },
          });
          break;
        }
        case "clear-filter":
          setFilter(null);
          transaction("Cleared filter", (wb, s) => {
            for (const row of Object.values(s.rows)) delete row.filtered;
            if (wb.metadata?.filters)
              delete (wb.metadata.filters as Record<string, unknown>)[s.id];
          });
          break;
        case "duplicates": {
          const range = dataRange(),
            data = getData(range);
          show({
            title: "Remove Duplicates",
            fields: [
              textField(
                "columns",
                "Compare columns (comma separated)",
                data.columns.join(", "),
              ),
            ],
            onSubmit: (v) => {
              const result = removeDuplicates(
                data,
                v.columns.split(",").map((s) => s.trim()),
              );
              transaction("Removed duplicate records", (_, s) =>
                applyDataToSheet(s, result.data, range.start, {
                  clearRange: range,
                  preserveRows: true,
                }),
              );
              setStatus(`${result.removed} duplicate records removed`);
            },
          });
          break;
        }
        case "text-columns": {
          const range = dataRange(),
            data = getData(range);
          show({
            title: "Text to Columns",
            description:
              "The transformed result opens on a new worksheet so adjacent cells are preserved.",
            fields: [
              selectField("column", "Column", data.columns),
              textField("delimiter", "Delimiter", ","),
            ],
            onSubmit: (v) =>
              dataToNewSheet(
                textToColumns(data, v.column, v.delimiter),
                "Split columns",
              ),
          });
          break;
        }
        case "validation":
          show({
            title: "Data Validation",
            fields: [
              textField("range", "Apply to", rangeLabel(selection)),
              selectField("type", "Allow", [
                "list",
                "whole",
                "decimal",
                "date",
                "textLength",
                "Remove validation",
              ]),
              textField("values", "List values (comma separated)", "Yes, No"),
              selectField("operator", "Condition", [
                "between",
                "notBetween",
                "equal",
                "notEqual",
                "greater",
                "less",
                "greaterOrEqual",
                "lessOrEqual",
              ]),
              textField("minimum", "Minimum / value", "0"),
              textField("maximum", "Maximum", "100"),
              textField("prompt", "Input message", ""),
              textField(
                "error",
                "Error message",
                "This value does not meet the validation rule.",
              ),
              {
                name: "blank",
                label: "Ignore blank",
                type: "checkbox",
                value: "true",
              },
            ],
            onSubmit: (v) => {
              const range = parseRange(v.range);
              transaction("Data validation", (_, s) => {
                s.validations = s.validations.filter(
                  (rule) => rangeLabel(rule.range) !== rangeLabel(range),
                );
                if (v.type !== "Remove validation")
                  s.validations.push({
                    id: newId("validation"),
                    range,
                    type: v.type as "list",
                    values: v.values.split(",").map((x) => x.trim()),
                    operator: v.operator as "between",
                    formula1: v.minimum,
                    formula2: v.maximum,
                    prompt: v.prompt,
                    error: v.error,
                    allowBlank: v.blank === "true",
                    errorStyle: "stop",
                  });
              });
            },
          });
          break;
        case "conditional":
          show({
            title: "Conditional Formatting",
            description:
              "Rules are applied in priority order. Existing rules for the exact range are replaced.",
            fields: [
              textField("range", "Apply to", rangeLabel(selection)),
              selectField("type", "Rule", [
                "cellIs",
                "containsText",
                "duplicateValues",
                "colorScale",
                "Remove rules",
              ]),
              selectField("operator", "Condition", [
                "greater",
                "less",
                "equal",
                "notEqual",
                "between",
              ]),
              textField("value", "Value", "0"),
              textField("value2", "Second value", "100"),
              {
                name: "fill",
                label: "Fill color",
                type: "color",
                value: "#d9efdf",
              },
              {
                name: "stop",
                label: "Stop if true",
                type: "checkbox",
                value: "false",
              },
            ],
            onSubmit: (v) => {
              const range = parseRange(v.range);
              transaction("Conditional formatting", (_, s) => {
                s.conditionalFormats = s.conditionalFormats.filter(
                  (r) => rangeLabel(r.range) !== rangeLabel(range),
                );
                if (v.type !== "Remove rules")
                  s.conditionalFormats.push({
                    id: newId("cf"),
                    range,
                    type: v.type as "cellIs",
                    operator: v.operator as "greater",
                    value:
                      v.type === "containsText" ? v.value : Number(v.value),
                    value2: Number(v.value2),
                    style: { fill: v.fill },
                    colors: ["#f9d2cc", "#ffffff", v.fill],
                    priority: s.conditionalFormats.length + 1,
                    stopIfTrue: v.stop === "true",
                  });
              });
            },
          });
          break;
        case "pivot": {
          const range = dataRange(),
            data = getData(range);
          show({
            title: "Create PivotTable",
            description:
              "Choose field names from the source. Separate multiple fields with commas. The pivot opens on its own worksheet and can be refreshed from Data.",
            fields: [
              textField(
                "name",
                "PivotTable name",
                "PivotTable " + (sheet.pivots.length + 1),
              ),
              textField("rows", "Row fields", data.columns[0] ?? ""),
              textField("columns", "Column fields", ""),
              textField("values", "Value fields", data.columns.at(-1) ?? ""),
              selectField("aggregate", "Summarize values by", [
                "sum",
                "count",
                "average",
                "min",
                "max",
              ]),
              selectField("show", "Show values as", [
                "value",
                "percentGrandTotal",
                "percentRowTotal",
                "percentColumnTotal",
              ]),
            ],
            content: <p>Available fields: {data.columns.join(", ")}</p>,
            onSubmit: (v) => {
              const rows = v.rows
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                columns = v.columns
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                values = v.values
                  .split(",")
                  .map((s) => ({
                    field: s.trim(),
                    aggregate: v.aggregate as "sum",
                  })),
                spec = {
                  rows,
                  columns,
                  values,
                  showValuesAs: v.show as "value",
                },
                result = pivotData(data, spec);
              transaction("Created PivotTable", (wb) => {
                const target = createSheet(uniqueSheetName(v.name));
                applyDataToSheet(target, result.data, { row: 0, col: 0 });
                target.pivots.push({
                  id: newId("pivot"),
                  name: v.name,
                  sourceSheetId: sheet.id,
                  source: range,
                  destination: { row: 0, col: 0 },
                  rows,
                  columns,
                  values,
                });
                target.columns[0] = { width: 160 };
                wb.sheets.push(target);
                wb.activeSheetId = target.id;
                wb.metadata = {
                  ...wb.metadata,
                  outputRanges: {
                    ...((wb.metadata?.outputRanges as object) ?? {}),
                    [target.id]: usedRange(target),
                  },
                  pivotSpecs: {
                    ...((wb.metadata?.pivotSpecs as object) ?? {}),
                    [target.pivots[0].id]: spec,
                  },
                };
              });
              setSelection(initialSelection);
              setTab("PivotTable Analyze");
            },
          });
          break;
        }
        case "refresh":
          transaction("Refreshed data", (wb) => {
            for (const dest of wb.sheets) {
              for (const p of dest.pivots) {
                const source = wb.sheets.find((s) => s.id === p.sourceSheetId);
                if (!source)
                  throw new Error("Pivot source worksheet is missing.");
                const spec = (
                  wb.metadata?.pivotSpecs as
                    | Record<string, Parameters<typeof pivotData>[1]>
                    | undefined
                )?.[p.id] ?? {
                  rows: p.rows,
                  columns: p.columns,
                  values: p.values,
                };
                const result = pivotData(sheetData(source, p.source), spec);
                writeRefreshedData(wb, dest, result.data, p.destination);
              }
              const query = (
                wb.metadata?.queries as
                  | Record<
                      string,
                      { sourceId: string; range: Range; steps: QueryStep[] }
                    >
                  | undefined
              )?.[dest.id];
              if (query) {
                const source = wb.sheets.find((s) => s.id === query.sourceId);
                if (!source)
                  throw new Error("Query source worksheet is missing.");
                const result = runQuery(
                  sheetData(source, query.range),
                  query.steps,
                );
                writeRefreshedData(wb, dest, result.data, { row: 0, col: 0 });
              }
            }
          });
          break;
        case "pivot-detail": {
          const p = sheet.pivots[0];
          if (!p) throw new Error("Select a PivotTable first.");
          const source = workbook.sheets.find((s) => s.id === p.sourceSheetId)!;
          const sourceData = sheetData(source, p.source);
          const rowIndex = selection.start.row - p.destination.row - 1;
          if (rowIndex < 0)
            throw new Error("Select a data row in the PivotTable.");
          const clauses = p.rows.map((field, i) => ({
            field,
            operator: "eq" as const,
            value: cellValue(
              sheet.cells[
                cellAddress(selection.start.row, p.destination.col + i)
              ],
            ),
          }));
          dataToNewSheet(filterData(sourceData, clauses), "Pivot details");
          break;
        }
        case "query": {
          const range = dataRange(),
            data = getData(range);
          show({
            title: "Get & Transform",
            description:
              "Create a local query from this worksheet. Applied steps are saved with the workbook and rerun by Refresh All. This implements local transforms; it is not a Power Query M runtime.",
            content: (
              <div className="sheets-data-preview">
                <table>
                  <thead>
                    <tr>
                      {data.columns.slice(0, 8).map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {data.columns.slice(0, 8).map((c) => (
                          <td key={c}>{String(row[c] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <small>
                  {data.rows.length.toLocaleString()} source records
                </small>
              </div>
            ),
            fields: [
              textField("name", "Query name", "Query results"),
              selectField("operation", "Transformation", [
                "Filter",
                "Sort",
                "Remove duplicates",
                "Convert type",
                "Split column",
                "Group",
                "Unpivot",
                "Select columns",
              ]),
              selectField("column", "Column", data.columns),
              textField("value", "Contains / delimiter / column list", ""),
              selectField("type", "Convert to", [
                "text",
                "number",
                "boolean",
                "date",
              ]),
              textField(
                "measure",
                "Group value field",
                data.columns.at(-1) ?? "",
              ),
            ],
            onSubmit: (v) => {
              let step: QueryStep;
              switch (v.operation) {
                case "Sort":
                  step = {
                    kind: "sort",
                    keys: [{ field: v.column, direction: "asc" }],
                  };
                  break;
                case "Remove duplicates":
                  step = { kind: "distinct" };
                  break;
                case "Convert type":
                  step = {
                    kind: "type",
                    column: v.column,
                    dataType: v.type as "text",
                  };
                  break;
                case "Split column":
                  step = {
                    kind: "split",
                    column: v.column,
                    delimiter: v.value || ",",
                  };
                  break;
                case "Group":
                  step = {
                    kind: "group",
                    by: [v.column],
                    values: [{ field: v.measure, aggregate: "sum" }],
                  };
                  break;
                case "Unpivot":
                  step = {
                    kind: "unpivot",
                    columns: (v.value || v.column)
                      .split(",")
                      .map((s) => s.trim()),
                  };
                  break;
                case "Select columns":
                  step = {
                    kind: "select",
                    columns: (v.value || v.column)
                      .split(",")
                      .map((s) => s.trim()),
                  };
                  break;
                default:
                  step = {
                    kind: "filter",
                    filters: [
                      { field: v.column, operator: "contains", value: v.value },
                    ],
                  };
              }
              const prior = (
                workbook.metadata?.queries as
                  | Record<
                      string,
                      { sourceId: string; range: Range; steps: QueryStep[] }
                    >
                  | undefined
              )?.[sheet.id];
              const source = prior
                  ? workbook.sheets.find((s) => s.id === prior.sourceId)!
                  : sheet,
                sourceRange = prior?.range ?? range,
                steps = [...(prior?.steps ?? []), step],
                result = runQuery(sheetData(source, sourceRange), steps);
              transaction("Created query", (wb) => {
                const target = createSheet(uniqueSheetName(v.name));
                applyDataToSheet(target, result.data, { row: 0, col: 0 });
                wb.sheets.push(target);
                wb.activeSheetId = target.id;
                wb.metadata = {
                  ...wb.metadata,
                  outputRanges: {
                    ...((wb.metadata?.outputRanges as object) ?? {}),
                    [target.id]: usedRange(target),
                  },
                  queries: {
                    ...((wb.metadata?.queries as object) ?? {}),
                    [target.id]: {
                      sourceId: source.id,
                      range: sourceRange,
                      steps,
                    },
                  },
                };
              });
              setStatus(
                `${result.data.rows.length} rows loaded · ${steps.length} applied steps · ${result.errors.length} conversion errors`,
              );
              setSelection(initialSelection);
            },
          });
          break;
        }
        case "goal-seek":
          show({
            title: "Goal Seek",
            fields: [
              textField("target", "Set cell", activeAddress),
              numberField("value", "To value", 0),
              textField("variable", "By changing cell", "A1"),
              numberField("min", "Lower bound", -1000000),
              numberField("max", "Upper bound", 1000000),
            ],
            submit: "Find solution",
            onSubmit: async (v) => {
              await numerical("goal", v);
            },
          });
          break;
        case "solver":
          show({
            title: "Solver",
            description:
              "A bounded local search with explicit convergence and constraint checks. It does not prove a global optimum.",
            fields: [
              textField("target", "Objective cell", activeAddress),
              selectField("direction", "Optimize", ["min", "max"]),
              textField("variables", "Changing cells (comma separated)", "A1"),
              numberField("min", "Variable lower bound", 0),
              numberField("max", "Variable upper bound", 1000),
              {
                name: "constraints",
                label: "Constraints (one per line, e.g. D4 <= 100)",
                type: "textarea",
                value: "",
              },
            ],
            submit: "Solve",
            onSubmit: async (v) => {
              await numerical("solver", v);
            },
          });
          break;
        case "chart-column":
          chartDialog("column");
          break;
        case "chart-line":
          chartDialog("line");
          break;
        case "chart-pie":
          chartDialog("pie");
          break;
        case "chart":
          chartDialog();
          break;
        case "chart-edit":
          if (chart) chartDialog(chart.type, chart);
          break;
        case "chart-delete":
          if (chart)
            transaction("Deleted chart", (_, s) => {
              s.charts = s.charts.filter((c) => c.id !== chart.id);
            });
          setSelectedChart(null);
          setTab("Insert");
          break;
        case "names":
          show({
            title: "Name Manager",
            description:
              "Workbook names refer to cells, ranges, or invariant formulas. Use a name in formulas or in the name box.",
            content: (
              <ul>
                {workbook.names.map((n) => (
                  <li key={n.name}>
                    <b>{n.name}</b> = {n.reference}
                  </li>
                ))}
              </ul>
            ),
            fields: [
              textField("name", "Name"),
              textField(
                "reference",
                "Refers to",
                `='${sheet.name.replace(/'/g, "''")}'!${rangeLabel(selection)}`,
              ),
              selectField("operation", "Operation", [
                "Add or update",
                "Delete",
              ]),
            ],
            onSubmit: (v) => {
              if (!/^[A-Za-z_][\w.]*$/.test(v.name) || isCellReference(v.name))
                throw new Error("Use a valid name that is not a cell address.");
              transaction("Defined names", (wb) => {
                wb.names = wb.names.filter(
                  (n) => n.name.toLowerCase() !== v.name.toLowerCase(),
                );
                if (v.operation !== "Delete")
                  wb.names.push({ name: v.name, reference: v.reference });
              });
            },
          });
          break;
        case "calculation":
          show({
            title: "Calculation Options",
            description:
              "Automatic calculation runs in a worker. Manual mode retains cached results until Calculate Now.",
            fields: [
              selectField(
                "mode",
                "Workbook calculation",
                ["automatic", "manual"],
                workbook.calculationMode,
              ),
              selectField(
                "dateSystem",
                "Date system",
                ["1900", "1904"],
                workbook.dateSystem,
              ),
            ],
            onSubmit: (v) =>
              transaction("Calculation settings", (wb) => {
                wb.calculationMode = v.mode as "automatic";
                wb.dateSystem = v.dateSystem as "1900";
              }),
          });
          break;
        case "recalculate":
          recalculate(true);
          break;
        case "show-formulas":
          updatePreference("showFormulas", !formulaView);
          break;
        case "errors": {
          const errors = workbook.sheets.flatMap((s) =>
            Object.entries(s.cells)
              .filter(([, c]) => isError(cellValue(c)))
              .map(
                ([a, c]) =>
                  `${s.name}!${a}: ${formatValue(c)} ${isError(c.cached) ? (c.cached.message ?? "") : ""}`,
              ),
          );
          inform(
            "Error Checking",
            errors.length
              ? errors.join("\n")
              : "No formula errors were found in the current calculated values.",
          );
          break;
        }
        case "find":
        case "replace":
          show({
            title: id === "replace" ? "Find and Replace" : "Find",
            fields: [
              textField("find", "Find what"),
              ...(id === "replace"
                ? [textField("replacement", "Replace with")]
                : []),
              {
                name: "case",
                label: "Match case",
                type: "checkbox",
                value: "false",
              },
              selectField("look", "Look in", ["Values", "Formulas"]),
            ],
            submit: id === "replace" ? "Replace all" : "Find next",
            onSubmit: (v) => {
              if (!v.find) throw new Error("Enter search text.");
              const match = (s: string) =>
                v.case === "true"
                  ? s.includes(v.find)
                  : s.toLowerCase().includes(v.find.toLowerCase());
              const found = Object.entries(sheet.cells)
                .filter(([, c]) =>
                  match(
                    v.look === "Formulas"
                      ? (c.formula ?? String(c.value ?? ""))
                      : formatValue(c),
                  ),
                )
                .sort(([a], [b]) => {
                  const x = parseAddress(a),
                    y = parseAddress(b);
                  return x.row - y.row || x.col - y.col;
                });
              if (!found.length)
                throw new Error("No matching cells were found.");
              if (id === "replace") {
                const escaped = v.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                  rx = new RegExp(escaped, v.case === "true" ? "g" : "gi");
                const edits = found.map(([address, c]) => ({
                  sheetId: sheet.id,
                  address,
                  input: (v.look === "Formulas"
                    ? (c.formula ?? String(c.value ?? ""))
                    : String(cellValue(c) ?? "")
                  ).replace(rx, () => v.replacement),
                }));
                for (const edit of edits)
                  validateInput(edit.address, edit.input);
                engine.current.batch(edits);
                sync(`Replaced ${edits.length} cells`);
              } else {
                const next =
                  found.find(([a]) => {
                    const p = parseAddress(a);
                    return (
                      p.row > selection.start.row ||
                      (p.row === selection.start.row &&
                        p.col > selection.start.col)
                    );
                  }) ?? found[0];
                const p = parseAddress(next[0]);
                move(p.row, p.col);
                setStatus(`${found.length} matching cells`);
              }
            },
          });
          break;
        case "goto":
          show({
            title: "Go To",
            fields: [
              textField("reference", "Reference", activeAddress),
              selectField("special", "Special", [
                "Reference",
                "Formulas",
                "Constants",
                "Errors",
                "Notes",
              ]),
            ],
            onSubmit: (v) => {
              if (v.special === "Reference") {
                navigateTo(v.reference);
                return;
              }
              const matches = Object.entries(sheet.cells)
                .filter(([, c]) =>
                  v.special === "Formulas"
                    ? !!c.formula
                    : v.special === "Constants"
                      ? !c.formula && c.value !== null
                      : v.special === "Errors"
                        ? isError(cellValue(c))
                        : !!c.note,
                )
                .map(([a]) => {
                  const p = parseAddress(a);
                  return { start: p, end: p };
                });
              if (!matches.length) throw new Error("No matching cells.");
              setSelection(matches[0]);
              setExtraSelections(matches.slice(1, 1000));
              grid.current?.reveal(matches[0].start.row, matches[0].start.col);
              setStatus(
                `${matches.length} cells found${matches.length > 1001 ? " (first 1,001 selected)" : ""}`,
              );
            },
          });
          break;
        case "note":
          show({
            title: "Cell Note",
            fields: [
              {
                name: "note",
                label: `Note for ${activeAddress}`,
                type: "textarea",
                value: activeCell?.note ?? "",
              },
            ],
            onSubmit: (v) =>
              transaction("Edited note", (_, s) => {
                s.cells[activeAddress] = {
                  ...(s.cells[activeAddress] ?? { value: null }),
                  note: v.note || undefined,
                };
              }),
          });
          break;
        case "hyperlink":
          show({
            title: "Insert Hyperlink",
            fields: [
              textField(
                "text",
                "Text to display",
                String(activeCell?.value ?? ""),
              ),
              textField("url", "Address", activeCell?.hyperlink ?? "https://"),
            ],
            onSubmit: (v) => {
              const url = new URL(v.url);
              if (!["https:", "http:", "mailto:"].includes(url.protocol))
                throw new Error("Links must use HTTPS, HTTP, or mailto.");
              transaction("Inserted hyperlink", (_, s) => {
                s.cells[activeAddress] = {
                  value: v.text || v.url,
                  hyperlink: v.url,
                  style: { ...activeStyle, color: "#126dba", underline: true },
                };
              });
            },
          });
          break;
        case "open-link":
          if (
            activeCell?.hyperlink &&
            /^(https?:|mailto:)/i.test(activeCell.hyperlink)
          ) {
            if (preferences.confirmExternalLinks && !(await ask("Open external link?", activeCell.hyperlink, "Open link"))) break;
            context.services.openURL(activeCell.hyperlink);
          }
          break;
        case "protect":
          transaction(
            sheet.protected ? "Unprotect sheet" : "Protect sheet",
            (_, s) => {
              s.protected = !s.protected;
            },
          );
          setStatus(
            sheet.protected
              ? "Worksheet protection enabled (editing constraint; no encryption)"
              : "Worksheet unprotected",
          );
          break;
        case "history":
          inform(
            "Change History",
            history.current.join("\n") ||
              "No changes in this session. This is a local session log, not an authenticated collaboration audit.",
          );
          break;
        case "gridlines":
          updateSettings("gridlines", !sheet.showGridlines);
          break;
        case "formula-bar":
          updatePreference("formulaBar", !formulaBar);
          break;
        case "collapse":
          updatePreference("collapsed", !collapsed);
          break;
        case "freeze":
          show({
            title: "Freeze Panes",
            fields: [
              selectField("mode", "Freeze", [
                "At active cell",
                "Top row",
                "First column",
                "Unfreeze panes",
              ]),
            ],
            onSubmit: (v) =>
              transaction("Sheet view", (_, s) => {
                s.freeze =
                  v.mode === "Top row"
                    ? { rows: 1, columns: 0 }
                    : v.mode === "First column"
                      ? { rows: 0, columns: 1 }
                      : v.mode === "Unfreeze panes"
                        ? { rows: 0, columns: 0 }
                        : {
                            rows: Math.min(100, selection.start.row),
                            columns: Math.min(30, selection.start.col),
                          };
              }),
          });
          break;
        case "zoom":
          show({
            title: "Zoom",
            fields: [numberField("zoom", "Zoom (%)", zoom)],
            onSubmit: (v) => {
              if (+v.zoom < 25 || +v.zoom > 200)
                throw new Error("Choose 25–200%.");
              setZoom(+v.zoom);
            },
          });
          break;
        case "zoom-100":
          setZoom(100);
          break;
        case "zoom-selection": {
          const r = normalized(selection);
          setZoom(
            Math.max(
              25,
              Math.min(
                200,
                Math.round((800 / ((r.end.col - r.start.col + 1) * 96)) * 100),
              ),
            ),
          );
          break;
        }
        case "normal":
          setPrintHTML("");
          break;
        case "print":
          setPrintHTML(generatePrintHTML(engine.current.workbook, sheet.id));
          break;
        case "margins":
        case "orientation":
        case "paper":
        case "page-setup":
        case "print-titles":
        case "header-footer":
          pageSetup();
          break;
        case "print-area":
          transaction("Print settings", (_, s) => {
            s.print.area = normalized(selection);
          });
          break;
        case "print-gridlines":
          transaction("Print settings", (_, s) => {
            s.print.gridlines = !s.print.gridlines;
          });
          break;
        case "page-break":
          transaction("Print settings", (_, s) => {
            s.print.rowBreaks = [
              ...new Set([...(s.print.rowBreaks ?? []), selection.start.row]),
            ].filter((n) => n > 0);
          });
          break;
        case "group":
        case "ungroup": {
          const r = normalized(selection);
          if (r.end.row - r.start.row > 100000)
            throw new Error("Select fewer than 100,000 rows.");
          transaction(
            id === "group" ? "Grouped rows" : "Ungrouped rows",
            (_, s) => {
              for (let row = r.start.row; row <= r.end.row; row++)
                s.rows[row] = {
                  ...s.rows[row],
                  outlineLevel: id === "group" ? 1 : 0,
                  hidden: id === "group",
                };
            },
          );
          break;
        }
        case "subtotal": {
          const r = dataRange();
          const edits = [];
          for (let c = r.start.col; c <= r.end.col; c++)
            edits.push({
              sheetId: sheet.id,
              address: cellAddress(r.end.row + 1, c),
              input:
                c === r.start.col
                  ? "Subtotal"
                  : `=SUBTOTAL(9,${cellAddress(r.start.row + 1, c)}:${cellAddress(r.end.row, c)})`,
            });
          engine.current.batch(edits);
          sync("Inserted subtotals");
          break;
        }
        case "add-sheet":
          engine.current.transact("Add worksheet", wb => { const added = createSheet(uniqueSheetName("Sheet" + (wb.sheets.length + 1))); added.showGridlines = preferences.gridlines; wb.sheets.push(added); wb.activeSheetId = added.id; });
          sync("Added worksheet");
          setSelection(initialSelection);
          break;
        case "sheet-settings":
          sheetSettings();
          break;
        case "hide-sheet":
          transaction("Hide sheet", (wb) => {
            if (wb.sheets.filter((s) => s.visibility === "visible").length < 2)
              throw new Error("Keep at least one visible sheet.");
            sheet.visibility = "hidden";
            wb.activeSheetId = wb.sheets.find(
              (s) => s.visibility === "visible",
            )!.id;
          });
          setSelection(initialSelection);
          break;
        case "unhide-sheet": {
          const hidden = workbook.sheets.filter(
            (s) => s.visibility === "hidden",
          );
          if (!hidden.length) {
            inform("Unhide", "There are no hidden sheets.");
            break;
          }
          show({
            title: "Unhide Worksheet",
            fields: [
              selectField(
                "sheet",
                "Sheet",
                hidden.map((s) => s.name),
              ),
            ],
            onSubmit: (v) =>
              transaction("Unhide sheet", (wb) => {
                wb.sheets.find((s) => s.name === v.sheet)!.visibility =
                  "visible";
              }),
          });
          break;
        }
        case "recovery": {
          const records = await listRecoveries();
          show({
            title: "Recover Workbook",
            fields: [
              {
                name: "key",
                label: "Recovery copy",
                type: "select",
                options: records.map((r) => ({
                  value: r.key,
                  label: `${r.name} — ${new Date(r.savedAt).toLocaleString()}`,
                })),
                value: records[0]?.key,
              },
            ],
            onSubmit: async (v) => {
              const recovered = await loadRecovery(v.key);
              if (recovered) install(recovered, "", undefined, true);
            },
          });
          break;
        }
        case "command-search": {
          const query = value?.toLowerCase().trim() ?? "";
          const commands = context.services.commands
            .list()
            .filter(
              (c) =>
                c.id.startsWith("sheets.") &&
                c.label.toLowerCase().includes(query),
            );
          if (!commands.length) {
            inform(
              "Search commands",
              "No matching command. Use the ribbon tabs to browse available commands.",
            );
            break;
          }
          show({
            title: "Search Commands",
            fields: [
              {
                name: "command",
                label: "Command",
                type: "select",
                value: commands[0].id,
                options: commands.map((c) => ({ value: c.id, label: c.label })),
              },
            ],
            onSubmit: (v) => {
              setTimeout(() => action(v.command.slice(7)), 0);
            },
          });
          break;
        }
        case "help":
          inform(
            "Using Sheets",
            "Enter a value or formula in a cell or the formula bar. F2 edits the active cell. Shift + arrows extends selection; Ctrl/⌘ + click adds a range. Ctrl/⌘ + C/X/V copies, cuts, and pastes. Drag the fill handle to copy formulas or extend a numeric series. Ctrl/⌘ + S saves through the LopeOS filesystem. Use the name box to jump anywhere through XFD1048576. Browser-reserved shortcuts depend on your browser. Save .lopebook for the most complete local round trip.",
          );
          break;
        case "compatibility":
          inform(
            "Spreadsheet Compatibility",
            "Sheets implements editable sparse workbooks, a virtual grid, local calculation, XLSX interchange, formatting, tables, sorting/filtering, local query transforms, pivots, charts, Goal Seek, constrained local Solver, notes, and print preview.\n\nThis is not full Excel compatibility. Unresolved capabilities include VBA/XLM/Office Scripts/Python execution, authenticated coauthoring, Power Query M/DAX/Data Model, external link refresh, full structured-reference grammar, iterative calculation, full higher-order LAMBDA/closure semantics, split panes, pictures, slicers/timelines, advanced chart types, perfect number-format rendering, and complete drawing/pivot OOXML round trips.\n\nUnsupported formulas produce explicit errors. Imported cached values are not proof of recalculation compatibility. XLSX conversion warnings precede known losses. Native .lopebook retains the original imported package. Formula/library coverage and verified cases are recorded in docs/spreadsheet.",
          );
          break;
        default:
          inform(
            "Capability unavailable",
            `The ${id} operation is not implemented in this release. See Help → Feature Support for the compatibility inventory.`,
          );
      }
    });
  }
  async function numerical(
    kind: "goal" | "solver",
    values: Record<string, string>,
  ) {
    const snapshot = structuredClone(engine.current.workbook),
      revision = snapshot.revision;
    if (
      !sheet.cells[
        cellAddress(
          parseAddress(values.target).row,
          parseAddress(values.target).col,
        )
      ]?.formula
    )
      throw new Error("The objective cell must contain a formula.");
    setBusy(true);
    setStatus(kind === "goal" ? "Finding target…" : "Solving…");
    const numericalWorker = new Worker(
      new URL("./numerical.worker.ts", import.meta.url),
      { type: "module" },
    );
    const controller = new AbortController();
    activeAbort.current = controller;
    try {
      const result = await new Promise<{
        success: boolean;
        message: string;
        addresses: string[];
        variables: number[];
        objective: number;
        maxViolation?: number;
      }>((resolve, reject) => {
        numericalWorker.onmessage = (e) =>
          e.data.error
            ? reject(new Error(e.data.error))
            : resolve(e.data.result);
        numericalWorker.onerror = (e) => reject(new Error(e.message));
        controller.signal.addEventListener(
          "abort",
          () => {
            numericalWorker.terminate();
            reject(new Error("Operation cancelled; no solution was applied."));
          },
          { once: true },
        );
        numericalWorker.postMessage({
          kind,
          workbook: snapshot,
          sheetId: sheet.id,
          values,
        });
      });
      if (!result.success) throw new Error(result.message);
      if (
        engine.current.workbook.revision !== revision ||
        engine.current.workbook.id !== snapshot.id
      )
        throw new Error(
          "The workbook changed while solving. No solution was applied.",
        );
      engine.current.batch(
        result.addresses.map((address, i) => ({
          sheetId: sheet.id,
          address,
          input: result.variables[i],
        })),
        "Apply numerical solution",
      );
      sync(result.message);
      setStatus(
        `${result.message} Result: ${result.objective.toPrecision(10)}`,
      );
    } finally {
      numericalWorker.terminate();
      activeAbort.current = null;
      setBusy(false);
    }
  }
  function sheetSettings() {
    show({
      title: "Worksheet Settings",
      fields: [
        textField("name", "Sheet name", sheet.name),
        {
          name: "color",
          label: "Tab color",
          type: "color",
          value: sheet.tabColor ?? "#278562",
        },
        selectField("operation", "Action", [
          "Rename / set color",
          "Move left",
          "Move right",
          "Duplicate",
          "Delete",
        ]),
      ],
      submit: "Apply",
      onSubmit: (v) => {
        if (v.operation === "Delete") {
          setTimeout(
            () =>
              safely(async () => {
                if (
                  await ask(
                    "Delete worksheet?",
                    `Delete ${sheet.name} and all its cells? This can be undone in this session.`,
                    "Delete",
                  )
                ) {
                  engine.current.deleteSheet(sheet.id);
                  sync("Deleted worksheet");
                  setSelection(initialSelection);
                }
              }),
            0,
          );
          return;
        }
        if (v.operation === "Rename / set color") {
          engine.current.renameSheet(sheet.id, v.name);
          transaction("Worksheet settings", (_, s) => {
            s.tabColor = v.color;
          });
        } else if (v.operation === "Duplicate") {
          transaction("Duplicated worksheet", (wb) => {
            const clone = structuredClone(sheet);
            clone.id = newId("sheet");
            clone.name = uniqueSheetName(sheet.name + " copy");
            clone.tables.forEach((t) => {
              t.id = newId("table");
              t.name = t.name + "_copy" + wb.sheets.length;
            });
            wb.sheets.splice(
              wb.sheets.findIndex((s) => s.id === sheet.id) + 1,
              0,
              clone,
            );
            wb.activeSheetId = clone.id;
          });
        } else
          transaction("Moved worksheet", (wb) => {
            const i = wb.sheets.findIndex((s) => s.id === sheet.id),
              j = Math.max(
                0,
                Math.min(
                  wb.sheets.length - 1,
                  i + (v.operation === "Move left" ? -1 : 1),
                ),
              );
            [wb.sheets[i], wb.sheets[j]] = [wb.sheets[j], wb.sheets[i]];
          });
      },
    });
  }
  function navigateTo(reference: string) {
    let text = reference.trim(),
      targetSheet = sheet;
    const name = workbook.names.find(
      (n) => n.name.toLowerCase() === text.toLowerCase(),
    );
    if (name) text = name.reference.replace(/^=/, "");
    const split = text.lastIndexOf("!");
    if (split >= 0) {
      const name = text
        .slice(0, split)
        .replace(/^'|'$/g, "")
        .replace(/''/g, "'");
      targetSheet = workbook.sheets.find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      )!;
      if (!targetSheet) throw new Error("No worksheet with that name.");
      text = text.slice(split + 1);
    }
    const range = parseRange(text);
    if (targetSheet.id !== sheet.id) {
      engine.current.workbook.activeSheetId = targetSheet.id;
      setWorkbook({ ...engine.current.workbook });
    }
    select(range);
    requestAnimationFrame(() => {
      grid.current?.reveal(range.start.row, range.start.col);
      grid.current?.focus();
    });
  }
  const viewSheet = useMemo(() => ({ ...sheet }), [workbook, sheet]);
  const filteredRows = useMemo(
    () =>
      new Set(
        Object.entries(sheet.rows)
          .filter(([, row]) => row.filtered)
          .map(([row]) => Number(row)),
      ),
    [workbook, sheet.id],
  );
  const cellPresentation = useMemo(() => {
    const spills = new Map(
      engine.current
        .spillEntries(sheet.id)
        .map((item) => [item.address, item.value]),
    );
    const rules = [...sheet.conditionalFormats]
      .sort((a, b) => a.priority - b.priority)
      .map((rule) => {
        const counts = new Map<string, number>();
        let minimum = Infinity,
          maximum = -Infinity;
        if (rule.type === "duplicateValues" || rule.type === "colorScale")
          for (const [a, cell] of Object.entries(sheet.cells)) {
            const p = parseAddress(a);
            if (!includes(rule.range, p.row, p.col)) continue;
            const value = cellValue(cell);
            if (rule.type === "duplicateValues") {
              const k = JSON.stringify(value);
              counts.set(k, (counts.get(k) ?? 0) + 1);
            }
            if (typeof value === "number") {
              minimum = Math.min(minimum, value);
              maximum = Math.max(maximum, value);
            }
          }
        return { rule, counts, minimum, maximum };
      });
    return (a: string): Cell | undefined => {
      const point = parseAddress(a);
      let cell =
        sheet.cells[a] ??
        (spills.has(a) ? { value: spills.get(a)! } : undefined);
      const table = sheet.tables.find((t) =>
        includes(t.range, point.row, point.col),
      );
      if (table) {
        const heading = point.row === table.range.start.row;
        cell = {
          ...(cell ?? { value: null }),
          style: {
            ...cell?.style,
            ...(heading
              ? { fill: "#267451", color: "#ffffff", bold: true }
              : table.bandedRows &&
                  (point.row - table.range.start.row) % 2 === 0
                ? { fill: "#edf5f0" }
                : {}),
          },
        };
      }
      for (const { rule, counts, minimum, maximum } of rules) {
        if (!includes(rule.range, point.row, point.col)) continue;
        const v = cellValue(cell);
        let matches = false,
          style = rule.style ?? {};
        if (rule.type === "containsText")
          matches = String(v ?? "")
            .toLowerCase()
            .includes(String(rule.value ?? "").toLowerCase());
        else if (rule.type === "duplicateValues")
          matches = (counts.get(JSON.stringify(v)) ?? 0) > 1;
        else if (rule.type === "cellIs") {
          const n = Number(v),
            value = Number(rule.value),
            op = rule.operator;
          matches =
            op === "greater"
              ? n > value
              : op === "less"
                ? n < value
                : op === "greaterOrEqual"
                  ? n >= value
                  : op === "lessOrEqual"
                    ? n <= value
                    : op === "notBetween"
                      ? n < value || n > Number(rule.value2)
                      : op === "notEqual"
                        ? n !== value
                        : op === "between"
                          ? n >= value && n <= Number(rule.value2)
                          : n === value;
        } else if (rule.type === "colorScale" && typeof v === "number") {
          const t =
              maximum === minimum ? 0.5 : (v - minimum) / (maximum - minimum),
            rgb = (hex: string) =>
              [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
            palette = rule.colors ?? ["#f9d2cc", "#ffffff", "#b9dfc7"],
            lo = rgb(palette[t < 0.5 ? 0 : 1] ?? "#ffffff"),
            hi = rgb(palette[t < 0.5 ? 1 : 2] ?? "#b9dfc7"),
            weight = t < 0.5 ? t * 2 : (t - 0.5) * 2;
          style = {
            fill:
              "#" +
              lo
                .map((n, i) =>
                  Math.round(n + (hi[i] - n) * weight)
                    .toString(16)
                    .padStart(2, "0"),
                )
                .join(""),
          };
          matches = true;
        }
        if (matches) {
          cell = {
            ...(cell ?? { value: null }),
            style: { ...cell?.style, ...style },
          };
          if (rule.stopIfTrue) break;
        }
      }
      return cell;
    };
  }, [workbook, sheet.id]);
  const aggregates = useMemo(() => {
    let sum = 0,
      count = 0,
      numeric = 0;
    const ranges = [selection, ...extraSelections].map(normalized),
      size = ranges.reduce(
        (total, r) =>
          total + (r.end.row - r.start.row + 1) * (r.end.col - r.start.col + 1),
        0,
      ),
      addresses = new Set<string>();
    if (size <= 10000) {
      for (const r of ranges)
        for (let row = r.start.row; row <= r.end.row; row++)
          for (let col = r.start.col; col <= r.end.col; col++)
            addresses.add(cellAddress(row, col));
    } else
      for (const address of Object.keys(sheet.cells)) {
        const point = parseAddress(address);
        if (ranges.some((r) => includes(r, point.row, point.col)))
          addresses.add(address);
      }
    for (const address of addresses) {
      const value = cellValue(cellPresentation(address));
      if (value !== null && value !== "") count++;
      if (typeof value === "number") {
        sum += value;
        numeric++;
      }
    }
    return { sum, count, average: numeric ? sum / numeric : 0, numeric };
  }, [workbook, selection, extraSelections]);
  const commands = [
    "preferences",
    "new",
    "open",
    "save",
    "save-as",
    "export",
    "print",
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "find",
    "replace",
    "goto",
    "format",
    "bold",
    "italic",
    "underline",
    "validation",
    "conditional",
    "sort",
    "filter",
    "table",
    "pivot",
    "query",
    "goal-seek",
    "gridlines",
    "freeze",
    "collapse",
    "compatibility",
  ].map((id) => ({
    id: `sheets.${id}` as const,
    label:
      (
        {
          "save-as": "Save As…",
          goto: "Go To…",
          "goal-seek": "Goal Seek…",
          compatibility: "Feature Support",
          preferences: "Preferences…",
        } as Record<string, string>
      )[id] ?? id.charAt(0).toUpperCase() + id.slice(1),
    shortcut: (
      {
        save: "Mod+S",
        preferences: "Mod+,",
        "save-as": "Mod+Shift+S",
        open: "Mod+O",
        undo: "Mod+Z",
        redo: "Mod+Shift+Z",
        find: "Mod+F",
        replace: "Mod+H",
        goto: "Mod+G",
        bold: "Mod+B",
        italic: "Mod+I",
        underline: "Mod+U",
      } as Record<string, string>
    )[id],
    enabled:
      !busy &&
      (id === "undo"
        ? engine.current.canUndo
        : id === "redo"
          ? engine.current.canRedo
          : true),
    execute: () => action(id),
  }));
  useAppCommands(context, commands);
  return (
    <div
      className={`sheets-app ${preferences.largerControls ? "sheets-large-controls" : ""} ${preferences.reduceMotion || systemAppearance.reduceMotion ? "sheets-reduce-motion" : ""}`}
      data-sheets-theme={theme}
      data-appearance={preferences.appearance}
      data-glass-tone={preferences.appearance === "system" ? undefined : theme}
      data-pride={preferences.pride}
      data-testid="spreadsheet-app"
      onKeyDownCapture={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); e.stopPropagation(); action("preferences"); }
      }}
      onPaste={(e) => {
        if (editing || (e.target as HTMLElement).matches("input,textarea"))
          return;
        e.preventDefault();
        safely(() => paste(e.clipboardData.getData("text/plain")));
      }}
    >
      <Ribbon
        preferences={preferences}
        tab={tab}
        onTab={setTab}
        collapsed={collapsed}
        onAction={action}
        style={activeStyle}
        workbook={workbook}
        sheet={sheet}
        tableContext={!!tableContext}
        chartContext={!!chart}
        pivotContext={pivotContext}
        canUndo={engine.current.canUndo}
        canRedo={engine.current.canRedo}
        busy={busy}
        saveState={
          busy
            ? "Working…"
            : dirty
              ? recoveryRevision === workbook.revision
                ? "Recovery saved locally"
                : "Unsaved changes"
              : path
                ? "Saved to workspace"
                : "Local workbook"
        }
      />
      {recovered && (
        <div className="sheets-banner">
          Recovered your workbook from local storage.
          <button onClick={() => action("save-as")}>Save a copy</button>
          <button
            aria-label="Dismiss recovery notice"
            onClick={() => setRecovered(false)}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {error && (
        <div className="sheets-error-banner" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {formulaBar && (
        <div
          className={`sheets-formula-bar ${formulaExpanded ? "expanded" : ""}`}
        >
          <input
            className="sheets-name-box"
            aria-label="Name box"
            key={`${sheet.id}-${rangeLabel(selection)}`}
            defaultValue={rangeLabel(selection)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                safely(() => navigateTo(e.currentTarget.value));
              }
            }}
          />
          <div className="sheets-formula-controls">
            <button
              aria-label="Cancel edit"
              disabled={!editing}
              onClick={cancelEdit}
            >
              <X size={16} />
            </button>
            <button
              aria-label="Enter formula"
              disabled={!editing}
              onClick={() => commit(0, 0)}
            >
              <Check size={16} />
            </button>
            <button
              aria-label="Insert function"
              onClick={() => action("function")}
            >
              <i>ƒx</i>
            </button>
          </div>
          <div className="sheets-formula-input">
            <textarea
              ref={formulaInput}
              aria-label="Formula bar"
              value={
                editing
                  ? draft
                  : (activeCell?.formula ??
                    (isError(activeCell?.value)
                      ? activeCell.value.code
                      : String(
                          cellValue(cellPresentation(activeAddress)) ?? "",
                        )))
              }
              onFocus={() => {
                if (!editing) startEdit();
              }}
              onChange={(e) => {
                if (!editing) setEditing(true);
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter" && !e.altKey) {
                  e.preventDefault();
                  commit(e.shiftKey ? -1 : 1, 0);
                } else if (e.key === "Escape") cancelEdit();
              }}
            />
            {editing && (
              <FormulaAssist
                preferences={preferences}
                draft={draft}
                onChoose={setDraft}
                inputRef={formulaInput}
              />
            )}
          </div>
          <button
            aria-label={
              formulaExpanded ? "Collapse formula bar" : "Expand formula bar"
            }
            onClick={() => setFormulaExpanded((v) => !v)}
          >
            <ChevronDown size={15} />
          </button>
        </div>
      )}
      <div
        className="sheets-workspace"
        onPointerDown={() => setContextMenu(null)}
      >
        {printHTML ? (
          <div className="sheets-print-preview">
            <div>
              <strong>Print Preview — {sheet.name}</strong>
              <button onClick={() => frame.current?.contentWindow?.print()}>
                Print / Save PDF
              </button>
              <button onClick={() => setPrintHTML("")}>Close preview</button>
            </div>
            <iframe
              ref={frame}
              title="Workbook print preview"
              srcDoc={printHTML}
            />
          </div>
        ) : (
          <>
            <Grid
              preferences={preferences}
              defaultCellStyle={workbookCellStyle(workbook)}
              ref={grid}
              sheet={viewSheet}
              references={editing ? referenceRanges(draft, sheet.name) : []}
              onViewport={(x, y) => setViewportOffset({ x, y })}
              selection={selection}
              extraSelections={extraSelections}
              onSelect={select}
              zoom={zoom}
              formulaView={formulaView}
              dateSystem={workbook.dateSystem}
              draft={draft}
              editing={editing}
              onDraft={setDraft}
              onEdit={startEdit}
              onCommit={commit}
              onCancel={cancelEdit}
              onKey={onKey}
              onFill={(target) =>
                safely(() => {
                  fillCells(
                    normalized(selection),
                    normalized(target),
                  );
                  sync("Filled cells");
                  setSelection(target);
                })
              }
              onContext={(x, y) => setContextMenu({ x, y })}
              onResize={(axis, index, size) =>
                safely(() =>
                  transaction("Resize cells", (_, s) => {
                    if (axis === "row")
                      s.rows[index] = { ...s.rows[index], height: size };
                    else
                      s.columns[index] = { ...s.columns[index], width: size };
                  }),
                )
              }
              filteredRows={filteredRows}
              cellDisplay={cellPresentation}
            />
            {preferences.objects !== "none" && <div className="sheets-drawings" style={{left:preferences.headings ? 44 : 0, top:preferences.headings ? 24 : 0}}>
              <div
                className="sheets-drawing-layer"
                style={{
                  transform: `translate(${-viewportOffset.x}px,${-viewportOffset.y}px) scale(${zoom / 100})`,
                  transformOrigin: "top left",
                }}
              >
                {sheet.charts.map((c) => preferences.objects === "placeholders" ? <button key={c.id} className="sheets-chart-placeholder" style={{position:"absolute",left:c.x,top:c.y,width:c.width,height:c.height}} onClick={() => chartDialog(c.type,c)} aria-label={`Edit chart ${c.title}`}>{c.title || "Chart"}<small>Chart placeholder</small></button> : (
                  <ChartView
                    preferences={preferences}
                    key={c.id}
                    chart={c}
                    sheet={sheet}
                    scale={zoom / 100}
                    dateSystem={workbook.dateSystem}
                    selected={selectedChart === c.id}
                    onSelect={() => {
                      setSelectedChart(c.id);
                      setTab("Chart Design");
                    }}
                    onEdit={() => chartDialog(c.type, c)}
                    onMove={(x, y) =>
                      safely(() =>
                        transaction("Moved chart", (_, s) => {
                          const chart = s.charts.find(
                            (item) => item.id === c.id,
                          )!;
                          chart.x = x;
                          chart.y = y;
                        }),
                      )
                    }
                  />
                ))}
              </div>
            </div>}
          </>
        )}
      </div>
      {preferences.sheetTabs && <div className="sheets-sheet-strip">
        <div className="sheets-sheet-nav">
          <button
            aria-label="Previous sheet"
            onClick={() => {
              const visible = workbook.sheets.filter(
                  (s) => s.visibility === "visible",
                ),
                i = visible.findIndex((s) => s.id === sheet.id);
              if (i > 0) {
                engine.current.workbook.activeSheetId = visible[i - 1].id;
                setWorkbook({ ...engine.current.workbook });
                setSelection(initialSelection);
              }
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            aria-label="Next sheet"
            onClick={() => {
              const visible = workbook.sheets.filter(
                  (s) => s.visibility === "visible",
                ),
                i = visible.findIndex((s) => s.id === sheet.id);
              if (i < visible.length - 1) {
                engine.current.workbook.activeSheetId = visible[i + 1].id;
                setWorkbook({ ...engine.current.workbook });
                setSelection(initialSelection);
              }
            }}
          >
            <ChevronRight size={14} />
          </button>
          <button
            aria-label="Worksheet settings"
            onClick={() => action("sheet-settings")}
          >
            •••
          </button>
        </div>
        <div
          className="sheets-sheet-tabs"
          role="tablist"
          aria-label="Worksheets"
        >
          {workbook.sheets
            .filter((s) => s.visibility === "visible")
            .map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={sheet.id === s.id}
                style={
                  s.tabColor ? { borderBottomColor: s.tabColor } : undefined
                }
                onClick={() => {
                  if (editing && !commit(0, 0)) return;
                  engine.current.workbook.activeSheetId = s.id;
                  setWorkbook({ ...engine.current.workbook });
                  setSelection(initialSelection);
                  setSelectedChart(null);
                  grid.current?.reveal(0, 0);
                }}
                onDoubleClick={() => action("sheet-settings")}
                onContextMenu={(e) => {
                  e.preventDefault();
                  engine.current.workbook.activeSheetId = s.id;
                  setWorkbook({ ...engine.current.workbook });
                  setTimeout(() => action("sheet-settings"), 0);
                }}
              >
                {s.name}
              </button>
            ))}
        </div>
        <button aria-label="Add worksheet" onClick={() => action("add-sheet")}>
          <Plus size={16} />
        </button>
      </div>}
      {preferences.statusBar && <footer className="sheets-statusbar">
        <span className="sheets-status" role="status" aria-live={preferences.announceCellChanges ? "polite" : "off"}>
          {calcBusy ? "Calculating…" : editing ? "Edit" : status}
          {sheet.protected ? " · Protected" : ""}
          {filter?.sheetId === sheet.id
            ? ` · ${filteredRows.size} rows filtered`
            : ""}
        </span>
        {preferences.accessibilityStatus && <button onClick={() => inform("Workbook accessibility", sheet.charts.some(c => !c.title.trim() || c.title === "Chart Title") ? "Give each chart a descriptive title using Chart Design → Edit Chart. Worksheet cells can be navigated with the arrow keys, Tab, and the Name box." : "Charts have titles. Navigate cells with arrow keys, Tab, and the Name box. This check does not assess color contrast or reading order.")}>Accessibility: {sheet.charts.some(c => !c.title.trim() || c.title === "Chart Title") ? "Review chart titles" : "Review workbook"}</button>}
        {(!!activeAbort.current || calcBusy) && (
          <button
            onClick={() => {
              activeAbort.current?.abort();
              if (calcBusy) {
                worker.current?.terminate();
                worker.current = null;
                calcId.current++;
                setCalcBusy(false);
                setStatus("Calculation cancelled; cached values may be stale");
              }
            }}
          >
            Cancel
          </button>
        )}
        <span className="sheets-aggregates">
          {aggregates.count > 1 && (
            <>
              Average:{" "}
              {aggregates.average.toLocaleString(preferences.locale, {
                maximumFractionDigits: 4,
              })}{" "}
              <span>Count: {aggregates.count}</span> Sum:{" "}
              {aggregates.sum.toLocaleString(preferences.locale, {
                maximumFractionDigits: 4,
              })}
            </>
          )}
        </span>
        <div className="sheets-view-buttons">
          <button
            title="Normal view"
            aria-label="Normal view"
            onClick={() => setPrintHTML("")}
          >
            <Grid2X2 size={14} />
          </button>
          <button
            title="Print preview"
            aria-label="Print preview"
            onClick={() => action("print")}
          >
            <BookOpen size={14} />
          </button>
        </div>
        <div className="sheets-zoom">
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(25, z - 10))}
          >
            <Minus size={12} />
          </button>
          <input
            aria-label="Worksheet zoom"
            type="range"
            min="25"
            max="200"
            step="5"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
          >
            <Plus size={12} />
          </button>
          <button onClick={() => action("zoom")}>{zoom}%</button>
        </div>
      </footer>}
      {galleryOpen && <SheetGallery onBlank={() => {setGalleryOpen(false);action("new");}} onBudget={() => {setGalleryOpen(false);action("budget");}} onOpen={() => {setGalleryOpen(false);action("open");}} onClose={() => setGalleryOpen(false)} />}
      {preferencesOpen && <PreferencesWindow preferences={preferences} update={updateSettings} context={context} workbook={workbook} onWorkbookChange={(patch) => safely(() => transaction("Calculation settings", wb => {Object.assign(wb,patch);}))} onAction={action} onClose={() => setPreferencesOpen(false)} />}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".xlsx,.lopebook,.csv,.tsv,.txt"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) safely(() => importLocal(file));
        }}
      />
      {contextMenu && (
        <div
          ref={menuRef}
          className="sheets-context-menu glass"
          role="menu"
          style={{
            position: "fixed",
            left: Math.min(contextMenu.x, window.innerWidth - 220),
            top: Math.min(contextMenu.y, window.innerHeight - 340),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            const buttons = [...e.currentTarget.querySelectorAll("button")];
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              buttons[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : (current +
                        (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                      buttons.length
              ]?.focus();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setContextMenu(null);
              grid.current?.focus();
            }
          }}
        >
          {[
            ["cut", "Cut"],
            ["copy", "Copy"],
            ["paste", "Paste"],
            ["insert-cells", "Insert…"],
            ["delete-cells", "Delete…"],
            ["clear", "Clear Contents"],
            ["format", "Format Cells…"],
            ["note", "Insert Note"],
            ...(activeCell?.hyperlink ? [["open-link", "Open Hyperlink"]] : []),
            ["sheet-settings", "Worksheet Settings…"],
          ].map(([id, label]) => (
            <button
              role="menuitem"
              key={id}
              onClick={() => {
                setContextMenu(null);
                action(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {dialog && (
        <SheetDialog key={dialog.id} spec={dialog} onClose={closeDialog} />
      )}
    </div>
  );
}
