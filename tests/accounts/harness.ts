import { cloudAccount } from '../../apps/web/src/accounts/service';
import { preferences } from '../../packages/sdk/src/preferences';
import { lopeDriveFiles } from '../../packages/runtime-client/src/lope-drive';
import { moveToTrash, listTrash, restoreTrashItem, DRIVE_TRASH_PATH } from '../../apps/web/src/shell/trash';
Object.assign(window, { accountTest: { cloudAccount, preferences, drive: lopeDriveFiles, moveToTrash, listTrash, restoreTrashItem, DRIVE_TRASH_PATH } });
