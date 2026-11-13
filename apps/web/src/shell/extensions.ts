import { exampleManifest } from '../../../../packages/app-template/manifest';
import type { AppManifest } from '../../../../packages/contracts/src';
import { writerManifest } from '../apps/writer/manifest';
import { imageEditorManifest } from '../apps/image-editor/manifest';
import { lightroomManifest } from '../apps/lightroom/manifest';

// Register an application here. No window-manager or rendering changes are needed.
// The SDK example is searchable in development and omitted from production builds.
export const extensions: AppManifest[] = [{ ...writerManifest, icon: 'writer' }, imageEditorManifest, lightroomManifest, ...(import.meta.env.DEV ? [exampleManifest] : [])];
