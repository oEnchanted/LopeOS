import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const browserRoute = `    handle /api/browser/* {
        reverse_proxy 127.0.0.1:4177 {
            header_up X-Forwarded-For {remote_host}
            flush_interval -1
            stream_close_delay 5m
        }
    }`;

function blocks(source) {
  const result=[]; let depth=0,start=0,open=-1,quote='',comment=false;
  for(let index=0;index<source.length;index++) {
    const ch=source[index];
    if(comment){if(ch==='\n')comment=false;continue;}
    if(quote){if(ch==='\\'&&quote==='"'){index++;continue;}if(ch===quote)quote='';continue;}
    if(ch==='#'){comment=true;continue;}
    if(ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='{'){
      const placeholder=source.slice(index).match(/^\{[^\s{}]+\}/);if(placeholder){index+=placeholder[0].length-1;continue;}
      if(depth++===0)open=index;
    }else if(ch==='}'){
      if(--depth<0)throw new Error('Unbalanced Caddy configuration.');
      if(depth===0){result.push({start,open,end:index+1});start=index+1;}
    }
  }
  if(depth||quote)throw new Error('Unbalanced Caddy configuration.');return result;
}

/** Modify only the selected LopeOS site; preserve independent domains and custom routes. */
export function enableBrowserRoute(source, origin) {
  const host=new URL(origin).host;
  const matches=blocks(source).map(block=>{
    const header=source.slice(block.start,block.open),addresses=header.replace(/#[^\n]*/g,'').trim().split(/[\s,]+/).filter(Boolean);
    const selected=addresses.filter(address=>{
      if(address==='__LOPE_SITE_HOST__')return true;
      try{const url=new URL(address.includes('://')?address:'https://'+address);return url.protocol==='https:'&&url.host===host&&url.pathname==='/';}catch{return false;}
    });return{...block,header,addresses,selected};
  }).filter(block=>block.selected.length);
  if(matches.length!==1)throw new Error('Expected one explicit LopeOS HTTPS site or release-template block.');
  const block=matches[0];let body=source.slice(block.open+1,block.end-1);
  const disabled=/handle\s+\/api\/browser\/\*\s*\{\s*respond\s+"Lope Browser hosting is not configured\."\s+503\s*\}/;
  if(disabled.test(body))body=body.replace(disabled,browserRoute.trimStart());
  else if(/handle\s+\/api\/browser\/\*/.test(body)){
    if(/reverse_proxy\s+127\.0\.0\.1:4177\b/.test(body))return source;
    throw new Error('Custom browser routing exists; it has not been overwritten.');
  }else body='\n'+browserRoute+'\n'+body;
  const others=block.addresses.filter(address=>!block.selected.includes(address));
  if(!others.length)return source.slice(0,block.open+1)+body+source.slice(block.end-1);
  const comments=(block.header.match(/#[^\n]*/g)??[]).join('\n');
  const other='\n'+others.join(', ')+' '+source.slice(block.open,block.end)+'\n';
  const selected='\n'+(comments?comments+'\n':'')+block.selected.join(', ')+' {'+body+'}';
  return source.slice(0,block.start)+other+selected+source.slice(block.end);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const[input,origin,output]=process.argv.slice(2);await writeFile(output,enableBrowserRoute(await readFile(input,'utf8'),origin),{flag:'wx'});
}
