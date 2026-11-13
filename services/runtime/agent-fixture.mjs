// Test fixture only; the product starts agent/main.js inside Docker.
import path from 'node:path';
import { startAgent } from './agent/protocol.js';
const root = process.env.LOPE_TEST_WORKDIR;
if (!root) throw new Error('A temporary test directory is required.');
startAgent({ command: '/bin/bash', args: ['--noprofile', '--norc', '-i'], cols: 80, rows: 24, cwd: root, env: { HOME: root, PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, TERM: 'xterm-256color', LANG: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8', NO_COLOR: '1', PS1: 'lope-test> ', HISTFILE: path.join(root, '.history') } });
