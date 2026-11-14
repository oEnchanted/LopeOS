// Isolated audit checkouts may share an existing dependency installation.
// Permit only that resolved dependency directory in addition to this checkout.
import { mergeConfig } from 'vite';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import base from '../../vite.config.ts';
const root=fileURLToPath(new URL('../..',import.meta.url));
export default mergeConfig(base,{server:{proxy:{'/api/accounts':{target:'http://127.0.0.1:5196'}},fs:{allow:[root,realpathSync(new URL('../../node_modules',import.meta.url))]}}});
