import { Blend, Brush, Circle, CircleDashed, Crop, Droplet, Eraser, Focus, Hand, Icon, Lasso, Magnet, MousePointer2, Move, PaintBucket, Paintbrush, PenTool, Pipette, Search, Square, SquareDashed, Stamp, Sun, Type, WandSparkles } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import type { BrushSettings } from '../../../../../packages/image-engine/src';

export type ToolId = 'move' | 'marquee' | 'ellipse-select' | 'lasso' | 'polygon' | 'wand' | 'crop' | 'eyedropper' | 'heal' | 'brush' | 'pencil' | 'clone' | 'eraser' | 'gradient' | 'fill' | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge' | 'pen' | 'type' | 'path-select' | 'rectangle' | 'ellipse' | 'hand' | 'zoom';
type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;
export type Tool = { id: ToolId; label: string; key: string; icon: Icon; disabled?: string };
export const TOOL_GROUPS: Tool[][] = [
  [{ id: 'move', label: 'Move Tool', key: 'V', icon: Move }],
  [{ id: 'marquee', label: 'Rectangular Marquee Tool', key: 'M', icon: SquareDashed }, { id: 'ellipse-select', label: 'Elliptical Marquee Tool', key: 'M', icon: CircleDashed }],
  [{ id: 'lasso', label: 'Lasso Tool', key: 'L', icon: Lasso }, { id: 'polygon', label: 'Polygonal Lasso Tool', key: 'L', icon: Magnet }],
  [{ id: 'wand', label: 'Magic Wand Tool', key: 'W', icon: WandSparkles }],
  [{ id: 'crop', label: 'Crop Tool', key: 'C', icon: Crop }],
  [{ id: 'eyedropper', label: 'Eyedropper Tool', key: 'I', icon: Pipette }],
  [{ id: 'heal', label: 'Healing Brush Tool', key: 'J', icon: Paintbrush }],
  [{ id: 'brush', label: 'Brush Tool', key: 'B', icon: Brush }, { id: 'pencil', label: 'Pencil Tool', key: 'B', icon: PenTool }],
  [{ id: 'clone', label: 'Clone Stamp Tool', key: 'S', icon: Stamp }],
  [{ id: 'eraser', label: 'Eraser Tool', key: 'E', icon: Eraser }],
  [{ id: 'gradient', label: 'Gradient Tool', key: 'G', icon: Blend }, { id: 'fill', label: 'Paint Bucket Tool', key: 'G', icon: PaintBucket }],
  [{ id: 'blur', label: 'Blur Tool', key: '', icon: Droplet },{id:'sharpen',label:'Sharpen Tool',key:'',icon:Focus},{id:'smudge',label:'Smudge Tool',key:'',icon:Hand}],
  [{ id: 'dodge', label: 'Dodge Tool', key: 'O', icon: Sun },{id:'burn',label:'Burn Tool',key:'O',icon:Focus},{id:'sponge',label:'Sponge Tool',key:'O',icon:Droplet}],
  [{ id: 'pen', label: 'Pen Tool', key: 'P', icon: PenTool }],
  [{ id: 'type', label: 'Horizontal Type Tool', key: 'T', icon: Type }],
  [{ id: 'path-select', label: 'Path Selection Tool', key: 'A', icon: MousePointer2 }],
  [{ id: 'rectangle', label: 'Rectangle Tool', key: 'U', icon: Square }, { id: 'ellipse', label: 'Ellipse Tool', key: 'U', icon: Circle }],
  [{ id: 'hand', label: 'Hand Tool', key: 'H', icon: Hand }],
  [{ id: 'zoom', label: 'Zoom Tool', key: 'Z', icon: Search }],
];
export const TOOLS = TOOL_GROUPS.flat();
export const initialBrush: BrushSettings = { size: 45, hardness: .8, opacity: 1, flow: 1, spacing: .15, color: '#c18f62', pressure: true };
export type ToolOptions = { autoSelect: boolean; showTransform: boolean; tolerance: number; contiguous: boolean; feather: number; straighten?: boolean; selectionMode: 'replace' | 'add' | 'subtract' | 'intersect' };
