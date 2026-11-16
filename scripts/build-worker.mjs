import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const output='dist/server';
await mkdir(output,{recursive:true});
const assets={
  '/':['index.html','text/html; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/street.mjs':['street.mjs','text/javascript; charset=utf-8'],
  '/globe.mjs':['globe.mjs','text/javascript; charset=utf-8'],
  '/engine.mjs':['engine.mjs','text/javascript; charset=utf-8'],
  '/enhance.mjs':['enhance.mjs','text/javascript; charset=utf-8'],
  '/investigate.mjs':['investigate.mjs','text/javascript; charset=utf-8'],
  '/sharp.mjs':['sharp.mjs','text/javascript; charset=utf-8'],
  '/config.js':['config.js','text/javascript; charset=utf-8'],
  '/vendor/leaflet.js':['vendor/leaflet.js','text/javascript; charset=utf-8'],
  '/vendor/leaflet.css':['vendor/leaflet.css','text/css; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8']
};
for(const [path,[file,type]] of Object.entries(assets)){
  assets[path]=[await readFile('dist/'+file,'utf8'),type];
}
const engine=await readFile('dist/engine.mjs','utf8');
const handler=(await readFile('server/firms.mjs','utf8')).replace(/^import[^\n]*\n/,'');
await writeFile(output+'/index.js',engine+'\n'+handler+'\nconst assets='+JSON.stringify(assets)+`;
export default {
  fetch(request,env) {
    const {pathname}=new URL(request.url);
    if(pathname==='/api/maps-config'){
      const key=env.GOOGLE_MAPS_BROWSER_KEY;
      return key?Response.json({key},{headers:{'Cache-Control':'no-store'}}):new Response(null,{status:503});
    }
    if(pathname==='/api/firms')return firms(request,env);
    const asset=Object.hasOwn(assets,pathname)?assets[pathname]:null;
    return asset?new Response(asset[0],{headers:{'Content-Type':asset[1]}}):new Response('Not found',{status:404});
  }
};
`);
await mkdir('dist/.openai',{recursive:true});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
