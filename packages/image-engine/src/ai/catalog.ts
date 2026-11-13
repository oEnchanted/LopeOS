/** Downloads are optional and immutable. No image bytes are sent to these hosts. */
export const AI_CACHE='lope-image-ai-modnet-ort122-v1';
export const AI_MODEL={id:'modnet',name:'MODNet portrait matting',license:'Apache-2.0',source:'https://github.com/ZHKKKe/MODNet',card:'https://huggingface.co/Xenova/modnet',runtime:'ONNX Runtime Web 1.22.0',runtimeLicense:'MIT',description:'Select people and remove portrait backgrounds. This model is trained for people, not general object selection.'};
export const AI_ASSETS=[
  {id:'runtime',file:'ort.wasm.min.mjs',url:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs',bytes:48259,sha256:'6ef726f355b791129f7ddf3f62e7877a16b9b777abe87004b8ab306e6b9cf265'},
  {id:'loader',file:'ort-wasm-simd-threaded.mjs',url:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.mjs',bytes:20856,sha256:'30dd851d9c00622940500f71ddd2ff8820c5cb65270816080175b958705385a8'},
  {id:'wasm',file:'ort-wasm-simd-threaded.wasm',url:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm',bytes:11210254,sha256:'71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4'},
  {id:'model',file:'modnet.onnx',url:'https://huggingface.co/Xenova/modnet/resolve/7e0f55f28727b43369531f75e0539ecc4912af82/onnx/model.onnx',bytes:25888640,sha256:'07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9'},
] as const;
export const AI_DOWNLOAD_BYTES=AI_ASSETS.reduce((sum,a)=>sum+a.bytes,0);
export const assetKey=(id:string)=>new URL(`/__lope_local_ai__/${id}`,globalThis.location?.origin||'http://localhost').href;
