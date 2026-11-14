import {
  cellAddress,
  cellValue,
  formatValue,
  type Chart,
  type Worksheet,
} from "../../../../../packages/spreadsheet-engine/src/model.ts";

const colors = [
  "#278562",
  "#5076c2",
  "#e7a33e",
  "#b96689",
  "#6b9cab",
  "#9a78b8",
  "#cf7256",
  "#6c8857",
];
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const compact = (v: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    notation: "compact",
  }).format(v);
const n = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(4)) : "0");
const text = (
  x: number,
  y: number,
  value: unknown,
  anchor = "middle",
  size = 11,
  fill = "#5b6961",
) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-size="${size}" fill="${fill}">${escape(value)}</text>`;
const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = "#e1e7e3",
  width = 1,
) =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${width}"/>`;
const short = (v: string, length = 18) =>
  v.length > length ? v.slice(0, length - 1) + "…" : v;
export interface ChartPresentation {
  svg: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  notice: string;
  error?: string;
}

/** Identical, escaped SVG for the editable view and print. Non-numbers remain gaps. */
export function chartPresentation(
  chart: Chart,
  sheet: Worksheet,
  dateSystem: "1900" | "1904" = "1900",
): ChartPresentation {
  const range = chart.range,
    categoryCount = Math.max(0, range.end.row - range.start.row),
    seriesCount = Math.max(0, range.end.col - range.start.col),
    count = Math.min(200, categoryCount);
  const labels: string[] = [],
    xValues: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const cell =
        sheet.cells[cellAddress(range.start.row + i + 1, range.start.col)],
      value = cellValue(cell);
    labels.push(formatValue(cell, dateSystem));
    xValues.push(
      typeof value === "number" && Number.isFinite(value) ? value : null,
    );
  }
  const series = Array.from({ length: Math.min(8, seriesCount) }, (_, i) => ({
    name:
      formatValue(
        sheet.cells[cellAddress(range.start.row, range.start.col + i + 1)],
        dateSystem,
      ) || `Series ${i + 1}`,
    values: Array.from({ length: count }, (_, r) => {
      const v = cellValue(
        sheet.cells[
          cellAddress(range.start.row + r + 1, range.start.col + i + 1)
        ],
      );
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }),
  }));
  const pie = chart.type === "pie" || chart.type === "doughnut";
  const notice = [
    categoryCount > count
      ? `Showing first ${count} of ${categoryCount.toLocaleString()} categories.`
      : "",
    seriesCount > 8 ? `Showing first 8 of ${seriesCount} series.` : "",
    pie && seriesCount > 1
      ? "Pie and doughnut charts use the first series."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const values = series
    .flatMap((s) => s.values)
    .filter((v): v is number => v !== null);
  let error: string | undefined;
  if (!count || !series.length)
    error = "Choose a label column, a value column, and a data row.";
  else if (!values.length)
    error = "The selected data contains no finite numeric values.";
  else if (chart.type === "scatter" && !xValues.some((v) => v !== null))
    error = "Scatter charts require numeric x values in the first column.";
  else if (pie && series[0].values.some((v) => v !== null && v < 0))
    error = "Pie and doughnut charts require nonnegative values.";
  else if (pie && !series[0].values.some((v) => v !== null && v > 0))
    error = "The first series needs at least one positive value.";
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min,
    plot = {
      x: chart.type === "bar" ? 110 : 65,
      y: 22,
      w: chart.type === "bar" ? 505 : 550,
      h: 230,
    };
  const y = (v: number) => plot.y + plot.h - ((v - min) / span) * plot.h,
    x = (i: number) => plot.x + ((i + 0.5) / Math.max(1, count)) * plot.w,
    baseline = y(0),
    body: string[] = [];
  if (error) body.push(text(320, 165, error, "middle", 13));
  else if (pie) {
    const first = series[0].values,
      total = first.reduce<number>((sum, v) => sum + (v ?? 0), 0),
      cx = 320,
      cy = 140,
      radius = 113;
    let angle = -Math.PI / 2;
    first.forEach((v, i) => {
      if (v === null || v <= 0) return;
      const start = angle,
        delta = (v / total) * Math.PI * 2;
      angle += delta;
      const title = `<title>${escape(labels[i])}: ${escape(v)}</title>`;
      if (delta >= Math.PI * 2 - 1e-12)
        body.push(
          `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${colors[i % 8]}">${title}</circle>`,
        );
      else
        body.push(
          `<path d="M${cx},${cy} L${n(cx + radius * Math.cos(start))},${n(cy + radius * Math.sin(start))} A${radius},${radius} 0 ${delta > Math.PI ? 1 : 0},1 ${n(cx + radius * Math.cos(angle))},${n(cy + radius * Math.sin(angle))} Z" fill="${colors[i % 8]}" stroke="#fff">${title}</path>`,
        );
      if (chart.showLabels && delta > 0.12)
        body.push(
          text(
            cx + radius * 0.74 * Math.cos(start + delta / 2),
            cy + radius * 0.74 * Math.sin(start + delta / 2) + 4,
            `${+((v / total) * 100).toFixed(1)}%`,
            "middle",
            12,
            "#fff",
          ),
        );
    });
    if (chart.type === "doughnut")
      body.push(`<circle cx="${cx}" cy="${cy}" r="62" fill="#fff"/>`);
  } else if (chart.type === "bar") {
    const position = (v: number) => plot.x + ((v - min) / span) * plot.w,
      zero = position(0),
      slot = plot.h / count;
    for (let step = 0; step <= 4; step++) {
      const tick = min + (step / 4) * span,
        px = position(tick);
      body.push(
        line(px, plot.y, px, plot.y + plot.h),
        text(px, plot.y + plot.h + 19, compact(tick)),
      );
    }
    labels.forEach((label, i) => {
      if (count <= 20 || i % Math.ceil(count / 15) === 0)
        body.push(
          text(
            plot.x - 8,
            plot.y + (i + 0.5) * slot + 4,
            short(label, 16),
            "end",
          ),
        );
    });
    series.forEach((item, j) =>
      item.values.forEach((v, i) => {
        if (v === null) return;
        const left = Math.min(zero, position(v)),
          top =
            plot.y + i * slot + slot * 0.15 + (j * slot * 0.7) / series.length,
          barHeight = Math.max(0.25, (slot * 0.7) / series.length - 0.5),
          barWidth = Math.abs(position(v) - zero);
        body.push(
          `<rect x="${n(left)}" y="${n(top)}" width="${n(barWidth)}" height="${n(barHeight)}" fill="${colors[j % 8]}"><title>${escape(item.name)} — ${escape(labels[i])}: ${v}</title></rect>`,
        );
        if (chart.showLabels && count <= 20)
          body.push(
            text(
              position(v) + (v >= 0 ? 4 : -4),
              top + barHeight / 2 + 3,
              compact(v),
              v >= 0 ? "start" : "end",
              10,
            ),
          );
      }),
    );
  } else {
    for (let step = 0; step <= 4; step++) {
      const v = min + (step / 4) * span,
        py = y(v);
      body.push(
        line(plot.x, py, plot.x + plot.w, py),
        text(plot.x - 8, py + 4, compact(v), "end"),
      );
    }
    let scatterMin = 0,
      scatterMax = 1;
    if (chart.type === "scatter") {
      const xs = xValues.filter((v): v is number => v !== null);
      scatterMin = Math.min(...xs);
      scatterMax = Math.max(...xs);
      if (scatterMax === scatterMin) scatterMax++;
      for (let step = 0; step <= 4; step++)
        body.push(
          text(
            plot.x + (step / 4) * plot.w,
            plot.y + plot.h + 19,
            compact(scatterMin + (step / 4) * (scatterMax - scatterMin)),
          ),
        );
    } else
      labels.forEach((label, i) => {
        if (count <= 12 || i % Math.ceil(count / 12) === 0)
          body.push(
            text(x(i), plot.y + plot.h + 19, short(label, 13), "middle", 10),
          );
      });
    series.forEach((item, j) => {
      const fill = colors[j % 8];
      if (chart.type === "line" || chart.type === "area") {
        const segments: { index: number; value: number }[][] = [];
        let segment: { index: number; value: number }[] = [];
        item.values.forEach((v, i) => {
          if (v === null) {
            if (segment.length) segments.push(segment);
            segment = [];
          } else segment.push({ index: i, value: v });
        });
        if (segment.length) segments.push(segment);
        for (const points of segments) {
          const coords = points
            .map((p) => `${n(x(p.index))},${n(y(p.value))}`)
            .join(" ");
          if (chart.type === "area" && points.length > 1)
            body.push(
              `<polygon points="${n(x(points[0].index))},${n(baseline)} ${coords} ${n(x(points.at(-1)!.index))},${n(baseline)}" fill="${fill}" opacity=".18"/>`,
            );
          if (points.length > 1)
            body.push(
              `<polyline points="${coords}" fill="none" stroke="${fill}" stroke-width="2.2"/>`,
            );
        }
      }
      item.values.forEach((v, i) => {
        if (v === null) return;
        const tooltip = `<title>${escape(item.name)} — ${escape(labels[i])}: ${v}</title>`;
        if (chart.type === "scatter") {
          const xv = xValues[i];
          if (xv === null) return;
          body.push(
            `<circle cx="${n(plot.x + ((xv - scatterMin) / (scatterMax - scatterMin)) * plot.w)}" cy="${n(y(v))}" r="3.5" fill="${fill}">${tooltip}</circle>`,
          );
        } else if (chart.type === "line" || chart.type === "area")
          body.push(
            `<circle cx="${n(x(i))}" cy="${n(y(v))}" r="${count <= 30 ? 3 : 1.5}" fill="${fill}">${tooltip}</circle>`,
          );
        else {
          const slot = plot.w / count,
            barWidth = (slot * 0.7) / series.length,
            px = x(i) - slot * 0.35 + j * barWidth;
          body.push(
            `<rect x="${n(px)}" y="${n(Math.min(y(v), baseline))}" width="${n(Math.max(0.25, barWidth - 0.5))}" height="${n(Math.abs(y(v) - baseline))}" fill="${fill}">${tooltip}</rect>`,
          );
        }
        if (chart.showLabels && count <= 20 && chart.type !== "scatter")
          body.push(
            text(x(i), y(v) + (v < 0 ? 13 : -6), compact(v), "middle", 10),
          );
      });
    });
  }
  if (chart.showLegend !== false && !error) {
    const legends = pie ? labels : series.map((s) => s.name);
    legends.slice(0, 8).forEach((name, i) => {
      const px = (i % 4) * 160 + 22,
        py = 292 + Math.floor(i / 4) * 20;
      body.push(
        `<rect x="${px}" y="${py - 9}" width="9" height="9" fill="${colors[i % 8]}"/>`,
        text(px + 14, py, short(name), "start", 10),
      );
    });
    if (legends.length > 8)
      body.push(text(623, 326, `+${legends.length - 8} more`, "end", 9));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 330" role="img" aria-label="${escape(chart.title)}, ${escape(chart.type)} chart: ${count} categories, ${series.length} series" style="display:block;width:100%;height:100%;font-family:Arial,Helvetica,sans-serif"><title>${escape(chart.title)}</title><desc>${escape(error ?? `${notice} Blank, text and error values are gaps.`)}</desc><rect width="640" height="330" fill="#fff"/>${body.join("")}</svg>`;
  return { svg, labels, series, notice, error };
}
