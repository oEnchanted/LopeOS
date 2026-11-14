import * as media from '../../packages/media-service/src/index.ts';
import * as model from '../../packages/video-engine/src/index.ts';
import * as render from '../../packages/video-engine/src/render.ts';
import * as exporter from '../../packages/video-engine/src/export.ts';
import * as interchange from '../../packages/video-engine/src/interchange.ts';
import { VideoWorker } from '../../apps/web/src/apps/video-editor/client.ts';
import { MediaStore } from '../../packages/media-service/src/storage.ts';
Object.assign(window,{media,model,render,exporter,interchange,VideoWorker,MediaStore,engineReady:true});
