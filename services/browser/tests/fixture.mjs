import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

export const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Lope Browser test application</title></head><body>
<h1>Real browser fixture</h1><form id="form"><label>Your name<input id="name" name="name"></label><button>Submit form</button></form><p id="greeting"></p>
<a id="next" href="/next">Next page</a><a id="download" href="/download" download="fixture.txt">Download file</a>
<input type="file" id="upload"><output id="uploaded"></output><button id="popup" onclick="window.child=window.open('/popup','test-popup')">Open popup</button>
<audio controls id="audio" src="/tone.wav"></audio><video id="video" controls></video><canvas id="canvas" width="200" height="100"></canvas>
<script>
document.querySelector('#form').onsubmit=e=>{e.preventDefault();document.querySelector('#greeting').textContent='Hello, '+document.querySelector('#name').value;history.pushState({},'', '/hello#form');document.title='Hello from JavaScript'};
document.querySelector('#upload').onchange=async e=>document.querySelector('#uploaded').textContent=await e.target.files[0].text();
window.storageTest=async()=>{localStorage.setItem('lope-test','persistent');document.cookie='lope-test=cookie;SameSite=Lax';const db=await new Promise((ok,no)=>{const r=indexedDB.open('lope-test',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>ok(r.result);r.onerror=no});await new Promise((ok,no)=>{const tx=db.transaction('values','readwrite');tx.objectStore('values').put('indexed-value','key');tx.oncomplete=ok;tx.onerror=no});db.close();const worker=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;return{local:localStorage.getItem('lope-test'),cookie:document.cookie,worker:!!worker}};
window.recordVideo=async()=>{const canvas=document.querySelector('#canvas'),ctx=canvas.getContext('2d');const stream=canvas.captureStream(15);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(ok=>recorder.onstop=ok);recorder.start();let i=0;const timer=setInterval(()=>{ctx.fillStyle=i++%2?'#537e70':'#cb9980';ctx.fillRect(0,0,200,100)},60);await new Promise(ok=>setTimeout(ok,500));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());const video=document.querySelector('#video');video.src=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));video.muted=true;await video.play();await new Promise(ok=>setTimeout(ok,200));return{time:video.currentTime,width:video.videoWidth,ready:video.readyState}};
</script></body></html>`;

function tone() {
  const rate = 24000, samples = rate * 2; const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(rate,24);
  data.writeUInt32LE(rate*2,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write('data',36); data.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 6000),44+i*2); return data;
}
export async function createFixture() {
  const server = createServer((request, response) => {
    if(request.url === '/sw.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"); }
    else if(request.url === '/download') { response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=fixture.txt' }); response.end('A real download from Chromium.'); }
    else if(request.url === '/tone.wav') { response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(tone()); }
    else if(request.url === '/next') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>Next page</title><h1>Navigation works</h1>'); }
    else if(request.url === '/redirect') { response.writeHead(302, { Location: '/next' }); response.end(); }
    else if(request.url === '/popup') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>Popup</title><script>window.opener.postMessage("opener intact", "*")</script>'); }
    else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(fixtureHtml); }
  });
  const sockets = new Set();
  server.on('upgrade', (request, socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const text = Buffer.from('A real WebSocket message.'); socket.write(Buffer.concat([Buffer.from([0x81,text.length]),text]));
  });
  server.listen(0, '127.0.0.1'); await once(server,'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}`, close: async()=>{for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(ok=>server.close(ok));} };
}
