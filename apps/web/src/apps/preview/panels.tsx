import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Baseline, Bold, ChevronDown, Circle, Crop, Lasso, MessageSquare, Minus, PenLine, RectangleHorizontal, Scaling, Sparkles, SlidersHorizontal, Square, SquareDashed, Star, Type, Highlighter, WandSparkles, X, AlignLeft, AlignCenter, AlignRight, CircleDashed } from 'lucide-react';
import { Button, Dialog, Input, Select } from '../../../../../packages/ui/src';
import { formatBytes } from '../hooks';
import { exportFormats, type ImageFormat } from './formats';
import { fonts, palette, shapeLabels, type FontId, type Shape, type ShapeKind, type Style } from './markup';
import { autoLevels, histogram, isNeutral, neutralAdjust, type ColorAdjust, type Histogram } from './raster';
import { supportsAlpha, supportsQuality } from './encoders';
import type { Tool } from './Stage';

export function Dropdown({ label, icon, children, active, disabled, wide }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode; active?: boolean; disabled?: boolean; wide?: boolean }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', down, true); root.current?.addEventListener('keydown', key);
    const node = root.current; return () => { document.removeEventListener('pointerdown', down, true); node?.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="preview-dropdown" ref={root}>
    <button type="button" className={`preview-tool ${active ? 'is-active' : ''}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>{icon}<ChevronDown size={10}/></button>
    {open && <div className={`preview-menu glass ${wide ? 'wide' : ''}`} role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
  </div>;
}
const MenuItem = ({ icon, label, onClick, checked }: { icon?: ReactNode; label: string; onClick: () => void; checked?: boolean }) =>
  <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={checked} className={checked ? 'checked' : ''} onClick={onClick}>{icon}<span>{label}</span></button>;

function ColorChooser({ value, onChange, allowNone, close }: { value: string | null; onChange: (color: string | null) => void; allowNone?: boolean; close: () => void }) {
  return <div className="preview-colors">
    <div className="preview-swatches">{palette.map(color => <button type="button" key={color} aria-label={color} className={value === color ? 'selected' : ''} style={{ background: color }} onClick={() => { onChange(color); close(); }}/>)}</div>
    <label className="preview-custom-color">Other color<input type="color" value={value ?? '#000000'} onChange={event => onChange(event.target.value)}/></label>
    {allowNone && <button type="button" className={`preview-no-fill ${value === null ? 'selected' : ''}`} onClick={() => { onChange(null); close(); }}><CircleDashed size={14}/>No fill</button>}
  </div>;
}
const shapeIcons: Partial<Record<ShapeKind, ReactNode>> = { rect: <Square size={15}/>, rounded: <RectangleHorizontal size={15}/>, oval: <Circle size={15}/>, line: <Minus size={15}/>, arrow: <ArrowUpRight size={15}/>, star: <Star size={15}/>, bubble: <MessageSquare size={15}/>, highlight: <Highlighter size={15}/> };
export const insertableShapes: ShapeKind[] = ['line', 'arrow', 'rect', 'rounded', 'oval', 'bubble', 'star', 'highlight'];
const selectionTools: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Rectangular Selection', icon: <SquareDashed size={15}/> },
  { id: 'ellipse', label: 'Elliptical Selection', icon: <CircleDashed size={15}/> },
  { id: 'lasso', label: 'Lasso Selection', icon: <Lasso size={15}/> },
  { id: 'alpha', label: 'Instant Alpha', icon: <WandSparkles size={15}/> },
];
export interface MarkupBarProps {
  tool: Tool; onTool(tool: Tool): void; style: Style; onStyle(change: Partial<Style>): void; selected?: Shape;
  onInsert(kind: ShapeKind): void; onText(): void; onAdjustColor(): void; onAdjustSize(): void; onCrop(): void; canCrop: boolean; disabled: boolean;
}
export function MarkupBar(p: MarkupBarProps) {
  const current = selectionTools.find(tool => tool.id === p.tool) ?? selectionTools[0], textual = p.selected?.kind === 'text';
  const stroke = p.selected?.stroke ?? p.style.stroke, fill = p.selected ? p.selected.fill : p.style.fill, width = p.selected?.width ?? p.style.width;
  return <div className="preview-markup glass-inset" role="toolbar" aria-label="Markup">
    <Dropdown label="Selection tools" icon={current.icon} active={p.tool !== 'pen'} disabled={p.disabled}>{close => selectionTools.map(tool => <MenuItem key={tool.id} icon={tool.icon} label={tool.label} checked={p.tool === tool.id} onClick={() => { p.onTool(tool.id); close(); }}/>)}</Dropdown>
    <button type="button" className={`preview-tool ${p.tool === 'pen' ? 'is-active' : ''}`} aria-pressed={p.tool === 'pen'} title="Sketch" aria-label="Sketch" disabled={p.disabled} onClick={() => p.onTool(p.tool === 'pen' ? 'select' : 'pen')}><PenLine size={15}/></button>
    <Dropdown label="Shapes" icon={<Square size={15}/>} disabled={p.disabled}>{close => <div className="preview-shape-grid">{insertableShapes.map(kind => <button type="button" key={kind} role="menuitem" title={shapeLabels[kind]} aria-label={shapeLabels[kind]} onClick={() => { p.onInsert(kind); close(); }}>{shapeIcons[kind]}</button>)}</div>}</Dropdown>
    <button type="button" className="preview-tool" title="Text" aria-label="Add text" disabled={p.disabled} onClick={p.onText}><Type size={15}/></button>
    <span className="preview-divider"/>
    <button type="button" className="preview-tool" title="Adjust Color" aria-label="Adjust Color" disabled={p.disabled} onClick={p.onAdjustColor}><SlidersHorizontal size={15}/></button>
    <button type="button" className="preview-tool" title="Adjust Size" aria-label="Adjust Size" disabled={p.disabled} onClick={p.onAdjustSize}><Scaling size={15}/></button>
    <span className="preview-divider"/>
    <Dropdown label="Shape style" icon={<span className="preview-line-sample" style={{ height: Math.min(8, Math.max(1, width / 2)) }}/>} disabled={p.disabled}>{close => [1, 2, 3, 5, 8, 12, 20].map(value => <MenuItem key={value} label={`${value} pt`} checked={width === value} icon={<span className="preview-line-sample" style={{ height: Math.min(10, Math.max(1, value / 2)) }}/>} onClick={() => { p.onStyle({ width: value }); close(); }}/>)}</Dropdown>
    <Dropdown label="Border color" icon={<span className="preview-color-sample outline" style={{ borderColor: stroke }}/>} disabled={p.disabled}>{close => <ColorChooser value={stroke} onChange={color => p.onStyle({ stroke: color ?? '#000000' })} close={close}/>}</Dropdown>
    <Dropdown label="Fill color" icon={<span className={`preview-color-sample ${fill ? '' : 'empty'}`} style={{ background: fill ?? undefined }}/>} disabled={p.disabled}>{close => <ColorChooser value={fill} allowNone onChange={color => p.onStyle({ fill: color })} close={close}/>}</Dropdown>
    <Dropdown label="Text style" icon={<Baseline size={15}/>} active={textual} disabled={p.disabled} wide>{() => <TextStyle style={p.style} selected={p.selected} onStyle={p.onStyle}/>}</Dropdown>
    {p.canCrop && <><span className="preview-divider"/><Button className="preview-crop" onClick={p.onCrop} title="Crop to selection"><Crop size={14}/>Crop</Button></>}
  </div>;
}
function TextStyle({ style, selected, onStyle }: { style: Style; selected?: Shape; onStyle(change: Partial<Style>): void }) {
  const font = selected?.font ?? style.font, size = selected?.size ?? style.size, bold = selected?.bold ?? style.bold, align = selected?.align ?? style.align, color = selected?.kind === 'text' ? selected.stroke : style.stroke;
  return <div className="preview-text-style">
    <div className="preview-text-row"><Select aria-label="Font" value={font} onChange={event => onStyle({ font: event.target.value as FontId })}>{Object.entries(fonts).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}</Select>
      <Input aria-label="Font size" type="number" min={6} max={400} value={Math.round(size)} onChange={event => onStyle({ size: Math.max(6, Math.min(400, Number(event.target.value) || 12)) })}/></div>
    <div className="preview-text-row">
      <input type="color" aria-label="Text color" value={color} onChange={event => onStyle({ stroke: event.target.value })}/>
      <button type="button" className={`preview-tool ${bold ? 'is-active' : ''}`} aria-pressed={bold} aria-label="Bold" onClick={() => onStyle({ bold: !bold })}><Bold size={14}/></button>
      {(['left', 'center', 'right'] as const).map(value => <button type="button" key={value} className={`preview-tool ${align === value ? 'is-active' : ''}`} aria-pressed={align === value} aria-label={`Align ${value}`} onClick={() => onStyle({ align: value })}>{value === 'left' ? <AlignLeft size={14}/> : value === 'center' ? <AlignCenter size={14}/> : <AlignRight size={14}/>}</button>)}
    </div>
  </div>;
}

// ---------- Inspector ----------
export interface InspectorInfo { name: string; kind: string; size?: number; width: number; height: number; dpi?: number; path?: string; modified?: string; alpha: boolean; details: [string, string][]; exif: [string, string][]; shapes: Shape[] }
export function Inspector({ info, selectedShape, onSelectShape, onDeleteShape, onClose }: { info: InspectorInfo; selectedShape: string | null; onSelectShape(id: string): void; onDeleteShape(id: string): void; onClose(): void }) {
  const [tab, setTab] = useState<'general' | 'more' | 'annotations'>('general');
  const megapixels = info.width * info.height / 1e6;
  const general: [string, string][] = [
    ['Name', info.name], ['Kind', info.kind], ...(info.size !== undefined ? [['File size', formatBytes(info.size)] as [string, string]] : []),
    ['Dimensions', `${info.width.toLocaleString()} × ${info.height.toLocaleString()} pixels${megapixels >= 0.1 ? ` (${megapixels.toFixed(1)} MP)` : ''}`],
    ...(info.dpi ? [['Resolution', `${info.dpi} pixels/inch`], ['Print size', `${(info.width / info.dpi).toFixed(2)} × ${(info.height / info.dpi).toFixed(2)} inches`]] as [string, string][] : []),
    ['Transparency', info.alpha ? 'Yes' : 'No'], ...info.details,
    ...(info.path ? [['Where', info.path] as [string, string]] : []), ...(info.modified ? [['Modified', new Date(info.modified).toLocaleString()] as [string, string]] : []),
  ];
  return <aside className="preview-inspector glass" aria-label="Inspector">
    <header><strong>{info.name}</strong><button type="button" aria-label="Close inspector" onClick={onClose}><X size={14}/></button></header>
    <div className="preview-segmented" role="tablist">{([['general', 'General'], ['more', 'More Info'], ['annotations', 'Annotations']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'general' && <dl>{general.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {tab === 'more' && (info.exif.length ? <dl>{info.exif.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p className="preview-inspector-empty">No camera information is stored in this image.</p>)}
    {tab === 'annotations' && (info.shapes.length ? <ul className="preview-annotations">{[...info.shapes].reverse().map(shape => <li key={shape.id} className={shape.id === selectedShape ? 'selected' : ''}>
      <button type="button" onClick={() => onSelectShape(shape.id)}><span className="preview-color-sample" style={{ background: shape.fill ?? shape.stroke }}/>{shape.kind === 'text' ? `“${(shape.text ?? '').slice(0, 30)}”` : shapeLabels[shape.kind]}</button>
      <button type="button" aria-label="Delete annotation" onClick={() => onDeleteShape(shape.id)}><X size={12}/></button></li>)}</ul> : <p className="preview-inspector-empty">No annotations. Use the markup toolbar to add shapes, sketches, and text.</p>)}
  </aside>;
}

// ---------- Adjust Color ----------
function HistogramView({ data }: { data: Histogram | null }) {
  const paths = useMemo(() => {
    if (!data) return [];
    const line = (values: Uint32Array) => { let d = 'M0 64'; for (let i = 0; i < 256; i++) d += ` L${i} ${64 - Math.min(64, values[i] / data.max * 62)}`; return d + ' L255 64 Z'; };
    return [['#ff3b30', line(data.r)], ['#34c759', line(data.g)], ['#0a84ff', line(data.b)]];
  }, [data]);
  return <svg className="preview-histogram" viewBox="0 0 255 64" preserveAspectRatio="none" aria-hidden="true">{paths.map(([color, d]) => <path key={color} d={d} fill={color} fillOpacity={0.45} style={{ mixBlendMode: 'screen' }}/>)}</svg>;
}
const sliders: { key: keyof ColorAdjust; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01 }, { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 }, { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 }, { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 }, { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1 },
  { key: 'sharpness', label: 'Sharpness', min: -100, max: 100, step: 1 },
];
export function AdjustColorPanel({ value, onChange, source, preview, busy, onDone, onCancel }: { value: ColorAdjust; onChange(value: ColorAdjust): void; source: ImageData | null; preview: ImageData | null; busy: boolean; onDone(): void; onCancel(): void }) {
  const data = useMemo(() => preview ? histogram(preview) : null, [preview]);
  const set = (key: keyof ColorAdjust, n: number) => onChange({ ...value, [key]: n });
  return <aside className="preview-adjust glass" aria-label="Adjust Color" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}>
    <header><strong>Adjust Color</strong><button type="button" aria-label="Cancel color adjustments" onClick={onCancel}><X size={14}/></button></header>
    <div className="preview-levels"><HistogramView data={data}/>
      <div className="preview-level-inputs">
        <input type="range" aria-label="Black point" min={0} max={0.9} step={0.005} value={value.black} onChange={event => set('black', Math.min(+event.target.value, value.white - 0.05))}/>
        <input type="range" aria-label="Midtones" min={-1} max={1} step={0.01} value={-Math.log2(value.gamma)} onChange={event => set('gamma', Math.pow(2, -event.target.value))}/>
        <input type="range" aria-label="White point" min={0.1} max={1} step={0.005} value={value.white} onChange={event => set('white', Math.max(+event.target.value, value.black + 0.05))}/>
      </div>
    </div>
    {sliders.map(slider => <label key={slider.key} className="preview-slider"><span>{slider.label}</span>
      <input type="range" min={slider.min} max={slider.max} step={slider.step} value={value[slider.key]} onChange={event => set(slider.key, +event.target.value)} onDoubleClick={() => set(slider.key, neutralAdjust[slider.key])}/>
      <output>{slider.key === 'saturation' ? `${Math.round(value.saturation * 100)}%` : slider.key === 'exposure' ? value.exposure.toFixed(2) : Math.round(value[slider.key])}</output></label>)}
    <footer>
      <Button disabled={!source || busy} onClick={() => source && onChange({ ...value, ...autoLevels(source) })}><Sparkles size={13}/>Auto Levels</Button>
      <Button disabled={isNeutral(value) || busy} onClick={() => onChange(neutralAdjust)}>Reset All</Button>
      <Button variant="primary" disabled={busy} onClick={onDone}>{busy ? 'Applying…' : 'Done'}</Button>
    </footer>
  </aside>;
}

// ---------- Adjust Size ----------
type Unit = 'pixels' | 'percent' | 'inches' | 'cm' | 'mm' | 'points';
const presets: [string, number, number][] = [['320 × 240', 320, 240], ['640 × 480', 640, 480], ['800 × 600', 800, 600], ['1024 × 768', 1024, 768], ['1280 × 1024', 1280, 1024], ['1920 × 1080', 1920, 1080], ['2560 × 1440', 2560, 1440], ['3840 × 2160', 3840, 2160]];
export function AdjustSizeDialog({ width, height, dpi, estimate, onApply, onClose }: { width: number; height: number; dpi: number; estimate(width: number, height: number): number; onApply(width: number, height: number, dpi: number): void; onClose(): void }) {
  const [w, setW] = useState(width), [h, setH] = useState(height), [res, setRes] = useState(dpi), [unit, setUnit] = useState<Unit>('pixels'), [lock, setLock] = useState(true), [resample, setResample] = useState(true), [fit, setFit] = useState('custom');
  const perUnit = (u: Unit, r = res) => u === 'pixels' ? 1 : u === 'inches' ? r : u === 'cm' ? r / 2.54 : u === 'mm' ? r / 25.4 : u === 'points' ? r / 72 : 0;
  const show = (pixels: number, original: number) => unit === 'percent' ? +(pixels / original * 100).toFixed(1) : unit === 'pixels' ? Math.round(pixels) : +(pixels / perUnit(unit)).toFixed(2);
  const read = (value: number, original: number) => unit === 'percent' ? value / 100 * original : value * perUnit(unit);
  const inchesPer = (u: Unit) => u === 'inches' ? 1 : u === 'cm' ? 1 / 2.54 : u === 'mm' ? 1 / 25.4 : u === 'points' ? 1 / 72 : 0;
  const physicalOnly = !resample && (unit === 'pixels' || unit === 'percent');
  // Without resampling the pixels stay fixed, so a new physical size changes only the resolution.
  function setWidth(value: number) { setFit('custom'); if (!resample) { const inches = value * inchesPer(unit); if (inches > 0) setRes(width / inches); return; } const px = Math.max(1, read(value, width)); setW(px); if (lock) setH(Math.max(1, px * height / width)); }
  function setHeight(value: number) { setFit('custom'); if (!resample) { const inches = value * inchesPer(unit); if (inches > 0) setRes(height / inches); return; } const px = Math.max(1, read(value, height)); setH(px); if (lock) setW(Math.max(1, px * width / height)); }
  function choose(id: string) { setFit(id); const preset = presets.find(([label]) => label === id); if (!preset) return; const scale = Math.min(preset[1] / width, preset[2] / height); setResample(true); setW(Math.max(1, width * scale)); setH(Math.max(1, height * scale)); }
  const outW = Math.round(resample ? w : width), outH = Math.round(resample ? h : height), invalid = !(outW >= 1 && outH >= 1 && outW <= 32768 && outH <= 32768 && outW * outH <= 120_000_000);
  return <Dialog title="Adjust Size" onClose={onClose}><form className="lope-application-dialog-form preview-size-form" onSubmit={event => { event.preventDefault(); if (!invalid) onApply(outW, outH, res); }}>
    <label>Fit into<Select value={fit} onChange={event => choose(event.target.value)}><option value="custom">Custom</option>{presets.map(([label]) => <option key={label} value={label}>{label} pixels</option>)}</Select></label>
    <div className="preview-size-grid">
      <label>Width<Input type="number" min={0} step="any" disabled={physicalOnly} value={show(resample ? w : width, width) || ''} onChange={event => setWidth(+event.target.value)}/></label>
      <label>Height<Input type="number" min={0} step="any" disabled={physicalOnly} value={show(resample ? h : height, height) || ''} onChange={event => setHeight(+event.target.value)}/></label>
      <label>Units<Select value={unit} onChange={event => setUnit(event.target.value as Unit)}>{(['pixels', 'percent', 'inches', 'cm', 'mm', 'points'] as Unit[]).map(u => <option key={u} value={u}>{u}</option>)}</Select></label>
      <label>Resolution<Input type="number" min={1} max={10000} step="any" value={+res.toFixed(2)} onChange={event => { const value = Math.max(1, +event.target.value || 72); if (!resample) setRes(value); else { const physical = unit === 'pixels' || unit === 'percent' ? null : [w / perUnit(unit), h / perUnit(unit)]; setRes(value); if (physical) { setW(physical[0] * perUnit(unit, value)); setH(physical[1] * perUnit(unit, value)); } } }}/><small>pixels/inch</small></label>
    </div>
    <label className="preview-check"><input type="checkbox" checked={lock} onChange={event => { setLock(event.target.checked); if (event.target.checked) setH(Math.max(1, w * height / width)); }}/>Scale proportionally</label>
    <label className="preview-check"><input type="checkbox" checked={resample} onChange={event => { setResample(event.target.checked); setW(width); setH(height); }}/>Resample image</label>
    <dl className="preview-size-result"><div><dt>Current size</dt><dd>{width} × {height} px · {formatBytes(width * height * 4)}</dd></div><div><dt>Resulting size</dt><dd>{invalid ? 'Too large' : `${outW} × ${outH} px · ${formatBytes(estimate(outW, outH))}`}</dd></div></dl>
    <div className="dialog-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={invalid}>OK</Button></div>
  </form></Dialog>;
}

// ---------- Export ----------
export interface ExportChoice { format: ImageFormat; quality: number; alpha: boolean }
export function ExportDialog({ name, initial, transparent, measure, onExport, onClose, title = 'Export' }: { name: string; initial: ImageFormat; transparent: boolean; measure(choice: ExportChoice): Promise<number>; onExport(choice: ExportChoice): void; onClose(): void; title?: string }) {
  const [format, setFormat] = useState(exportFormats.find(f => f.id === initial.id) ?? exportFormats[0]), [quality, setQuality] = useState(0.85), [alpha, setAlpha] = useState(true), [size, setSize] = useState<number | null>(null);
  const choice = { format, quality, alpha: alpha && supportsAlpha(format.id) };
  useEffect(() => { let live = true; setSize(null); const timer = setTimeout(() => { measure(choice).then(value => { if (live) setSize(value); }, () => { if (live) setSize(-1); }); }, 250); return () => { live = false; clearTimeout(timer); }; }, [format.id, quality, choice.alpha]);
  const lost = transparent && !choice.alpha;
  return <Dialog title={`${title} “${name}”`} onClose={onClose}><form className="lope-application-dialog-form preview-export-form" onSubmit={event => { event.preventDefault(); onExport(choice); }}>
    <label>Format<Select value={format.id} autoFocus onChange={event => setFormat(exportFormats.find(f => f.id === event.target.value)!)}>{exportFormats.map(f => <option key={f.id} value={f.id}>{f.id === 'pnm' ? 'PPM' : f.id === 'jpeg' ? 'JPEG' : f.id.toUpperCase()}</option>)}</Select></label>
    {supportsQuality(format.id) && <label className="preview-quality">Quality<div><small>Least</small><input type="range" min={0.1} max={1} step={0.01} value={quality} onChange={event => setQuality(+event.target.value)}/><small>Best</small></div></label>}
    {supportsAlpha(format.id) && <label className="preview-check"><input type="checkbox" checked={alpha} onChange={event => setAlpha(event.target.checked)}/>Alpha (keep transparency)</label>}
    {lost && <p className="field-help">Transparent areas will be filled with white in this format.</p>}
    <p className="field-help">File size: {size === null ? 'Calculating…' : size < 0 ? 'Unavailable' : formatBytes(size)}</p>
    <div className="dialog-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={size === -1}>Save…</Button></div>
  </form></Dialog>;
}
