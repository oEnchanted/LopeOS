import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PtyTransport } from './pty-transport.js';

// Native transport fixture only. The product runtime always requires Linux/Docker.
test('native sandbox-agent protocol and PTY really execute quoting, pipelines, Python/Node, completion, history, signals, jobs and resize', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lope-pty-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const child = spawn(globalThis.process.execPath, [fileURLToPath(new URL('./agent-fixture.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: globalThis.process.env.PATH, LOPE_TEST_WORKDIR: dir } });
  const process = await new PtyTransport(child).ready;
  t.after(() => { try { process.kill(); } catch {} });
  let output = '', watchers = [];
  process.onData(data => { output = (output + data).slice(-131072); for (const resolve of watchers.splice(0)) resolve(); });
  const waitFor = async (pattern, timeout = 4000) => {
    const end = Date.now() + timeout;
    // Newer Bash versions wrap prompts in Readline bracketed-paste toggles.
    // Ignore that prompt decoration while retaining the raw transport output
    // and all other controls, including the alternate-screen assertion below.
    while (!pattern.test(output.replace(/\x1b\[\?2004[hl]\r?/g, ''))) {
      if (Date.now() > end) assert.fail(`PTY did not produce ${pattern}. Tail: ${output.slice(-1000)}`);
      await Promise.race([new Promise(resolve => watchers.push(resolve)), new Promise(resolve => setTimeout(resolve, 40))]);
    }
  };
  await waitFor(/lope-test>/);
  process.write("mkdir 'two words'; printf '%s\\n' alpha beta gamma | grep beta > 'two words/result'; pipeline_status=$?; mv 'two words/result' 'two words/renamed'; cat 'two words/renamed'; printf 'PIPE_STATUS=%s\\n' \"$pipeline_status\"\r");
  await waitFor(/\r\nbeta\r\nPIPE_STATUS=0/);
  output = ''; process.write("printf x | grep missing > empty; printf 'FAIL_STATUS=%s\\n' \"$?\"\r"); await waitFor(/\r\nFAIL_STATUS=1/);
  output = '';
  process.write("python3 -c 'print(6*7)'; node -e 'console.log(7*7)'\r"); await waitFor(/\r\n42\r\n49\r\n/);
  output = ''; process.write("python3 -c 'print(\"你好🌙\")'\r"); await waitFor(/\r\n你好🌙\r\n/);
  output = '';
  process.write("python3 -c 'import os,termios,tty; old=termios.tcgetattr(0); tty.setraw(0); print(\"RAW_READY\",flush=True); data=os.read(0,2); termios.tcsetattr(0,termios.TCSANOW,old); print(list(data),flush=True)'\r");
  await waitFor(/RAW_READY\n/); process.writeBinary(Buffer.from([16, 17])); await waitFor(/\[16, 17\]\r\n/);
  output = ''; process.write("printf 'HISTORY_OK\\n'\r"); await waitFor(/\r\nHISTORY_OK\r\n/);
  output = ''; process.write('\x1b[A\r'); await waitFor(/\r\nHISTORY_OK\r\n/);
  output = ''; process.write("cat two\t/renamed\r"); await waitFor(/\r\nbeta\r\n/);
  output = ''; process.write('sleep 20\r'); await new Promise(resolve => setTimeout(resolve, 80)); process.write('\x1a'); await waitFor(/Stopped/);
  output = ''; process.write('bg\rjobs\r'); await waitFor(/Running/);
  output = ''; process.write('fg\r'); await new Promise(resolve => setTimeout(resolve, 80)); process.write('\x03'); await waitFor(/lope-test>/);
  output = ''; process.resize(101, 37); process.write("stty size; printf '\\033[?1049hALT_SCREEN\\033[?1049l'\r"); await waitFor(/37 101/); await waitFor(/\x1b\[\?1049h/);
  output = ''; process.write('yes LOPE_LOAD\r'); await waitFor(/LOPE_LOAD[\s\S]*LOPE_LOAD[\s\S]*LOPE_LOAD/); process.pause(); await new Promise(resolve => setTimeout(resolve, 100)); process.write('\x03'); process.resume(); await waitFor(/lope-test>/); assert.ok(output.length <= 131072);
  process.write("printf '\\nINTERRUPT_DONE\\n'\r"); await waitFor(/\r\nINTERRUPT_DONE\r\n/);
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Ctrl+D did not exit the interactive shell.')), 2000);
    process.onExit(({ exitCode }) => { clearTimeout(timeout); resolve(exitCode); });
  });
  process.write('\x04'); assert.equal(await exited, 0);
});
