import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  cellAddress,
  cellValue,
  formatValue,
  isError,
  parseAddress,
  type Worksheet,
  type Range,
  type Cell,
  type CellStyle,
} from "../../../../../packages/spreadsheet-engine/src/model";
import { formulaReferences } from "../../../../../packages/spreadsheet-engine/src/references";
import { REFERENCE_COLORS } from "./FormulaAssist";
import type { SheetPreferences } from "./preferences";

export const ROWS = 1048576,
  COLS = 16384;
export const normalized = (r: Range): Range => ({
  start: {
    row: Math.min(r.start.row, r.end.row),
    col: Math.min(r.start.col, r.end.col),
  },
  end: {
    row: Math.max(r.start.row, r.end.row),
    col: Math.max(r.start.col, r.end.col),
  },
});
export const includes = (r: Range, row: number, col: number) => {
  const n = normalized(r);
  return (
    row >= n.start.row &&
    row <= n.end.row &&
    col >= n.start.col &&
    col <= n.end.col
  );
};
export const rangeLabel = (r: Range) => {
  const n = normalized(r);
  return (
    cellAddress(n.start.row, n.start.col) +
    (n.start.row === n.end.row && n.start.col === n.end.col
      ? ""
      : ":" + cellAddress(n.end.row, n.end.col))
  );
};
export type GridHandle = {
  focus(): void;
  reveal(row: number, col: number): void;
};
type Props = {
  sheet: Worksheet;
  selection: Range;
  extraSelections: Range[];
  onSelect(r: Range, add?: boolean): void;
  zoom: number;
  formulaView: boolean;
  dateSystem: "1900" | "1904";
  draft: string;
  editing: boolean;
  onDraft(s: string): void;
  onEdit(s?: string): void;
  onCommit(dr?: number, dc?: number): boolean;
  onCancel(): void;
  onKey(e: KeyboardEvent): void;
  onFill(to: Range): void;
  onContext(x: number, y: number): void;
  onResize(axis: "row" | "column", index: number, size: number): void;
  onViewport?(x: number, y: number): void;
  references?: Range[];
  filteredRows: Set<number>;
  cellDisplay?(address: string): Cell | undefined;
  preferences?: SheetPreferences;
  defaultCellStyle?: CellStyle;
};
function geometry(
  count: number,
  base: number,
  properties: Record<
    number,
    { height?: number; width?: number; hidden?: boolean }
  >,
  zoom: number,
  filtered?: Set<number>,
) {
  const changes = new Map<number, number>();
  for (const [key, p] of Object.entries(properties))
    changes.set(+key, p.hidden ? 0 : (p.height ?? p.width ?? base) * zoom);
  filtered?.forEach((i) => changes.set(i, 0));
  const indices = [...changes.keys()]
      .filter((i) => i >= 0 && i < count)
      .sort((a, b) => a - b),
    deltas: number[] = [];
  let sum = 0;
  indices.forEach((i) => {
    sum += changes.get(i)! - base * zoom;
    deltas.push(sum);
  });
  const offset = (i: number) => {
    let l = 0,
      h = indices.length;
    while (l < h) {
      const m = (l + h) >> 1;
      if (indices[m] < i) l = m + 1;
      else h = m;
    }
    return i * base * zoom + (l ? deltas[l - 1] : 0);
  };
  const at = (pos: number) => {
    let l = 0,
      h = count - 1;
    while (l < h) {
      const m = Math.ceil((l + h) / 2);
      if (offset(m) <= pos) l = m;
      else h = m - 1;
    }
    return l;
  };
  return {
    offset,
    at,
    size: (i: number) => changes.get(i) ?? base * zoom,
    total: offset(count),
  };
}
export const Grid = forwardRef<GridHandle, Props>(function Grid(p, ref) {
  const viewport = useRef<HTMLDivElement>(null),
    edit = useRef<HTMLInputElement>(null),
    [scroll, setScroll] = useState({ x: 0, y: 0 }),
    [dimensions, setDimensions] = useState({ width: 1000, height: 500 }),
    [resizePreview, setResizePreview] = useState<{
      axis: "row" | "column";
      index: number;
      size: number;
    } | null>(null);
  const scale = p.zoom / 100,
    headerW = p.preferences?.headings === false ? 0 : 44,
    headerH = p.preferences?.headings === false ? 0 : 24,
    rows = useMemo(
      () =>
        geometry(
          ROWS,
          22,
          resizePreview?.axis === "row"
            ? {
                ...p.sheet.rows,
                [resizePreview.index]: {
                  ...p.sheet.rows[resizePreview.index],
                  height: resizePreview.size,
                },
              }
            : p.sheet.rows,
          scale,
          p.filteredRows,
        ),
      [p.sheet.rows, p.sheet, p.zoom, p.filteredRows, resizePreview],
    ),
    cols = useMemo(
      () =>
        geometry(
          COLS,
          96,
          resizePreview?.axis === "column"
            ? {
                ...p.sheet.columns,
                [resizePreview.index]: {
                  ...p.sheet.columns[resizePreview.index],
                  width: resizePreview.size,
                },
              }
            : p.sheet.columns,
          scale,
        ),
      [p.sheet.columns, p.sheet, p.zoom, resizePreview],
    );
  const physicalHeight = Math.min(8000000, rows.total + headerH),
    yFactor = Math.max(
      1,
      (rows.total + headerH - dimensions.height) /
        (physicalHeight - dimensions.height),
    ),
    logicalY = scroll.y * yFactor;
  const freezeRows = p.sheet.freeze.rows,
    freezeCols = p.sheet.freeze.columns,
    freezeH = rows.offset(freezeRows),
    freezeW = cols.offset(freezeCols);
  const startRow = Math.max(freezeRows, rows.at(logicalY + freezeH)),
    startCol = Math.max(freezeCols, cols.at(scroll.x + freezeW));
  const rowIndices: number[] = [],
    colIndices: number[] = [];
  for (let i = 0; i < freezeRows && i < 200; i++)
    if (rows.size(i)) rowIndices.push(i);
  for (
    let i = startRow;
    i < ROWS && rows.offset(i) < logicalY + dimensions.height + 50;
    i++
  )
    if (rows.size(i)) rowIndices.push(i);
  for (let i = 0; i < freezeCols && i < 100; i++)
    if (cols.size(i)) colIndices.push(i);
  for (
    let i = startCol;
    i < COLS && cols.offset(i) < scroll.x + dimensions.width + 100;
    i++
  )
    if (cols.size(i)) colIndices.push(i);
  const top = (r: number) =>
      headerH + rows.offset(r) - (r < freezeRows ? 0 : logicalY),
    left = (c: number) =>
      headerW + cols.offset(c) - (c < freezeCols ? 0 : scroll.x);
  const drag = useRef<{
      anchor: { row: number; col: number };
      fill?: boolean;
      source?: Range;
      target: Range;
    } | null>(null),
    lastPointer = useRef<{ clientX: number; clientY: number } | null>(null),
    resizeCleanup = useRef<(() => void) | null>(null);
  const latest = useRef({
    p,
    rows,
    cols,
    logicalY,
    scroll,
    yFactor,
    freezeH,
    freezeW,
    headerW,
    headerH,
  });
  latest.current = {
    p,
    rows,
    cols,
    logicalY,
    scroll,
    yFactor,
    freezeH,
    freezeW,
    headerW,
    headerH,
  };
  const viewportCallback = useRef(p.onViewport);
  viewportCallback.current = p.onViewport;
  useEffect(() => {
    viewportCallback.current?.(scroll.x, logicalY);
  }, [scroll.x, logicalY]);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() =>
      setDimensions({
        width: element.clientWidth,
        height: element.clientHeight,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const reveal = (row: number, col: number) => {
    const el = viewport.current;
    if (!el) return;
    let y = logicalY,
      x = scroll.x;
    if (row >= freezeRows) {
      if (rows.offset(row) < logicalY + freezeH) y = rows.offset(row) - freezeH;
      else if (rows.offset(row + 1) > logicalY + dimensions.height - headerH)
        y = rows.offset(row + 1) - dimensions.height + headerH;
    }
    if (col >= freezeCols) {
      if (cols.offset(col) < x + freezeW) x = cols.offset(col) - freezeW;
      else if (cols.offset(col + 1) > x + dimensions.width - headerW)
        x = cols.offset(col + 1) - dimensions.width + headerW;
    }
    el.scrollTo({ top: y / yFactor, left: x });
  };
  useImperativeHandle(ref, () => ({
    focus: () => viewport.current?.focus(),
    reveal,
  }));
  useEffect(() => {
    if (
      p.editing &&
      !document.activeElement?.closest(".sheets-formula-input")
    ) {
      edit.current?.focus();
      edit.current?.setSelectionRange(p.draft.length, p.draft.length);
    }
  }, [p.editing]);
  useEffect(() => {
    const el = viewport.current!;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const multiplier =
        e.deltaMode === 1 ? 22 : e.deltaMode === 2 ? dimensions.height : 1;
      el.scrollTop += (e.deltaY * multiplier) / yFactor;
      el.scrollLeft += e.deltaX * multiplier;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [yFactor, dimensions.height]);
  useEffect(() => {
    const update = () => {
      const current = drag.current,
        point = lastPointer.current,
        el = viewport.current;
      if (!current || !point || !el) return;
      const state = latest.current,
        box = el.getBoundingClientRect(),
        x = point.clientX - box.left - state.headerW,
        y = point.clientY - box.top - state.headerH,
        row = state.rows.at(
          Math.max(
            0,
            y + (y < state.freezeH ? 0 : el.scrollTop * state.yFactor),
          ),
        ),
        col = state.cols.at(
          Math.max(0, x + (x < state.freezeW ? 0 : el.scrollLeft)),
        );
      let target = { start: current.anchor, end: { row, col } };
      if (current.fill && current.source) {
        const source = normalized(current.source);
        target = {
          start: {
            row: Math.min(source.start.row, row),
            col: Math.min(source.start.col, col),
          },
          end: {
            row: Math.max(source.end.row, row),
            col: Math.max(source.end.col, col),
          },
        };
      }
      if (rangeLabel(target) === rangeLabel(current.target)) return;
      current.target = target;
      if (!current.fill) state.p.onSelect(target);
    };
    const move = (event: PointerEvent) => {
      if (!drag.current) return;
      lastPointer.current = { clientX: event.clientX, clientY: event.clientY };
      update();
    };
    const timer = setInterval(() => {
      const point = lastPointer.current,
        el = viewport.current;
      if (!drag.current || !point || !el) return;
      const box = el.getBoundingClientRect(),
        dy =
          point.clientY < box.top + latest.current.headerH
            ? -22
            : point.clientY > box.bottom - 14
              ? 22
              : 0,
        dx =
          point.clientX < box.left + latest.current.headerW
            ? -48
            : point.clientX > box.right - 14
              ? 48
              : 0;
      if (dy || dx) {
        el.scrollTop += dy / latest.current.yFactor;
        el.scrollLeft += dx;
        update();
      }
    }, 50);
    const up = () => {
        if (drag.current?.fill && latest.current.p.preferences?.enableFillHandle !== false)
          latest.current.p.onFill(drag.current.target);
        drag.current = null;
        lastPointer.current = null;
      },
      cancel = () => {
        drag.current = null;
        lastPointer.current = null;
      };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      resizeCleanup.current?.();
    };
  }, []);
  const active = p.selection.start,
    selected = normalized(p.selection),
    address = cellAddress(active.row, active.col);
  const select = (row: number, col: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (p.editing && !p.onCommit(0, 0)) {
      e.preventDefault();
      return;
    }
    const merge = p.sheet.merges.find((m) => includes(m, row, col)),
      point = merge?.start ?? { row, col },
      anchor = e.shiftKey ? p.selection.start : point,
      r = { start: anchor, end: point };
    p.onSelect(r, e.metaKey || e.ctrlKey);
    drag.current = { anchor, target: r };
    lastPointer.current = { clientX: e.clientX, clientY: e.clientY };
    viewport.current?.focus();
    e.preventDefault();
  };
  function resize(
    axis: "row" | "column",
    index: number,
    event: React.PointerEvent,
  ) {
    event.preventDefault();
    event.stopPropagation();
    resizeCleanup.current?.();
    const origin = axis === "row" ? event.clientY : event.clientX,
      initial = (axis === "row" ? rows : cols).size(index) / scale;
    let size = initial;
    const move = (e: PointerEvent) => {
      const position = axis === "row" ? e.clientY : e.clientX;
      size = Math.max(
        axis === "row" ? 16 : 24,
        Math.min(800, initial + (position - origin) / scale),
      );
      setResizePreview({ axis, index, size });
    };
    const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        resizeCleanup.current = null;
      },
      up = () => {
        cleanup();
        setResizePreview(null);
        if (size !== initial) p.onResize(axis, index, size);
      },
      cancel = () => {
        cleanup();
        setResizePreview(null);
      };
    resizeCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }
  useEffect(() => {
    const merge = p.sheet.merges.find((m) =>
      includes(m, p.selection.start.row, p.selection.start.col),
    );
    if (
      merge &&
      (merge.start.row !== p.selection.start.row ||
        merge.start.col !== p.selection.start.col) &&
      rangeLabel(p.selection) === address
    )
      p.onSelect({ start: merge.start, end: merge.start });
  }, [address, p.sheet.merges, p.selection]);
  function key(event: KeyboardEvent) {
    const merge = p.sheet.merges.find((m) =>
      includes(m, active.row, active.col),
    );
    if (
      merge &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === "ArrowRight" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const target =
        event.key === "ArrowRight"
          ? { row: active.row, col: Math.min(COLS - 1, merge.end.col + 1) }
          : { row: Math.min(ROWS - 1, merge.end.row + 1), col: active.col };
      p.onSelect({ start: target, end: target });
      reveal(target.row, target.col);
      return;
    }
    p.onKey(event);
  }
  const noteMode = p.preferences?.notes ?? "indicators";
  function issueForCell(cell: Cell | undefined): string | undefined {
    if (!p.preferences?.backgroundErrorChecking || !cell) return;
    const value = cellValue(cell);
    if (p.preferences.checkFormulaErrors && isError(value))
      return `Formula error: ${value.code}${value.message ? ` — ${value.message}` : ""}`;
    if (p.preferences.checkNumbersAsText && typeof value === "string" && value.trim() && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
      return "Number stored as text";
    if (p.preferences.checkEmptyReferences && cell.formula && formulaReferences(cell.formula).some(reference => {
      if (reference.last || reference.sheet && reference.sheet.toLowerCase() !== p.sheet.name.toLowerCase()) return false;
      const point = parseAddress(reference.first), address = cellAddress(point.row, point.col), source = p.cellDisplay?.(address) ?? p.sheet.cells[address];
      return !source?.formula && source?.value == null;
    })) return "Formula references an empty cell";
  }
  return (
    <div
      className="sheets-grid"
      data-headings={p.preferences?.headings === false ? "hidden" : "visible"}
      style={{
        overflowX: p.preferences?.horizontalScrollBar === false ? "hidden" : undefined,
        overflowY: p.preferences?.verticalScrollBar === false ? "hidden" : undefined,
      }}
      ref={viewport}
      role="grid"
      aria-label={`${p.sheet.name} worksheet`}
      aria-rowcount={ROWS}
      aria-colcount={COLS}
      aria-activedescendant={`sheet-${p.sheet.id}-${address}`}
      tabIndex={0}
      onScroll={(e) =>
        setScroll({
          x: e.currentTarget.scrollLeft,
          y: e.currentTarget.scrollTop,
        })
      }
      onKeyDown={p.editing ? undefined : key}
      onCompositionEnd={(e) => {
        if (!p.editing && e.data) p.onEdit(e.data);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        p.onContext(e.clientX, e.clientY);
      }}
    >
      <div
        className="sheets-grid-spacer"
        style={{ width: cols.total + headerW, height: physicalHeight }}
      />
      <div
        className="sheets-grid-viewport"
        style={{
          left: scroll.x,
          top: scroll.y,
          width: dimensions.width,
          height: dimensions.height,
        }}
      >
        {rowIndices.map((row) => (
          <div role="row" key={row} aria-rowindex={row + 1}>
            {colIndices.map((col) => {
              const a = cellAddress(row, col),
                cell = p.cellDisplay?.(a) ?? p.sheet.cells[a],
                merge = p.sheet.merges.find((m) => includes(m, row, col));
              if (merge && (row !== merge.start.row || col !== merge.start.col))
                return null;
              const isActive = row === active.row && col === active.col,
                inSelection =
                  includes(p.selection, row, col) ||
                  p.extraSelections.some((r) => includes(r, row, col));
              const cellStyle = {
                ...p.defaultCellStyle,
                ...p.sheet.columns[col]?.style,
                ...p.sheet.rows[row]?.style,
                ...cell?.style,
              };
              const style = styleForCell(cellStyle);
              const issue = issueForCell(cell), note = noteMode !== "none" ? cell?.note : undefined;
              return (
                <div
                  id={`sheet-${p.sheet.id}-${a}`}
                  key={col}
                  role="gridcell"
                  aria-colindex={col + 1}
                  aria-selected={inSelection}
                  aria-label={`${a}${cell?.formula ? " " + cell.formula : ""} ${formatValue(cell ?? { value: null }, p.dateSystem, p.preferences?.locale)}${note ? ` Note: ${note}` : ""}${issue ? ` ${issue}` : ""}`}
                  aria-describedby={noteMode === "always" && note ? `sheet-${p.sheet.id}-${a}-note` : undefined}
                  title={[note, issue].filter(Boolean).join("\n") || undefined}
                  data-address={a}
                  className={`sheets-cell ${inSelection ? "selected" : ""} ${isActive ? "active" : ""} ${!p.sheet.showGridlines ? "no-grid" : ""} ${typeof (cell?.cached ?? cell?.value) === "number" ? "numeric" : ""} ${col < freezeCols || row < freezeRows ? "frozen" : ""}`}
                  style={{
                    ...style,
                    borderRightColor: !cellStyle.borders?.right && p.sheet.showGridlines ? p.preferences?.gridlineColor : undefined,
                    borderBottomColor: !cellStyle.borders?.bottom && p.sheet.showGridlines ? p.preferences?.gridlineColor : undefined,
                    left: left(col),
                    top: top(row),
                    width:
                      cols.offset((merge?.end.col ?? col) + 1) -
                      cols.offset(col),
                    height:
                      rows.offset((merge?.end.row ?? row) + 1) -
                      rows.offset(row),
                    fontSize: (cellStyle.fontSize ?? 11) * scale * 1.2,
                    zIndex: row < freezeRows || col < freezeCols ? 3 : 1,
                  }}
                  onPointerDown={(e) => select(row, col, e)}
                  onDoubleClick={() => p.onEdit()}
                >
                  {isActive && p.editing ? (
                    <input
                      ref={edit}
                      aria-label={`Edit ${a}`}
                      value={p.draft}
                      onChange={(e) => p.onDraft(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === "Enter") {
                          e.preventDefault();
                          p.onCommit(e.shiftKey ? -1 : 1, 0);
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          p.onCommit(0, e.shiftKey ? -1 : 1);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          p.onCancel();
                        }
                      }}
                    />
                  ) : (
                    <>
                      <span
                        style={
                          cellStyle.rotation
                            ? {
                                transform: `rotate(${-cellStyle.rotation}deg)`,
                                transformOrigin: "center",
                                overflow: "visible",
                              }
                            : undefined
                        }
                      >
                        {p.formulaView && cell?.formula
                          ? cell.formula
                          : p.preferences?.showZeroValues === false && cellValue(cell) === 0
                            ? ""
                          : formatValue(cell ?? { value: null }, p.dateSystem, p.preferences?.locale)}
                      </span>
                      {note && <i className="sheets-note-marker" aria-hidden="true" />}
                      {issue && <i className="sheets-error-marker" title={issue} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, borderTop: `7px solid ${p.preferences?.errorIndicatorColor ?? "#217346"}`, borderRight: "7px solid transparent" }} />}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {noteMode === "always" && rowIndices.flatMap(row => colIndices.map(col => {
          const address = cellAddress(row, col), note = (p.cellDisplay?.(address) ?? p.sheet.cells[address])?.note;
          if (!note || p.sheet.merges.some(merge => includes(merge, row, col) && (row !== merge.start.row || col !== merge.start.col))) return null;
          return <div key={`note-${address}`} id={`sheet-${p.sheet.id}-${address}-note`} role="note" aria-label={`Note for ${address}`} className="glass sheets-visible-note" style={{ position: "absolute", left: Math.max(headerW, Math.min(dimensions.width - 210, left(col) + cols.size(col) - 6)), top: Math.max(headerH, Math.min(dimensions.height - 60, top(row) + 3)), width: 190, maxHeight: 120, overflow: "auto", padding: "8px 10px", borderRadius: 5, fontSize: 11, lineHeight: 1.4, whiteSpace: "pre-wrap", color: "var(--glass-text)", zIndex: 12, pointerEvents: "auto" }}><strong>{address}</strong><div>{note}</div></div>;
        }))}
        {p.editing &&
          p.references?.map((reference, index) => {
            const range = normalized(reference),
              x = Math.max(headerW, left(range.start.col)),
              y = Math.max(headerH, top(range.start.row)),
              width = Math.max(
                0,
                Math.min(
                  dimensions.width,
                  left(range.end.col) + cols.size(range.end.col),
                ) - x,
              ),
              height = Math.max(
                0,
                Math.min(
                  dimensions.height,
                  top(range.end.row) + rows.size(range.end.row),
                ) - y,
              );
            if (!width || !height) return null;
            const color = REFERENCE_COLORS[index % REFERENCE_COLORS.length];
            return (
              <div
                key={`${rangeLabel(range)}-${index}`}
                data-reference={rangeLabel(range)}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width,
                  height,
                  border: `2px dashed ${color}`,
                  backgroundColor: `${color}08`,
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            );
          })}
        {!p.editing && (
          <div
            className="sheets-selection-outline"
            style={{
              left: Math.max(headerW, left(selected.start.col)),
              top: Math.max(headerH, top(selected.start.row)),
              width: Math.max(
                0,
                Math.min(
                  dimensions.width,
                  left(selected.end.col) + cols.size(selected.end.col),
                ) - Math.max(headerW, left(selected.start.col)),
              ),
              height: Math.max(
                0,
                Math.min(
                  dimensions.height,
                  top(selected.end.row) + rows.size(selected.end.row),
                ) - Math.max(headerH, top(selected.start.row)),
              ),
            }}
          >
            {p.preferences?.enableFillHandle !== false && <button
              aria-label="Fill handle"
              tabIndex={-1}
              className="sheets-fill-handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                drag.current = {
                  anchor: p.selection.start,
                  target: p.selection,
                  source: p.selection,
                  fill: true,
                };
                lastPointer.current = {
                  clientX: e.clientX,
                  clientY: e.clientY,
                };
              }}
            />}
          </div>
        )}
        {p.preferences?.headings !== false && <><div className="sheets-col-headings" style={{ height: headerH }}>
          {colIndices.map((col) => (
            <div
              key={col}
              role="columnheader"
              className={
                col >= selected.start.col && col <= selected.end.col
                  ? "selected"
                  : ""
              }
              style={{
                left: left(col),
                width: cols.size(col),
                height: headerH,
                zIndex: col < freezeCols ? 7 : 5,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                if (p.editing && !p.onCommit(0, 0)) return;
                p.onSelect(
                  {
                    start: {
                      row: 0,
                      col: e.shiftKey ? p.selection.start.col : col,
                    },
                    end: { row: ROWS - 1, col },
                  },
                  e.metaKey || e.ctrlKey,
                );
                viewport.current?.focus();
              }}
            >
              {cellAddress(0, col).slice(0, -1)}
              <i
                className="sheets-col-resize"
                onPointerDown={(e) => resize("column", col, e)}
              />
            </div>
          ))}
        </div>
        <div className="sheets-row-headings" style={{ width: headerW }}>
          {rowIndices.map((row) => (
            <div
              key={row}
              role="rowheader"
              className={
                row >= selected.start.row && row <= selected.end.row
                  ? "selected"
                  : ""
              }
              style={{
                top: top(row),
                height: rows.size(row),
                width: headerW,
                zIndex: row < freezeRows ? 7 : 5,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                if (p.editing && !p.onCommit(0, 0)) return;
                p.onSelect(
                  {
                    start: {
                      row: e.shiftKey ? p.selection.start.row : row,
                      col: 0,
                    },
                    end: { row, col: COLS - 1 },
                  },
                  e.metaKey || e.ctrlKey,
                );
                viewport.current?.focus();
              }}
            >
              {row + 1}
              <i
                className="sheets-row-resize"
                onPointerDown={(e) => resize("row", row, e)}
              />
            </div>
          ))}
        </div>
        <button
          className="sheets-select-all"
          aria-label="Select all cells"
          style={{ width: headerW, height: headerH }}
          onClick={() =>
            p.onSelect({
              start: { row: 0, col: 0 },
              end: { row: ROWS - 1, col: COLS - 1 },
            })
          }
        >
          ◢
        </button>
        </>}
      </div>
    </div>
  );
});
export function styleForCell(s: CellStyle): CSSProperties {
  const border = (side: "top" | "right" | "bottom" | "left") => {
    const b = s.borders?.[side];
    return b
      ? `${b.style === "thick" ? 3 : b.style === "medium" || b.style === "double" ? 2 : 1}px ${["dashed", "dotted", "double"].includes(b.style) ? b.style : "solid"} ${b.color}`
      : undefined;
  };
  return {
    fontFamily: s.fontFamily,
    fontWeight: s.bold ? "bold" : undefined,
    fontStyle: s.italic ? "italic" : undefined,
    textDecoration:
      [s.underline ? "underline" : "", s.strike ? "line-through" : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    color: s.color,
    backgroundColor: s.fill,
    textAlign: s.horizontal as CSSProperties["textAlign"],
    whiteSpace: s.wrap ? "pre-wrap" : undefined,
    paddingLeft: s.indent ? `${s.indent * 10 + 4}px` : undefined,
    alignItems:
      s.vertical === "top"
        ? "flex-start"
        : s.vertical === "bottom"
          ? "flex-end"
          : "center",
    borderTop: border("top"),
    borderRight: border("right"),
    borderBottom: border("bottom"),
    borderLeft: border("left"),
  };
}
