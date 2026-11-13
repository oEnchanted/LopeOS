import { readFile, access, unlink, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';

// Task Scheduler owns this process, independently of the Actions runner.
const root = process.argv[2];
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
const log = message => appendFile(join(root, 'logs', 'service.log'), `${new Date().toISOString()} ${message}\n`);
let service, timer, stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  await service?.dispose();
  await log('Stopped cleanly');
}
try {
  const lockPath = join(config.data, '.lock');
  try {
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid storage lock; manual inspection required.');
    try { process.kill(pid, 0); throw new Error('An account storage owner is still running.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await unlink(lockPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { createAccountServer } = await import(pathToFileURL(config.server).href);
  service = await createAccountServer({ directory: config.data, origins: [config.origin], production: true, trustProxy: true });
  service.server.listen(config.port, '127.0.0.1');
  await once(service.server, 'listening');
  await log(`Listening on 127.0.0.1:${config.port}`);
  timer = setInterval(() => {
    void access(join(root, 'stop')).then(stop).catch(error => {
      if (error.code !== 'ENOENT') { void log(error.message); process.exitCode = 1; }
    });
  }, 500);
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
} catch (error) {
  await service?.dispose();
  await log(error.stack || error.message);
  process.exitCode = 1;
}
