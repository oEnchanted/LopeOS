import { readFile, writeFile } from 'node:fs/promises';
// Start with Docker's default restrictions, enabling the namespace calls Chromium's
// own sandbox needs, including the chroot that seals its new user namespace.
// Docker's capability-gated chroot rule would otherwise remain blocked after
// the outer worker drops all capabilities. Keep clone3's ENOSYS fallback and
// all other default restrictions.
const source = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (source.defaultAction !== 'SCMP_ACT_ERRNO' || !Array.isArray(source.syscalls)) throw new Error('Expected the reviewed Docker default seccomp profile.');
const names = new Set(['clone', 'setns', 'unshare', 'chroot']);
source.syscalls = source.syscalls.map(rule => ({ ...rule, names: rule.names.filter(name => !names.has(name)) })).filter(rule => rule.names.length);
source.syscalls.push({ names: [...names], action: 'SCMP_ACT_ALLOW' });
await writeFile(process.argv[3], JSON.stringify(source, null, 2) + '\n');
