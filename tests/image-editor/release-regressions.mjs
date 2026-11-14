// Run existing acceptance assertions against compiled production entries.
// Only module access, entry URL, and the existing Prism rename are adapted.
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const base=process.env.IMAGE_EDITOR_TEST_URL||'http://127.0.0.1:5189';
const out='docs/image-editor/release-audit/evidence';await mkdir(out,{recursive:true});
const scripts=process.argv.slice(2).length?process.argv.slice(2):['browser','stability','cs6-browser','presets','smart-filter-browser','blend-browser','handoff'];
const results=[];
for(const name of scripts){
 const source=name==='handoff'?'tests/lightroom/handoff.mjs':`tests/image-editor/${name}.mjs`;
 let text=await readFile(source,'utf8');
 text=text.replaceAll('/tests/image-editor/harness.html','/tests/image-editor/release.html').replaceAll('/tests/lightroom/handoff.html','/tests/image-editor/release-handoff.html');
 text=text.replaceAll(/await import\(['"]\/packages\/image-engine\/src\/index\.ts['"]\)/g,'window.__release.engine');
 text=text.replaceAll(/await import\(['"]\/apps\/web\/src\/apps\/image-editor\/session\.ts['"]\)/g,'window.__release.session');
 text=text.replaceAll(/await import\(['"]\/apps\/web\/src\/apps\/lightroom\/library\.ts['"]\)/g,'window.__release.library');
 text=text.replaceAll(/await import\(['"]\/apps\/web\/src\/apps\/image-editor\/worker-client\.ts['"]\)/g,'window.__release.worker');
 text=text.replaceAll('About Image Editor','About Prism');
 const temporary=`tests/image-editor/.release-${name}.mjs`;await writeFile(temporary,text);
 const run=spawnSync(process.execPath,[temporary],{env:{...process.env,IMAGE_EDITOR_TEST_URL:base,LOPE_PHOTO_BASE:base},encoding:'utf8',timeout:180000});
 await writeFile(`${out}/production-${name}.log`,(run.stdout||'')+(run.stderr||''));
 results.push({name,source,result:run.status===0?'PASS':'FAIL',exit:run.status,error:run.error?.message});
 await unlink(temporary);console.log(JSON.stringify(results.at(-1)));
}
await writeFile(`${out}/production-regressions.json`,JSON.stringify({base,results},null,2)+'\n');
if(results.some(r=>r.result!=='PASS'))process.exitCode=1;
