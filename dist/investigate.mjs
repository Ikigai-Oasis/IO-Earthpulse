// IO earthpulse investigation tools. Additive: listens to events from app.js, never replaces its UI.
// Place search, legends + freshness, coverage warnings, synced timeline, before/after imagery,
// saved + shareable views, guided missions, weather + vegetation numbers, overflow marker canvas.
import {within,cellDays} from './engine.mjs';

const $=id=>document.getElementById(id);
const el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!==undefined)e.innerHTML=html;return e};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DAY=864e5;
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const today=()=>new Date().toISOString().slice(0,10);
const nice=date=>new Intl.DateTimeFormat('en-CA',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
const fire=(name,detail)=>window.dispatchEvent(new CustomEvent(name,{detail}));
const store={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};

let S=null;            // latest view state from app.js
let obs=[];            // latest observations
let cov=null,covKey='';// per-date sensor coverage for the current region
const monthLen=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
function bounds(){
  if(!S)return null;
  if(S.interval)return S.interval;
  if(S.selected)return [S.selected,S.selected];
  const p=S.year+'-'+String(S.month).padStart(2,'0');
  return [p+'-01',p+'-'+String(monthLen(S.year,S.month)).padStart(2,'0')];
}

/* ---------- mount ---------- */
function mount(){
  if($('xp-strip'))return;
  const workspace=document.querySelector('#fire .workspace');if(!workspace)return;
  const strip=el('div','xp-strip');strip.id='xp-strip';
  strip.innerHTML='<div id="xp-legendbar" class="xp-legendbar"></div><div id="xp-coverage" class="xp-coverage" role="status"></div>';
  workspace.before(strip);
  // place search next to the coordinate form
  const deck=document.querySelector('.mission-deck');
  if(deck){
    const form=el('form','coordinate-search xp-place');
    form.innerHTML='<input id="xp-search" type="search" placeholder="Search a place, e.g. Kenora or Jasper" aria-label="Search by place name" autocomplete="off"><button type="submit">Find place</button><span id="xp-search-status" role="status"></span>';
    deck.append(form);form.onsubmit=searchPlace;
  }
  // imagery date badge + overflow canvases
  const map=$('map');
  if(map){
    const badge=el('div','xp-imgdate');badge.id='xp-imgdate';map.append(badge);
    const globeCanvas=el('canvas','xp-overflow');globeCanvas.id='xp-overflow-globe';map.append(globeCanvas);
    const plane=document.querySelector('.map-plane');
    if(plane){const flat=el('canvas','xp-overflow');flat.id='xp-overflow-flat';plane.append(flat)}
  }
  // cards
  const host=el('div','xp xp2');host.id='xp2';
  ($('xp')??workspace).after(host);
  host.append(compareCard(),fuelCard(),missionsCard(),viewsCard());
  $('chart')?.addEventListener('click',e=>{
    const col=e.target.closest('.bar-col');if(!col||!S?.records||!$('reset-chart').hidden)return;
    const cols=[...$('chart').children];if(cols.length!==monthLen(S.year,S.month))return;
    fire('earthpulse:select-day',{date:S.year+'-'+String(S.month).padStart(2,'0')+'-'+String(cols.indexOf(col)+1).padStart(2,'0')});
  });
  renderViews();renderMissions();
}

/* ---------- 4. place search ---------- */
async function searchPlace(e){
  e.preventDefault();
  const q=$('xp-search').value.trim(),status=$('xp-search-status');if(!q)return;
  status.textContent='Searching…';
  try{
    const res=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(q),{headers:{Accept:'application/json'}});
    if(!res.ok)throw Error('HTTP '+res.status);
    const hit=(await res.json())[0];
    if(!hit){status.textContent='No place found for "'+q+'". Try a city, park or region name.';return}
    let [south,north,west,east]=hit.boundingbox.map(Number);
    const lat=+hit.lat,lon=+hit.lon,minSpan=3; // keep at least ~3° so nearby fires are in view
    if(north-south<minSpan){south=lat-minSpan/2;north=lat+minSpan/2}
    if(east-west<minSpan*1.5){west=lon-minSpan*.75;east=lon+minSpan*.75}
    const box={west:Math.max(-180,west),east:Math.min(180,east),south:Math.max(-90,south),north:Math.min(90,north)};
    const name=hit.display_name.split(',').slice(0,2).join(',').trim();
    fire('earthpulse:set-region',{box,label:name});
    status.innerHTML='Showing '+esc(name)+' · search © OpenStreetMap contributors';
    done('place');
    $('map-card')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){status.textContent='Place search is unavailable right now ('+err.message+'). Use coordinates instead.'}
}

/* ---------- 5 + 6. legend, freshness, coverage ---------- */
const LAYERS={
  terrain:['Blue Marble relief','static reference image, not dated'],
  truecolor:['MODIS Terra true colour','daily, ~250 m; what the eye would see, clouds included'],
  falsecolor:['MODIS false colour, bands 7-2-1','daily, ~500 m; vegetation green, burn scars red-brown, active fire bright orange'],
  rain:['IMERG precipitation rate','mm/hr, ~10 km; satellite estimate at one time step, not a daily total']
};
function coverage(){
  if(!S)return null;
  const key=obs.length+'|'+[S.region.west,S.region.south,S.region.east,S.region.north].join(',')+'|'+S.sample+'|'+(obs[0]?.date??'')+(obs.at(-1)?.date??'');
  if(key===covKey)return cov;
  covKey=key;const days=new Map();let min=null,max=null,allMin=null,allMax=null;
  for(const r of obs){
    if(!allMin||r.date<allMin)allMin=r.date;if(!allMax||r.date>allMax)allMax=r.date;
    if(!within(r.lat,r.lon,S.region))continue;
    days.set(r.date,(days.get(r.date)||0)|(r.sensor==='VIIRS'?2:1));
    if(!min||r.date<min)min=r.date;if(!max||r.date>max)max=r.date;
  }
  return cov={days,min,max,allMin,allMax};
}
function renderLegend(){
  const bar=$('xp-legendbar');if(!bar||!S)return;
  const [name,note]=LAYERS[S.imagery]??LAYERS.terrain,parts=[];
  parts.push(`<span><b>Imagery</b> ${esc(name)} · ${esc(note)}</span>`);
  if(S.records){
    const metric=$('metric')?.value==='frp'?'peak fire radiative power (MW)':'number of days observed';
    parts.push(`<span><i class="xp-dot"></i><b>Marker</b> one ~2 km grid cell with a detection · size = ${metric}</span>`);
    parts.push('<span><b>Sensors</b> MODIS 1 km pixels · VIIRS 375 m pixels</span>');
    const c=coverage(),src=S.sample?'Simulated demo records':S.firmsConnected?'NASA FIRMS feed':'Imported FIRMS CSV';
    if(c?.allMax){const age=Math.round((Date.parse(today())-Date.parse(c.allMax))/DAY);
      parts.push(`<span class="${S.sample?'xp-warn':age>7?'':'xp-fresh'}"><b>Freshness</b> ${src} · through ${nice(c.allMax)}${S.sample?'':age<=0?' (today)':` (${age} day${age===1?'':'s'} ago)`}</span>`)}
  }else{
    parts.push('<span><i class="xp-dot red"></i><b>Overlay</b> NASA thermal anomalies: MODIS 1 km, VIIRS 375 m</span>');
    parts.push(`<span class="xp-fresh"><b>Freshness</b> ${S.mode==='date'&&S.date?'requested date '+nice(S.date)+' UTC':'latest imagery NASA has published; each sensor updates at a different time'}</span>`);
  }
  bar.innerHTML=parts.join('');
  const b=bounds(),badge=$('xp-imgdate');
  if(badge)badge.textContent=(LAYERS[S.imagery]??LAYERS.terrain)[0]+(S.imagery==='terrain'?' · static':S.records?' · '+(S.selected??b?.[1]??''):S.mode==='date'&&S.date?' · '+S.date:' · latest')+(window.earthpulse?.detail>1?' · high detail':'');
}
function renderCoverage(){
  const box=$('xp-coverage');if(!box||!S)return;
  if(!S.records){box.textContent='';box.hidden=true;return}
  box.hidden=false;const c=coverage(),b=bounds();
  // mark calendar days that fall outside the loaded range
  const prefix=S.year+'-'+String(S.month).padStart(2,'0')+'-';
  [...document.querySelectorAll('#days .day')].forEach((btn,i)=>{
    const date=prefix+String(i+1).padStart(2,'0'),outside=!c?.allMin||date<c.allMin||date>c.allMax;
    btn.classList.toggle('xp-unloaded',outside);
    if(outside)btn.title=nice(date)+': not in the loaded data';
  });
  if(!c?.allMin){box.innerHTML='<b>No records loaded.</b> Import FIRMS CSVs or load a feed.';return}
  let empty=0,single=0,outside=0,total=0;
  for(let d=b[0];d<=b[1];d=addDays(d,1)){total++;
    if(d<c.allMin||d>c.allMax){outside++;continue}
    const f=c.days.get(d);if(!f)empty++;else if(f!==3)single++}
  const msgs=[];
  if(outside)msgs.push(`<b>${outside} of ${total} day${total===1?'':'s'} ${outside===1&&total===1?'is':'are'} outside the loaded data</b> (${nice(c.allMin)} – ${nice(c.allMax)}). These are not "no fire" days.`);
  if(empty)msgs.push(`${empty} day${empty===1?' has':'s have'} no records in this region. That can mean no fire, cloud cover, or no satellite pass.`);
  if(single)msgs.push(`${single} day${single===1?' was':'s were'} seen by only one instrument.`);
  if(!msgs.length)msgs.push(`Both instruments reported on every day of this selection (${total} day${total===1?'':'s'}).`);
  box.innerHTML=(outside?'⚠ ':'')+msgs.join(' ');box.classList.toggle('xp-alert',outside>0);
}

/* ---------- 2. synced timeline ---------- */
function syncTimeline(){
  const cols=[...($('chart')?.children??[])];
  cols.forEach(c=>c.classList.remove('xp-now'));
  if(!S?.records||!$('reset-chart')?.hidden||cols.length!==monthLen(S.year,S.month))return;
  $('chart').classList.add('xp-clickable');
  if(S.selected&&S.selected.startsWith(S.year+'-'+String(S.month).padStart(2,'0')))cols[+S.selected.slice(8)-1]?.classList.add('xp-now');
}

/* ---------- 3. before / after ---------- */
let cmpEdited=false,cmpKey='';
function compareCard(){
  const card=el('article','card xp-card xp2-wide');card.id='xp-compare';
  card.innerHTML=`<div class="card-head"><div><h2>Before / after</h2><p>Drag the divider to compare NASA imagery of this region on two dates.</p></div>
  <div class="xp-cmp-controls"><label>Before <input type="date" id="xp-cmp-a"></label><label>After <input type="date" id="xp-cmp-b"></label>
  <select id="xp-cmp-layer" aria-label="Comparison layer"><option value="MODIS_Terra_CorrectedReflectance_TrueColor">True colour</option><option value="MODIS_Terra_CorrectedReflectance_Bands721">False colour 7-2-1 (burn scars)</option></select>
  <button id="xp-cmp-sync" type="button">Use selection</button></div></div>
  <div class="xp-cmp-stage" id="xp-cmp-stage"><img id="xp-cmp-after" alt="After image"><div id="xp-cmp-clip"><img id="xp-cmp-before" alt="Before image"></div>
  <span class="xp-cmp-tag left" id="xp-cmp-ta"></span><span class="xp-cmp-tag right" id="xp-cmp-tb"></span><i id="xp-cmp-line"></i>
  <input type="range" id="xp-cmp-range" min="0" max="100" value="50" aria-label="Before and after divider"></div>
  <div class="card-foot"><span id="xp-cmp-note">MODIS Terra daily imagery via NASA GIBS. Clouds and missing swaths appear as white or blank areas.</span></div>`;
  const q=s=>card.querySelector(s);
  q('#xp-cmp-range').oninput=e=>{card.style.setProperty('--p',e.target.value+'%');done('compare')};
  for(const id of ['#xp-cmp-a','#xp-cmp-b'])q(id).onchange=()=>{cmpEdited=true;drawCompare()};
  q('#xp-cmp-layer').onchange=drawCompare;
  q('#xp-cmp-sync').onclick=()=>{cmpEdited=false;cmpKey='';syncCompare()};
  for(const id of ['#xp-cmp-before','#xp-cmp-after'])q(id).onload=e=>e.target.classList.remove('xp-failed');
  for(const id of ['#xp-cmp-before','#xp-cmp-after'])q(id).onerror=e=>{e.target.classList.add('xp-failed');q('#xp-cmp-note').textContent='Imagery could not be loaded for one of these dates. Try dates at least 2 days in the past.'};
  card.style.setProperty('--p','50%');
  return card;
}
function syncCompare(){
  if(!S||!$('xp-cmp-a'))return;
  const b=bounds(),max=addDays(today(),-1);
  const key=[S.region.west,S.region.south,S.region.east,S.region.north,S.records?b.join():S.date].join('|');
  if(key===cmpKey)return;cmpKey=key;
  $('xp-cmp-a').max=$('xp-cmp-b').max=today();
  if(!cmpEdited){
    let after=S.records?b[1]:(S.date||max),before=S.records?addDays(b[0],-1):addDays(after,-14);
    if(after>max)after=max;if(before>=after)before=addDays(after,-14);
    $('xp-cmp-a').value=before;$('xp-cmp-b').value=after;
  }
  drawCompare();
}
function drawCompare(){
  const a=$('xp-cmp-a').value,b=$('xp-cmp-b').value,layer=$('xp-cmp-layer').value;
  if(!a||!b||!S||!window.earthpulse)return;
  const r=S.region,ratio=Math.max(1,Math.min(3,(r.east-r.west)/(r.north-r.south)));
  $('xp-cmp-stage').style.aspectRatio=ratio;
  const base='BlueMarble_ShadedRelief_Bathymetry';
  $('xp-cmp-before').src=window.earthpulse.gibsUrl(r,[base,layer],a);
  $('xp-cmp-after').src=window.earthpulse.gibsUrl(r,[base,layer],b);
  $('xp-cmp-ta').textContent='Before · '+nice(a);$('xp-cmp-tb').textContent='After · '+nice(b);
  $('xp-cmp-note').textContent='MODIS Terra daily imagery via NASA GIBS. Clouds and missing swaths appear as white or blank areas.';
}

/* ---------- 7. saved + shareable views ---------- */
const VIEWS='earthpulse.views';
function snapshot(){
  const s=window.earthpulse.state();
  const v={mode:s.mode,sensor:s.sensor,imagery:s.imagery,globe:s.globe,year:s.year,month:s.month};
  if(s.regionKey==='custom')v.region=s.region;else v.regionKey=s.regionKey;
  if(s.selected)v.selected=s.selected;if(s.interval)v.interval=s.interval;if(s.mode==='date'&&s.date)v.date=s.date;
  return v;
}
const encode=v=>btoa(unescape(encodeURIComponent(JSON.stringify(v)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=t=>{try{return JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g,'+').replace(/_/g,'/')))))}catch{return null}};
function viewsCard(){
  const card=el('article','card xp-card');card.id='xp-viewscard';
  card.innerHTML=`<div class="card-head"><div><h2>Saved views</h2><p>Keep a place and date to return to, or copy a link that opens this exact view.</p></div></div>
  <div class="xp-views-body"><form id="xp-view-form" class="xp-row"><input id="xp-view-name" placeholder="Name this view" aria-label="View name" maxlength="40"><button id="xp-view-save" type="submit">Save view</button><button id="xp-share" type="button">Copy link</button></form>
  <input id="xp-share-url" readonly hidden aria-label="Shareable link"><p id="xp-share-status" role="status"></p><div id="xp-views" class="xp-views"></div>
  <p class="xp-small">Saved on this device only. Links restore the place, dates, sensor and imagery; imported CSV files are not included.</p></div>`;
  card.querySelector('#xp-view-form').onsubmit=e=>{
    e.preventDefault();const input=$('xp-view-name'),s=window.earthpulse.state();
    const name=input.value.trim()||($('map-heading')?.textContent.replace(' explorer','')??'View')+' · '+(s.selected??s.year+'-'+String(s.month).padStart(2,'0'));
    const list=store.get(VIEWS,[]).filter(x=>x.name!==name);list.unshift({name,view:snapshot()});store.set(VIEWS,list.slice(0,12));
    input.value='';renderViews();done('save');
  };
  card.querySelector('#xp-share').onclick=async()=>{
    const url=location.origin+location.pathname+'?v='+encode(snapshot())+'#fire',box=$('xp-share-url');
    box.hidden=false;box.value=url;
    try{await navigator.clipboard.writeText(url);$('xp-share-status').textContent='Link copied.'}
    catch{box.select();$('xp-share-status').textContent='Select the link above and copy it.'}
    done('save');
  };
  card.querySelector('#xp-views').onclick=e=>{
    const del=e.target.closest('[data-del]'),open=e.target.closest('[data-view]');
    const list=store.get(VIEWS,[]);
    if(del){list.splice(+del.dataset.del,1);store.set(VIEWS,list);renderViews();return}
    if(open&&list[+open.dataset.view]){fire('earthpulse:apply-view',list[+open.dataset.view].view);$('map-card')?.scrollIntoView({behavior:'smooth',block:'start'})}
  };
  return card;
}
function renderViews(){
  const box=$('xp-views');if(!box)return;const list=store.get(VIEWS,[]);
  box.innerHTML=list.length?list.map((x,i)=>`<span class="xp-view"><button type="button" data-view="${i}">${esc(x.name)}</button><button type="button" data-del="${i}" aria-label="Delete ${esc(x.name)}">×</button></span>`).join(''):'<span class="xp-small">No saved views yet.</span>';
}

/* ---------- 9. guided missions ---------- */
const MISSIONS=[
  {id:'replay',title:'Replay a fire season',badge:'🎞',steps:[['records','Open hotspot records (Replay records or FIRMS)'],['play','Press ▶ to play the timeline'],['week','Run "Find peak week"'],['hotspot','Open a hotspot to read its evidence']]},
  {id:'sensors',title:'Compare the satellites',badge:'🛰',steps:[['sensor','Switch the instrument to MODIS or VIIRS'],['compareSensors','Run "Compare sensors"'],['history','Open a month from the Fire history calendar'],['detective','Finish a Fire Detective investigation']]},
  {id:'cause',title:'Investigate the conditions',badge:'🔎',steps:[['place','Find a place by name or coordinates'],['sharp','Open Sharp zoom and zoom in on a hotspot'],['compare','Drag the Before / after divider'],['fuel','Analyze weather and vegetation'],['trend','Test a climate trend in Earth Trends'],['save','Save or share your view']]}
];
const MKEY='earthpulse.missions';
let progress=new Set(store.get(MKEY,[]));
function done(step){
  if(progress.has(step))return;progress.add(step);store.set(MKEY,[...progress]);renderMissions(step);
}
function missionsCard(){
  const card=el('article','card xp-card');card.id='xp-missions';
  card.innerHTML='<div class="card-head"><div><h2>Guided missions</h2><p>Steps tick off as you do them in the app.</p></div><span class="edition" id="xp-mtotal"></span></div><div class="xp-missions-body" id="xp-mbody"></div>';
  return card;
}
function renderMissions(justDone){
  const body=$('xp-mbody');if(!body)return;
  const all=MISSIONS.flatMap(m=>m.steps),n=all.filter(s=>progress.has(s[0])).length;
  $('xp-mtotal').textContent=n+' / '+all.length+' STEPS';
  body.innerHTML=`<div class="xp-mbar"><i style="width:${n/all.length*100}%"></i></div>`+MISSIONS.map(m=>{
    const k=m.steps.filter(s=>progress.has(s[0])).length,complete=k===m.steps.length;
    return `<details ${complete?'':'open'} class="xp-mission${complete?' complete':''}"><summary><span class="xp-mbadge${complete?'':' locked'}" aria-hidden="true">${m.badge}</span><b>${m.title}</b><small>${complete?'Badge earned':k+' / '+m.steps.length}</small></summary><ol>${m.steps.map(s=>`<li class="${progress.has(s[0])?'on':''}${s[0]===justDone?' new':''}">${s[1]}</li>`).join('')}</ol></details>`;
  }).join('')+`<div class="xp-row"><button type="button" id="xp-mreset">Reset progress</button>${n===all.length?'<b class="xp-allclear">All missions complete. You are a Fire Intelligence analyst.</b>':''}</div>`;
  $('xp-mreset').onclick=()=>{progress=new Set();store.set(MKEY,[]);renderMissions()};
}
document.addEventListener('click',e=>{
  const t=e.target;if(!t.closest)return;
  if(t.closest('#play'))done('play');
  if(t.closest('[data-analysis="week"]'))done('week');
  if(t.closest('[data-analysis="sensors"]'))done('compareSensors');
  if(t.closest('.hot'))done('hotspot');
  if(t.closest('#xp-cal td[data-y]'))done('history');
  if(t.closest('.coordinate-search:not(.xp-place) button'))done('place');
},true);
document.addEventListener('change',e=>{if(e.target.id==='sensor'&&e.target.value!=='Combined')done('sensor')},true);
window.addEventListener('earthpulse:mission',e=>done(e.detail));

/* ---------- 10. weather + vegetation numbers ---------- */
function fuelCard(){
  const card=el('article','card xp-card xp2-wide');card.id='xp-fuel';
  card.innerHTML=`<div class="card-head"><div><h2>Fuel and weather</h2><p>Daily rain, heat and humidity for the centre of this region, set against hotspot activity. Numbers, not just overlays.</p></div>
  <button id="xp-fuel-load" type="button">Analyze this selection</button></div><div id="xp-fuel-out" class="xp-fuel-out"><p class="xp-small">Pick a region and a month or range in hotspot records, then analyze. Uses NASA POWER daily data and MODIS vegetation greenness (NDVI).</p></div>
  <div class="card-foot"><span>Weather: NASA POWER daily point data (~50 km grid). Vegetation: MODIS MOD13Q1 NDVI, 250 m, 16-day, via ORNL DAAC. Point values describe the region centre only.</span></div>`;
  card.querySelector('#xp-fuel-load').onclick=runFuel;
  return card;
}
const ymd=d=>d.replace(/-/g,'');
async function runFuel(){
  const out=$('xp-fuel-out');if(!S)return;
  if(!S.records){out.innerHTML='<p>Switch the data view to <b>Replay records</b> or load FIRMS records first. This analysis compares weather with hotspot counts.</p>';return}
  const b=bounds(),r=S.region;
  if(r.east-r.west>60){out.innerHTML='<p>Choose a smaller region first (for example Thunder Bay, or search a place). One weather point cannot describe an area this large.</p>';return}
  const lat=(r.south+r.north)/2,lon=(r.west+r.east)/2,start=addDays(b[0],-30);
  let end=b[1];const latest=addDays(today(),-3);if(end>latest)end=latest;
  if(end<b[0]){out.innerHTML='<p>NASA POWER daily data is published a few days behind. Choose dates at least 3 days in the past.</p>';return}
  out.innerHTML='<p>Loading NASA POWER daily weather…</p>';
  let P;
  try{
    const res=await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M_MAX,RH2M,WS2M&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=${ymd(start)}&end=${ymd(end)}&format=JSON`);
    if(!res.ok)throw Error('HTTP '+res.status);
    P=(await res.json())?.properties?.parameter;if(!P?.PRECTOTCORR)throw Error('no data returned');
  }catch(err){out.innerHTML='<p>NASA POWER could not be reached ('+esc(err.message)+'). Check your connection and try again.</p>';return}
  const val=(v,d)=>{const x=P[v]?.[ymd(d)];return x===undefined||x===-999?NaN:x};
  // hotspot cell-days per date
  const counts=new Map();
  for(const c of cellDays(obs.filter(o=>o.date>=b[0]&&o.date<=b[1]&&within(o.lat,o.lon,r))))counts.set(c.date,(counts.get(c.date)||0)+1);
  const days=[];for(let d=b[0];d<=end;d=addDays(d,1))days.push({d,rain:val('PRECTOTCORR',d),tmax:val('T2M_MAX',d),rh:val('RH2M',d),wind:val('WS2M',d),fire:counts.get(d)||0});
  const sum=a=>a.filter(Number.isFinite).reduce((x,y)=>x+y,0),mean=a=>{const f=a.filter(Number.isFinite);return f.length?sum(f)/f.length:NaN};
  let before=0,beforeN=0;for(let d=start;d<b[0];d=addDays(d,1)){const x=val('PRECTOTCORR',d);if(Number.isFinite(x)){before+=x;beforeN++}}
  const peak=days.reduce((a,x)=>x.fire>a.fire?x:a,days[0]);
  let dry=null;if(peak.fire>0){dry=0;for(let d=peak.d;d>=start;d=addDays(d,-1)){const x=val('PRECTOTCORR',d);if(!Number.isFinite(x))continue;if(x>=1)break;dry++}}
  const rainTotal=sum(days.map(x=>x.rain)),fireTotal=sum(days.map(x=>x.fire));
  const dryDays=days.filter(x=>x.rain<1),wetDays=days.filter(x=>x.rain>=1);
  const f1=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'–';
  let html=`<div class="xp-fuel-kpis">
    <div><span>Rain in selection</span><strong>${f1(rainTotal)} mm</strong><small>${days.length} days, ${wetDays.length} with ≥ 1 mm</small></div>
    <div><span>Rain in the 30 days before</span><strong>${beforeN?f1(before)+' mm':'–'}</strong><small id="xp-fuel-normal">comparing with the long-term normal…</small></div>
    <div><span>Dry spell before peak</span><strong>${dry===null?'–':dry+' day'+(dry===1?'':'s')}</strong><small>${peak.fire?'peak '+nice(peak.d)+': '+peak.fire+' cell-days':'no hotspots in selection'}</small></div>
    <div><span>Peak-day weather</span><strong>${f1(peak.tmax)} °C</strong><small>max temp · humidity ${f1(peak.rh,0)}% · wind ${f1(peak.wind)} m/s</small></div></div>`;
  html+=fuelChart(days);
  if(fireTotal>0&&dryDays.length&&wetDays.length)html+=`<p>Dry days (under 1 mm of rain) averaged <b>${f1(mean(dryDays.map(x=>x.fire)))}</b> hotspot cell-days; wet days averaged <b>${f1(mean(wetDays.map(x=>x.fire)))}</b>. This is an association in one season, not proof of cause.</p>`;
  html+='<div id="xp-ndvi" class="xp-ndvi"><p class="xp-small">Loading vegetation greenness (NDVI)…</p></div>';
  out.innerHTML=html;done('fuel');
  loadNormal(lat,lon,start,b[0],before,beforeN);loadNdvi(lat,lon,addDays(b[0],-48),addDays(end,16));
}
function fuelChart(days){
  const W=Math.max(320,($('xp-fuel-out').clientWidth||800)-28),H=220,P={l:40,r:40,t:14,b:24},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const maxR=Math.max(5,...days.map(x=>x.rain||0)),maxF=Math.max(1,...days.map(x=>x.fire)),bw=iw/days.length;
  const x=i=>P.l+(i+.5)*bw,yR=v=>P.t+v/maxR*ih*.5,yF=v=>P.t+ih-v/maxF*ih*.62;
  const rain=days.map((d,i)=>Number.isFinite(d.rain)?`<rect x="${x(i)-bw*.34}" y="${P.t}" width="${bw*.68}" height="${Math.max(0,yR(d.rain)-P.t)}" fill="#6fb1ff" opacity=".8"><title>${d.d}: ${d.rain.toFixed(1)} mm rain</title></rect>`:`<rect x="${x(i)-bw*.34}" y="${P.t}" width="${bw*.68}" height="4" fill="#555"><title>${d.d}: rain not available</title></rect>`).join('');
  const fires=days.map((d,i)=>`<rect x="${x(i)-bw*.34}" y="${yF(d.fire)}" width="${bw*.68}" height="${P.t+ih-yF(d.fire)}" fill="var(--orange)" opacity=".9"><title>${d.d}: ${d.fire} hotspot cell-days, max ${Number.isFinite(d.tmax)?d.tmax.toFixed(1)+' °C':'n/a'}</title></rect>`).join('');
  const step=Math.ceil(days.length/(W/70));
  return `<svg class="xp-fuel-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Daily rain and hotspot activity">
    <line x1="${P.l}" x2="${W-P.r}" y1="${P.t+ih}" y2="${P.t+ih}" stroke="var(--line)"/>${rain}${fires}
    ${days.map((d,i)=>i%step?'':`<text x="${x(i)}" y="${H-7}" text-anchor="middle">${d.d.slice(5)}</text>`).join('')}
    <text x="${P.l-6}" y="${P.t+9}" text-anchor="end">rain</text><text x="${P.l-6}" y="${yR(maxR)+3}" text-anchor="end">${maxR.toFixed(0)} mm</text>
    <text x="${W-P.r+6}" y="${yF(maxF)+4}">${maxF}</text><text x="${W-P.r+6}" y="${P.t+ih}">fires</text></svg>
    <div class="xp-fuel-key"><span><i style="background:#6fb1ff"></i>Daily rain, mm (hanging from top)</span><span><i style="background:var(--orange)"></i>Hotspot cell-days</span></div>`;
}
async function loadNormal(lat,lon,from,to,before,n){
  const box=$('xp-fuel-normal');if(!box)return;
  try{
    const res=await fetch(`https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&format=JSON`);
    if(!res.ok)throw 0;const clim=(await res.json())?.properties?.parameter?.PRECTOTCORR;if(!clim)throw 0;
    const names=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];let normal=0;
    for(let d=from;d<to;d=addDays(d,1)){const v=clim[names[+d.slice(5,7)-1]];if(!Number.isFinite(v)||v<0)throw 0;normal+=v}
    if(!n||!normal)throw 0;const pct=Math.round(before/normal*100);
    box.innerHTML=`<b class="${pct<70?'xp-dry':pct>130?'xp-wet':''}">${pct}% of normal</b> (${normal.toFixed(0)} mm usual)`;
  }catch{box.textContent='long-term normal unavailable'}
}
async function loadNdvi(lat,lon,from,to){
  const box=$('xp-ndvi');if(!box)return;
  const doy=d=>{const t=new Date(d+'T00:00:00Z');return 'A'+t.getUTCFullYear()+String(Math.floor((t-Date.UTC(t.getUTCFullYear(),0,0))/DAY)).padStart(3,'0')};
  try{
    const res=await fetch(`https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&band=250m_16_days_NDVI&startDate=${doy(from)}&endDate=${doy(to)}&kmAboveBelow=0&kmLeftRight=0`,{headers:{Accept:'application/json'}});
    if(!res.ok)throw Error('HTTP '+res.status);
    const json=await res.json(),scale=Number(json.scale)||.0001;
    const pts=(json.subset||[]).map(s=>({d:s.calendar_date,v:s.data?.[0]*scale})).filter(p=>Number.isFinite(p.v)&&p.v>-.2&&p.v<=1);
    if(pts.length<2)throw Error('no valid NDVI values');
    const first=pts[0],last=pts.at(-1),lo=pts.reduce((a,p)=>p.v<a.v?p:a),delta=last.v-first.v;
    const W=260,H=54,x=i=>6+i/(pts.length-1)*(W-12),y=v=>H-6-(v-0)/(1-0)*(H-12);
    box.innerHTML=`<div class="xp-ndvi-row"><div><span>Vegetation greenness (NDVI)</span><strong>${first.v.toFixed(2)} → ${last.v.toFixed(2)}</strong><small>${nice(first.d)} to ${nice(last.d)} · ${delta<-.05?'greenness fell, consistent with drying or burning':delta>.05?'greenness rose':'little change'} · lowest ${lo.v.toFixed(2)} on ${nice(lo.d)}</small></div>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="NDVI over time"><polyline points="${pts.map((p,i)=>x(i)+','+y(p.v)).join(' ')}" fill="none" stroke="var(--green)" stroke-width="2"/>${pts.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="var(--green)"><title>${p.d}: NDVI ${p.v.toFixed(2)}</title></circle>`).join('')}</svg></div>
    <p class="xp-small">NDVI runs from about 0 (bare ground, water, snow) to 0.9 (dense green vegetation). One 250 m pixel at the region centre.</p>`;
  }catch(err){box.innerHTML='<p class="xp-small">Vegetation greenness (NDVI) is unavailable right now ('+esc(err.message||'request failed')+'). The weather numbers above are unaffected.</p>'}
}

/* ---------- 8. overflow markers on canvas ---------- */
function drawOverflow(){
  const pts=window.earthpulse?.overflow??[],globe=S?.globe,show=S?.records&&pts.length;
  const g=$('xp-overflow-globe'),f=$('xp-overflow-flat');if(!g||!f)return;
  for(const [canvas,active] of [[g,show&&globe],[f,show&&!globe]]){
    canvas.hidden=!active;if(!active)continue;
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)continue;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(255,155,101,.75)';
    const r=S.region;
    for(const [lon,lat] of pts){
      let x,y;
      if(globe){const p=window.earthpulse.project(lon,lat);if(!p)continue;x=p.x;y=p.y}
      else{x=(lon-r.west)/(r.east-r.west)*w;y=(r.north-lat)/(r.north-r.south)*h;if(x<0||x>w||y<0||y>h)continue}
      ctx.fillRect(x-1.5,y-1.5,3,3);
    }
  }
}

/* ---------- wiring ---------- */
function refresh(){mount();renderLegend();renderCoverage();syncTimeline();syncCompare();drawOverflow()}
window.addEventListener('earthpulse:render',e=>{const {observations,...state}=e.detail;S=state;obs=observations;if(S.records)done('records');refresh()});
window.addEventListener('earthpulse:state',e=>{S=e.detail;if(!S.records)refresh()});
window.addEventListener('earthpulse:frame',drawOverflow);
window.addEventListener('earthpulse:ready',()=>{
  mount();
  const token=new URLSearchParams(location.search).get('v'),view=token&&decode(token);
  if(view&&typeof view==='object')fire('earthpulse:apply-view',view);
});
$('metric')?.addEventListener('change',renderLegend);
