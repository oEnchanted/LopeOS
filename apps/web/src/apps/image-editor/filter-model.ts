import type { RasterFilter } from '../../../../../packages/image-engine/src';

export const filterNames:Record<RasterFilter['type'],string>={'gaussian-blur':'Gaussian Blur','sharpen':'Sharpen','unsharp-mask':'Unsharp Mask','box-blur':'Box Blur','motion-blur':'Motion Blur','high-pass':'High Pass','add-noise':'Add Noise',mosaic:'Mosaic',emboss:'Emboss','find-edges':'Find Edges',solarize:'Solarize',invert:'Invert',grayscale:'Desaturate'};
export const filterRadiusTypes:RasterFilter['type'][]=['gaussian-blur','box-blur','motion-blur','unsharp-mask','high-pass','mosaic'];
export const filterAmountTypes:RasterFilter['type'][]=['sharpen','unsharp-mask','add-noise','emboss'];
