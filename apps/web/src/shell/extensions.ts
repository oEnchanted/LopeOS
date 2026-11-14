import { exampleManifest } from '../../../../packages/app-template/manifest';
import type { AppManifest } from '../../../../packages/contracts/src';
import { writerManifest } from '../apps/writer/manifest';
import { imageEditorManifest } from '../apps/image-editor/manifest';
import { lightroomManifest } from '../apps/lightroom/manifest';
import { spreadsheetManifest } from '../apps/spreadsheet/manifest';
import { movieMakerManifest } from '../apps/movie-maker/manifest';
import { videoEditorManifest } from '../apps/video-editor/manifest';
import { imageGeneratorManifest } from '../apps/image-generator/manifest';

// Register an application here. No window-manager or rendering changes are needed.
// The SDK example is searchable in development and omitted from production builds.
export const extensions: AppManifest[] = [{ ...writerManifest, icon: 'writer' }, spreadsheetManifest, imageEditorManifest, lightroomManifest, movieMakerManifest, videoEditorManifest, imageGeneratorManifest, ...(import.meta.env.DEV ? [exampleManifest] : [])];
