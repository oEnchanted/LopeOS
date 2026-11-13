export type PanelId = 'Color' | 'Swatches' | 'Properties' | 'Adjustments' | 'History' | 'Layers' | 'Channels' | 'Paths';
export type Workspace = { width: number; collapsed: boolean; columns: boolean;autoColumns?:boolean;groupHeights?:number[]; rulers: boolean; guides: boolean; taskBar: boolean; taskPinned: boolean; taskPosition: { x: number; y: number } | null; groups: PanelId[][]; active: PanelId[]; floating: { id: PanelId; x: number; y: number;width?:number;height?:number }[]; hidden: PanelId[] };
export const essentials = (): Workspace => ({ width: 284, collapsed: false, columns: false,autoColumns:true, rulers: true, guides: true, taskBar: true, taskPinned: false, taskPosition: null, groups: [['Color', 'Swatches'], ['Properties', 'Adjustments', 'History'], ['Layers', 'Channels', 'Paths']], active: ['Color', 'Properties', 'Layers'], floating: [], hidden: [] });
export const adjustmentDefinitions = {
  brightness: { label: 'Brightness/Contrast', fields: ['Brightness', 'Contrast'], initial: [0, 0], min: [-150, -100], max: [150, 100], step: [1, 1] },
  levels: { label: 'Levels', fields: ['Input black', 'Gamma', 'Input white'], initial: [0, 1, 255], min: [0, .1, 1], max: [254, 10, 255], step: [1, .1, 1] },
  curves: { label: 'Curves', fields: ['Black output', 'Midpoint output', 'White output'], initial: [0, 128, 255], min: [0, 0, 0], max: [255, 255, 255], step: [1, 1, 1] },
  hue: { label: 'Hue/Saturation', fields: ['Hue', 'Saturation', 'Lightness'], initial: [0, 0, 0], min: [-180, -100, -100], max: [180, 100, 100], step: [1, 1, 1] },
  balance: { label: 'Color Balance', fields: ['Cyan — Red', 'Magenta — Green', 'Yellow — Blue'], initial: [0, 0, 0], min: [-100, -100, -100], max: [100, 100, 100], step: [1, 1, 1] },
  exposure:{label:'Exposure',fields:['Exposure','Offset','Gamma correction'],initial:[0,0,1],min:[-10,-.5,.1],max:[10,.5,10],step:[.01,.001,.01]},
  vibrance:{label:'Vibrance',fields:['Vibrance','Saturation'],initial:[0,0],min:[-100,-100],max:[100,100],step:[1,1]},
  'black-white':{label:'Black & White',fields:['Reds','Yellows','Greens','Cyans','Blues','Magentas'],initial:[40,60,40,60,20,80],min:[-200,-200,-200,-200,-200,-200],max:[300,300,300,300,300,300],step:[1,1,1,1,1,1]},
  'photo-filter':{label:'Photo Filter',fields:['Filter red','Filter green','Filter blue','Density'],initial:[236,138,0,25],min:[0,0,0,0],max:[255,255,255,100],step:[1,1,1,1]},
  'channel-mixer':{label:'Channel Mixer',fields:['Red from red','Red from green','Red from blue','Red constant','Green from red','Green from green','Green from blue','Green constant','Blue from red','Blue from green','Blue from blue','Blue constant'],initial:[100,0,0,0,0,100,0,0,0,0,100,0],min:Array(12).fill(-200),max:Array(12).fill(200),step:Array(12).fill(1)},
  invert:{label:'Invert',fields:[],initial:[],min:[],max:[],step:[]},
  posterize:{label:'Posterize',fields:['Levels'],initial:[4],min:[2],max:[255],step:[1]},
  threshold:{label:'Threshold',fields:['Threshold level'],initial:[128],min:[1],max:[255],step:[1]},
  'gradient-map':{label:'Gradient Map',fields:['Shadow red','Shadow green','Shadow blue','Highlight red','Highlight green','Highlight blue'],initial:[0,0,0,255,255,255],min:[0,0,0,0,0,0],max:[255,255,255,255,255,255],step:[1,1,1,1,1,1]},
} as const;
export type AdjustmentId = keyof typeof adjustmentDefinitions;
