import { useRef } from "react";
import type {
  Worksheet,
  Chart,
} from "../../../../../packages/spreadsheet-engine/src/model";
import { chartPresentation } from "./chart-svg";
import type { SheetPreferences } from "./preferences";

/** Keep chart data and print SVG intact while honoring interactive hover tips. */
function chartTips(svg: string, elementTips: boolean, valueTips: boolean): string {
  if (elementTips && valueTips) return svg;
  let rootTitle = true;
  return svg.replace(/<title>([\s\S]*?)<\/title>/g, (full, text: string) => {
    if (rootTitle) {
      rootTitle = false;
      return elementTips ? full : "";
    }
    if (!elementTips && !valueTips) return "";
    const separator = text.lastIndexOf(": ");
    if (separator < 0) return elementTips ? full : "";
    return `<title>${elementTips ? text.slice(0, separator) : text.slice(separator + 2)}</title>`;
  });
}

export function ChartView({
  chart,
  sheet,
  selected,
  onSelect,
  onEdit,
  onMove,
  dateSystem = "1900",
  scale = 1,
  preferences,
}: {
  scale?: number;
  dateSystem?: "1900" | "1904";
  chart: Chart;
  sheet: Worksheet;
  selected: boolean;
  onSelect(): void;
  onEdit(): void;
  onMove(x: number, y: number): void;
  preferences?: SheetPreferences;
}) {
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const presentation = chartPresentation(chart, sheet, dateSystem);
  const svg = chartTips(presentation.svg, preferences?.chartElementTips !== false, preferences?.chartValueTips !== false);
  return (
    <article
      className={`sheets-chart ${selected ? "selected" : ""}`}
      style={{
        left: chart.x,
        top: chart.y,
        width: chart.width,
        height: chart.height,
      }}
      tabIndex={0}
      aria-label={`${chart.title}, ${chart.type} chart`}
      onFocus={onSelect}
      onPointerDown={onSelect}
      onDoubleClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEdit();
        }
        if (
          event.altKey &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          onMove(
            Math.max(
              0,
              chart.x +
                (event.key === "ArrowLeft"
                  ? -10
                  : event.key === "ArrowRight"
                    ? 10
                    : 0),
            ),
            Math.max(
              0,
              chart.y +
                (event.key === "ArrowUp"
                  ? -10
                  : event.key === "ArrowDown"
                    ? 10
                    : 0),
            ),
          );
        }
      }}
    >
      <header
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          drag.current = {
            x: chart.x,
            y: chart.y,
            px: event.clientX,
            py: event.clientY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          onSelect();
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const element = event.currentTarget.parentElement!;
          element.style.left = `${Math.max(0, start.x + (event.clientX - start.px) / scale)}px`;
          element.style.top = `${Math.max(0, start.y + (event.clientY - start.py) / scale)}px`;
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          if (!start) return;
          drag.current = null;
          onMove(
            Math.max(0, start.x + (event.clientX - start.px) / scale),
            Math.max(0, start.y + (event.clientY - start.py) / scale),
          );
        }}
        onPointerCancel={(event) => {
          drag.current = null;
          const element = event.currentTarget.parentElement!;
          element.style.left = `${chart.x}px`;
          element.style.top = `${chart.y}px`;
        }}
      >
        <strong>{chart.title}</strong>
        <button aria-label={`Edit ${chart.title}`} onClick={onEdit}>
          •••
        </button>
      </header>
      <div
        className="sheets-chart-graphic"
        style={{ flex: 1, minHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {presentation.notice && <small>{presentation.notice}</small>}
    </article>
  );
}
