import {resolve} from 'node:path';
import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',timeout:35000,expect:{timeout:8000},workers:2,reporter:[['list'],['json',{outputFile:resolve(import.meta.dirname,'../../docs/settings-revision/test-results.json')}]],use:{baseURL:process.env.LOPE_SETTINGS_URL||'http://127.0.0.1:5173',viewport:{width:1440,height:900},screenshot:'only-on-failure'},outputDir:'./results',projects:[{name:'chromium',use:{browserName:'chromium',launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}}}]});
