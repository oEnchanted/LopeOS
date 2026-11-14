import './harness';
import * as engine from '../../packages/image-engine/src';
import * as worker from '../../apps/web/src/apps/image-editor/worker-client';
import * as session from '../../apps/web/src/apps/image-editor/session';
import { internalMenus } from '../../apps/web/src/apps/image-editor/menu-model';
import { TOOL_GROUPS } from '../../apps/web/src/apps/image-editor/tool-model';
Object.assign(window, { __release: { engine, session, worker, internalMenus, TOOL_GROUPS } });
