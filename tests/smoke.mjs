// Browser smoke test. Serves dist/ and mocks NASA / OSM / ORNL hosts so it runs offline.
// Usage: node tests/smoke.mjs [screenshotDir]
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');

const root=join(fileURLToPath(new URL('.',import.meta.url)),'..','dist');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://x').pathname;
  try{const body=await readFile(join(root,path==='/'?'index.html':path));res.writeHead(200,{'Content-Type':types[extname(path)]||types['.html']});res.end(body)}
  catch{res.writeHead(404);res.end('Not found')}
});
await new Promise(r=>server.listen(0,r));
const base='http://localhost:'+server.address().port+'/';
const shots=process.argv[2];

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEElEQVR4nGNkYPj/n4GBgQEABQEBAVRJ1pYAAAAASUVORK5CYII=','base64');
function powerMonthly(){
  const par={};let s=7;const rnd=()=>((s=(s*16807)%2147483647)/2147483647);
  const base={T2M:2,T2M_MAX:8,PRECTOTCORR:2.2,RH2M:72,WS2M:3.4,GWETTOP:.62},tr={T2M:.03,T2M_MAX:.035,PRECTOTCORR:-.006,RH2M:-.05,WS2M:0,GWETTOP:-.002};
  for(const v of Object.keys(base)){par[v]={};for(let y=1981;y<=2025;y++)for(let m=1;m<=13;m++)par[v][y+String(m).padStart(2,'0')]=+(base[v]+tr[v]*(y-1981)+(rnd()-.5)*(v.startsWith('T')?2:base[v]*.2)).toFixed(2)}
  return {properties:{parameter:par}};
}
function powerDaily(url){
  const q=new URL(url).searchParams,start=q.get('start'),end=q.get('end');
  const d=new Date(Date.UTC(+start.slice(0,4),+start.slice(4,6)-1,+start.slice(6,8))),e=Date.UTC(+end.slice(0,4),+end.slice(4,6)-1,+end.slice(6,8));
  const par={};for(const v of q.get('parameters').split(','))par[v]={};let i=0;
  for(;+d<=e;d.setUTCDate(d.getUTCDate()+1),i++){const k=d.toISOString().slice(0,10).replace(/-/g,'');
    for(const v of Object.keys(par))par[v][k]=v==='PRECTOTCORR'?(i%9===3?6.4:i%5===0?.4:0):v==='T2M_MAX'?24+(i%7):v==='RH2M'?55-(i%10):3}
  return {properties:{parameter:par}};
}
const firmsCsv=sensor=>{
  const head=sensor==='MODIS'?'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type':'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type';
  const rows=[];for(const y of [2022,2023,2024])for(let d=1;d<=28;d++)for(let k=0;k<(d%7)+1+(sensor==='VIIRS'?2:0);k++)
    rows.push([(49+k*.07+d*.01).toFixed(4),(-90+k*.09).toFixed(4),330,1,1,`${y}-07-${String(d).padStart(2,'0')}`,'1830',sensor==='MODIS'?'Terra':'N20',sensor,sensor==='MODIS'?80:'n','6.1',290,12.5+k,'D',0].join(','));
  return head+'\n'+rows.join('\n');
};

const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();
const errors=[],results=[];
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push('console: '+m.text())});
const json=body=>({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
await context.route(/gibs\.earthdata\.nasa\.gov/,r=>r.fulfill({status:200,contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:PNG}));
await context.route(/power\.larc\.nasa\.gov\/api\/temporal\/monthly/,r=>r.fulfill(json(powerMonthly())));
await context.route(/power\.larc\.nasa\.gov\/api\/temporal\/daily/,r=>r.fulfill(json(powerDaily(r.request().url()))));
await context.route(/nominatim\.openstreetmap\.org/,r=>r.fulfill(json([{display_name:'Kenora, Ontario, Canada',lat:'49.767',lon:'-94.489',boundingbox:['49.70','49.83','-94.60','-94.35']}])));
await context.route(/modis\.ornl\.gov/,r=>r.fulfill(json({scale:'0.0001',subset:Array.from({length:8},(_,i)=>({calendar_date:`2024-0${5+Math.floor(i/2)}-${i%2?'25':'09'}`,data:[5200+i*260]}))})));
await context.route(/\/api\/(firms|maps-config)/,r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"FIRMS credentials have not been configured."}'}));

async function check(name,fn){
  try{const v=await fn();results.push(['ok',name,v??'']);}
  catch(e){results.push(['FAIL',name,e.message.split('\n')[0]])}
}
const text=sel=>page.$eval(sel,e=>e.innerText.trim());
const has=sel=>page.$(sel).then(Boolean);
const expect=(cond,msg)=>{if(!cond)throw Error(msg)};
const shot=async name=>{if(shots)await page.screenshot({path:join(shots,name+'.png'),fullPage:true})};

await page.goto(base);await page.waitForTimeout(800);
await check('loads in NASA recent mode',async()=>{expect(await text('h1')==='Fire Intelligence','h1');return await text('#data-note')});
await check('replay records mode shows stats',async()=>{await page.selectOption('#data-mode','records');await page.waitForTimeout(500);const t=await text('#total');expect(+t.replace(/,/g,'')>0,'total '+t);return 'total '+t});
await check('region switch',async()=>{await page.selectOption('#region','thunderbay');await page.waitForTimeout(400);expect((await text('#map-heading')).includes('Thunder Bay'),'heading');return await text('#total')});
await check('calendar day select',async()=>{await page.click('#days .day:nth-of-type(16)');await page.waitForTimeout(200);return await text('#replay-label')});
await check('whole month + replay play/stop',async()=>{await page.click('#clear');await page.click('#play');await page.waitForTimeout(1100);await page.click('#play');return await text('#replay-label')});
for(const op of ['week','seasons','sensors','persistence'])
  await check('analysis: '+op,async()=>{await page.click('#clear');await page.click(`[data-analysis="${op}"]`);await page.waitForTimeout(200);const t=await text('#analysis-result');expect(t.length>20,'empty result');return t.slice(0,70)});
await check('range replay after peak week',async()=>{await page.click('[data-analysis="week"]');await page.click('#play');await page.waitForTimeout(1200);await page.click('#play');return await text('#replay-label')});
await check('imagery options switch',async()=>{for(const v of ['truecolor','falsecolor','rain','terrain']){await page.selectOption('#imagery-style',v);await page.waitForTimeout(150)}return await text('#imagery-description')});
await check('globe/map toggle',async()=>{await page.click('#globe-toggle');await page.waitForTimeout(300);const t=await text('#globe-toggle');await page.click('#globe-toggle');await page.waitForTimeout(200);return t+' -> '+await text('#globe-toggle')});
await check('map mode imagery follows selection',async()=>{await page.click('#globe-toggle');await page.selectOption('#imagery-style','truecolor');await page.waitForTimeout(400);const hidden=await page.$eval('#nasa-imagery',e=>e.hidden);await page.selectOption('#imagery-style','terrain');await page.click('#globe-toggle');expect(!hidden,'map imagery hidden');});
await check('hotspot dialog + Worldview link',async()=>{await page.click('#clear');await page.waitForTimeout(200);await page.$eval('.hot',e=>e.click());await page.waitForTimeout(200);const href=await page.$eval('.worldview-link',e=>e.href);await page.keyboard.press('Escape');expect(href.includes('worldview.earthdata.nasa.gov'),'href');});
await check('export produces CSV',async()=>{const [d]=await Promise.all([page.waitForEvent('download',{timeout:4000}),page.click('#export')]);return d.suggestedFilename()});
await check('history calendar + KPIs',async()=>{expect(await has('#xp-cal td[data-y]'),'no cells');return (await text('#xp-kpis')).replace(/\n/g,' | ').slice(0,110)});
await check('history click opens month',async()=>{await page.click('#xp-cal td[data-y="2024"]');await page.waitForTimeout(300);const m=await text('#month');expect(m.includes('2024'),m);return m});
await check('Fire Detective full round',async()=>{await page.click('#xp-next');for(let i=0;i<3;i++){await page.waitForTimeout(100);await page.click('#xp-opts button');if(i<2)await page.click('#xp-next')}const b=await text('#xp-badge');expect(b.length>5,'no badge');return b.slice(0,50)});
await check('CSV import (MODIS + VIIRS)',async()=>{
  await page.setInputFiles('#files',[{name:'fire_archive_M-C61.csv',mimeType:'text/csv',buffer:Buffer.from(firmsCsv('MODIS'))},{name:'fire_archive_J1V-C2.csv',mimeType:'text/csv',buffer:Buffer.from(firmsCsv('VIIRS'))}]);
  await page.waitForTimeout(700);const n=await text('#data-note');expect(/Imported/.test(n),n);return (await text('#total'))+' cell-days · '+await text('#xp-fit')});
await check('custom bounds dialog',async()=>{await page.selectOption('#region','custom');await page.fill('#west','-92');await page.fill('#south','48');await page.fill('#east','-88');await page.fill('#north','51');await page.click('#bounds-form button[type=submit]');await page.waitForTimeout(300);return await text('#map-heading')});
await check('coordinate search form',async()=>{if(!await has('.coordinate-search'))return 'not present';await page.fill('.coordinate-search input:nth-of-type(1)','49.5');await page.fill('.coordinate-search input:nth-of-type(2)','-90');await page.click('.coordinate-search button');await page.waitForTimeout(300);return await text('#total')});
await check('mission buttons',async()=>{for(const id of ['mission-rain','mission-satellite']){await page.click('#'+id);await page.waitForTimeout(200)}return await page.$eval('#imagery-style',e=>e.value)});

// optional features: only checked when present
if(await has('#xp-search')){
  await check('place search',async()=>{await page.fill('#xp-search','Kenora');await page.keyboard.press('Enter');await page.waitForTimeout(600);const h=await text('#map-heading');return h+' · '+await text('#xp-search-status')});
  await check('legend + freshness strip',async()=>{const t=await text('#xp-legendbar');expect(t.length>20,'empty');return t.replace(/\n/g,' ').slice(0,120)});
  await check('coverage note',async()=>(await text('#xp-coverage')).slice(0,120));
  await check('timeline: chart bar selects day',async()=>{await page.selectOption('#region','world');await page.click('#clear');await page.waitForTimeout(300);await page.click('#chart .bar-col:nth-child(10)');await page.waitForTimeout(250);const l=await text('#replay-label');expect(await has('#chart .bar-col.xp-now'),'no highlight');return l});
  await check('before/after compare',async()=>{expect(await has('#xp-compare img'),'no images');await page.fill('#xp-cmp-a','2024-07-01');await page.dispatchEvent('#xp-cmp-a','change');await page.waitForTimeout(200);const src=await page.$eval('#xp-cmp-before',e=>e.src);expect(src.includes('2024-07-01'),'date not in url');const box=await page.$eval('#xp-cmp-range',e=>{e.value=30;e.dispatchEvent(new Event('input'));return getComputedStyle(document.getElementById('xp-cmp-clip')).width});return 'clip '+box});
  await check('save view + restore',async()=>{await page.fill('#xp-view-name','Test view');await page.click('#xp-view-save');await page.waitForTimeout(150);expect(await has('#xp-views [data-view]'),'not saved');await page.selectOption('#region','amazon');await page.waitForTimeout(200);await page.click('#xp-views [data-view]');await page.waitForTimeout(300);return await page.$eval('#region',e=>e.value)});
  await check('share link round trip',async()=>{await page.selectOption('#region','thunderbay');await page.selectOption('#sensor','VIIRS');await page.waitForTimeout(200);await page.click('#xp-share');await page.waitForTimeout(200);const url=await page.$eval('#xp-share-url',e=>e.value);expect(url.includes('?v='),'no query');const p2=await context.newPage();await p2.goto(url);await p2.waitForTimeout(900);const got=await p2.$eval('#region',e=>e.value)+'/'+await p2.$eval('#sensor',e=>e.value)+'/'+await p2.$eval('#data-mode',e=>e.value);await p2.close();await page.selectOption('#sensor','Combined');expect(got.startsWith('thunderbay/VIIRS'),got);return got});
  await check('fuel and weather card',async()=>{await page.click('#xp-fuel-load');await page.waitForTimeout(900);const t=await text('#xp-fuel-out');expect(/rain/i.test(t),'no rain stats: '+t.slice(0,60));return t.replace(/\n/g,' ').slice(0,150)});
  await check('missions progress',async()=>{const t=await text('#xp-missions');expect(/\d+\s*\/\s*\d+/.test(t),'no progress');return t.replace(/\n/g,' ').slice(0,120)});
}
await shot('fire');
await check('Earth Trends page',async()=>{await page.goto(base+'#trends');await page.waitForTimeout(900);const t=await text('#xp-verdict');expect(/per decade/.test(t),'no verdict');await page.click('#xp-qs button:nth-child(2)');await page.waitForTimeout(200);return (await text('#xp-ttitle'))});
await shot('trends');
await check('Radar preview + Street route',async()=>{await page.goto(base+'#radar');await page.waitForTimeout(200);const r=await text('#preview h1');await page.goto(base+'#street');await page.waitForTimeout(300);const s=await text('#street-view h1');await page.goto(base+'#fire');return r+' / '+s});
await check('large dataset render time',async()=>{
  await page.goto(base);await page.waitForTimeout(500);
  const rows=['latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type'];let s=3;const rnd=()=>((s=(s*16807)%2147483647)/2147483647);
  for(let i=0;i<120000;i++){const d=1+Math.floor(rnd()*28),m=6+Math.floor(rnd()*3);rows.push(`${(45+rnd()*12).toFixed(4)},${(-120+rnd()*50).toFixed(4)},330,1,1,2024-0${m}-${String(d).padStart(2,'0')},1830,${rnd()>.5?'Terra,MODIS,80':'N20,VIIRS,n'},6.1,290,${(rnd()*80).toFixed(1)},D,0`)}
  const t0=Date.now();await page.setInputFiles('#files',[{name:'big.csv',mimeType:'text/csv',buffer:Buffer.from(rows.join('\n'))}]);
  await page.waitForFunction(()=>/Imported/.test(document.getElementById('data-note').textContent),null,{timeout:60000});const load=Date.now()-t0;
  const tick=await page.evaluate(async()=>{const t=performance.now();document.querySelector('#days .day:nth-of-type(10)').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return Math.round(performance.now()-t)});
  return `import ${load} ms, day select ${tick} ms, ${await text('#scale-note')}`});
await check('phone width has no sideways scroll',async()=>{await page.setViewportSize({width:400,height:900});await page.goto(base);await page.selectOption('#data-mode','records');await page.waitForTimeout(600);const w=await page.evaluate(()=>document.documentElement.scrollWidth);await shot('phone');expect(w<=400,'scrollWidth '+w);return w+'px'});

await browser.close();server.close();
for(const [s,n,v] of results)console.log((s==='ok'?'  ok  ':' FAIL ')+n+(v?'  →  '+v:''));
console.log(errors.length?'\nConsole errors:\n'+[...new Set(errors)].join('\n'):'\nNo console errors.');
const failed=results.filter(r=>r[0]==='FAIL').length;
console.log(`\n${results.length-failed}/${results.length} checks passed`);
process.exit(failed||errors.length?1:0);
