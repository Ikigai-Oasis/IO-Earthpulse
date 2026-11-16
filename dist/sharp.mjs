// Sharp zoom: a tiled, street-level map inside the explorer card.
// Base imagery: Google satellite (optional key), Esri World Imagery, or dated NASA GIBS layers.
// Overlays: loaded hotspot cells, NASA smoke (aerosol), NASA EONET named wildfire events, place labels.
import {within,cellDays} from './engine.mjs';
import {GOOGLE_MAPS_KEY} from './config.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DAY=864e5;
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const today=()=>new Date().toISOString().slice(0,10);
const gibs=(layer,level,ext)=>date=>`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;

// Each base layer: label, tile URL builder (date) => url, native max zoom, whether it is dated, credit, note.
const BASES={
  esri:{label:'Sharp satellite (Esri, about 0.5 m)',url:()=>'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',max:19,credit:'Imagery © Esri, Maxar, Earthstar Geographics',note:'Sharpest view. A mosaic of recent years, so it does not show the selected date.'},
  hls:{label:'NASA HLS Sentinel-2, 30 m (dated)',url:gibs('HLS_S30_Nadir_BRDF_Adjusted_Reflectance',12,'png'),max:12,dated:true,credit:'NASA GIBS · Harmonized Landsat Sentinel-2',note:'30 m imagery for the chosen date. Each place is revisited every few days, so some dates are blank or cloudy.'},
  landsat:{label:'NASA HLS Landsat, 30 m (dated)',url:gibs('HLS_L30_Nadir_BRDF_Adjusted_Reflectance',12,'png'),max:12,dated:true,credit:'NASA GIBS · Harmonized Landsat Sentinel-2',note:'30 m Landsat imagery for the chosen date. Revisit is about 8 days, so many dates are blank.'},
  truecolor:{label:'NASA MODIS true colour, 250 m (daily)',url:gibs('MODIS_Terra_CorrectedReflectance_TrueColor',9,'jpg'),max:9,dated:true,credit:'NASA GIBS · MODIS Terra',note:'Daily view of the chosen date. Smoke plumes and clouds are visible; detail stops at about 250 m.'},
  falsecolor:{label:'NASA MODIS false colour 7-2-1 (daily)',url:gibs('MODIS_Terra_CorrectedReflectance_Bands721',9,'jpg'),max:9,dated:true,credit:'NASA GIBS · MODIS Terra',note:'Burn scars show red-brown, vegetation green, active fire bright orange.'}
};
const SMOKE=gibs('MODIS_Terra_Aerosol',6,'png');
const LABELS='https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

let S=null,obs=[],L=null,map=null,open=false,baseLayer=null,labelLayer=null,smokeLayer=null,spots=null,events=null,canvasRenderer=null;
let googleSession=null,googleKey=GOOGLE_MAPS_KEY,dateEdited=false,fitKey='',eventKey='';

function bounds(){
  if(S.interval)return S.interval;
  if(S.selected)return [S.selected,S.selected];
  const p=S.year+'-'+String(S.month).padStart(2,'0');
  return [p+'-01',p+'-'+String(new Date(Date.UTC(S.year,S.month,0)).getUTCDate()).padStart(2,'0')];
}
function defaultDate(){
  let d=S?.records?(S.selected??bounds()[1]):(S?.mode==='date'&&S.date?S.date:addDays(today(),-1));
  const latest=addDays(today(),-1);return d>latest?latest:d;
}

function loadLeaflet(){
  if(window.L)return Promise.resolve(window.L);
  return new Promise((resolve,reject)=>{
    const css=document.createElement('link');css.rel='stylesheet';css.href='vendor/leaflet.css';document.head.append(css);
    const script=document.createElement('script');script.src='vendor/leaflet.js';
    script.onload=()=>resolve(window.L);script.onerror=()=>reject(Error('The map library could not load.'));
    document.head.append(script);
  });
}
async function resolveGoogleKey(){
  if(googleKey)return googleKey;
  try{const res=await fetch('/api/maps-config');if(res.ok)googleKey=(await res.json()).key||''}catch{}
  return googleKey;
}
async function googleLayer(){
  const key=await resolveGoogleKey();if(!key)throw Error('No Google key is configured.');
  if(!googleSession||googleSession.expiry*1000<Date.now()+60000){
    const res=await fetch('https://tile.googleapis.com/v1/createSession?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mapType:'satellite',language:'en-US',region:'CA'})});
    if(!res.ok)throw Error('Google rejected the key (HTTP '+res.status+'). Check that Map Tiles API is enabled and the website restriction matches this site.');
    googleSession=await res.json();
  }
  return L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${googleSession.session}&key=${encodeURIComponent(key)}`,{maxNativeZoom:21,maxZoom:21,attribution:'Imagery © Google'});
}
async function googleCredit(){
  if(!map||$('xp-sharp-base').value!=='google'||!googleSession)return;
  const b=map.getBounds();
  try{
    const res=await fetch('https://tile.googleapis.com/tile/v1/viewport?'+new URLSearchParams({session:googleSession.session,key:googleKey,zoom:map.getZoom(),north:b.getNorth(),south:b.getSouth(),east:b.getEast(),west:b.getWest()}));
    if(res.ok){const {copyright}=await res.json();if(copyright)$('xp-sharp-credit').textContent='Google · '+copyright}
  }catch{}
}

function build(){
  const host=$('map');if(!host||$('xp-sharp'))return;
  const tools=document.querySelector('.map-tools');
  const button=document.createElement('button');button.id='xp-sharp-toggle';button.type='button';button.textContent='Sharp zoom';button.setAttribute('aria-pressed','false');
  button.title='Street-level satellite map with NASA layers';
  tools?.prepend(button);button.onclick=()=>toggle();
  const panel=document.createElement('div');panel.id='xp-sharp';panel.hidden=true;
  panel.innerHTML=`<div id="xp-sharp-map" aria-label="High-resolution map"></div>
  <div class="xp-sharp-panel">
    <label>Imagery <select id="xp-sharp-base"><option value="google" hidden>Google satellite</option>${Object.entries(BASES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label>
    <label id="xp-sharp-date-label">Date <input type="date" id="xp-sharp-date"></label>
    <label class="xp-check"><input type="checkbox" id="xp-sharp-labels" checked> Place names</label>
    <label class="xp-check"><input type="checkbox" id="xp-sharp-smoke"> NASA smoke (aerosol)</label>
    <label class="xp-check"><input type="checkbox" id="xp-sharp-events"> NASA named fires (EONET)</label>
    <button type="button" id="xp-sharp-close">Back to globe</button>
  </div>
  <div class="xp-sharp-note"><span id="xp-sharp-status" role="status"></span><span id="xp-sharp-credit"></span></div>`;
  host.append(panel);
  $('xp-sharp-base').value='esri';
  // keep the globe's drag and scroll handlers from firing underneath
  for(const type of ['pointerdown','wheel','dblclick','click'])panel.addEventListener(type,e=>e.stopPropagation());
  $('xp-sharp-close').onclick=()=>toggle(false);
  $('xp-sharp-base').onchange=setBase;
  $('xp-sharp-date').onchange=()=>{dateEdited=true;setBase();setSmoke()};
  $('xp-sharp-labels').onchange=setLabels;
  $('xp-sharp-smoke').onchange=setSmoke;
  $('xp-sharp-events').onchange=()=>{eventKey='';loadEvents()};
}
async function toggle(state=!open){
  build();open=state;
  $('xp-sharp').hidden=!open;$('xp-sharp-toggle').setAttribute('aria-pressed',open);
  $('map').classList.toggle('xp-sharp-open',open);
  if(!open)return;
  const status=$('xp-sharp-status');
  try{L=await loadLeaflet()}catch(err){status.textContent=err.message+' Check your connection.';return}
  if(!map){
    canvasRenderer=L.canvas({padding:.3});
    map=L.map('xp-sharp-map',{zoomControl:true,worldCopyJump:true,minZoom:2,maxZoom:19,preferCanvas:true});
    spots=L.layerGroup().addTo(map);events=L.layerGroup().addTo(map);
    L.control.scale({imperial:false}).addTo(map);
    map.on('moveend',()=>{googleCredit();loadEvents()});
    if(await resolveGoogleKey()){const opt=$('xp-sharp-base').querySelector('[value=google]');opt.hidden=false;$('xp-sharp-base').value='google'}
    fitKey='';
  }
  setTimeout(()=>map.invalidateSize(),0);
  sync(true);
  window.dispatchEvent(new CustomEvent('earthpulse:mission',{detail:'sharp'}));
}
function sync(force){
  if(!open||!map||!S)return;
  const r=S.region,key=[r.west,r.south,r.east,r.north].join();
  if(key!==fitKey){fitKey=key;
    if(r.east-r.west>300)map.setView([25,-40],2);else map.fitBounds([[r.south,r.west],[r.north,r.east]]);
  }
  const input=$('xp-sharp-date');input.max=today();
  const want=defaultDate();
  if(!dateEdited&&input.value!==want){input.value=want;force=true}
  if(force||!baseLayer){setBase();setLabels();setSmoke()}
  drawSpots();loadEvents();
}
async function setBase(){
  if(!map)return;
  const choice=$('xp-sharp-base').value,date=$('xp-sharp-date').value||defaultDate(),status=$('xp-sharp-status');
  let next,cfg=BASES[choice];
  try{
    if(choice==='google'){next=await googleLayer();status.textContent='Google satellite imagery. A mosaic of recent years, so it does not show the selected date.';map.setMaxZoom(21)}
    else{next=L.tileLayer(cfg.url(date),{maxNativeZoom:cfg.max,maxZoom:19,attribution:cfg.credit,errorTileUrl:'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='});
      status.textContent=cfg.note+(cfg.dated?' Showing '+date+' UTC.':'');map.setMaxZoom(19)}
  }catch(err){
    status.textContent=err.message+' Using the free sharp imagery instead.';
    $('xp-sharp-base').value='esri';cfg=BASES.esri;next=L.tileLayer(cfg.url(),{maxNativeZoom:cfg.max,maxZoom:19,attribution:cfg.credit});
  }
  if(baseLayer)map.removeLayer(baseLayer);
  baseLayer=next.addTo(map);baseLayer.setZIndex(1);
  $('xp-sharp-credit').textContent=choice==='google'?'Imagery © Google':(BASES[$('xp-sharp-base').value]??BASES.esri).credit;
  $('xp-sharp-date-label').classList.toggle('xp-dim',!(BASES[$('xp-sharp-base').value]?.dated||$('xp-sharp-smoke').checked));
  googleCredit();
}
function setLabels(){
  if(!map)return;
  if(labelLayer){map.removeLayer(labelLayer);labelLayer=null}
  if($('xp-sharp-labels').checked){labelLayer=L.tileLayer(LABELS,{maxNativeZoom:13,maxZoom:21,opacity:.9}).addTo(map);labelLayer.setZIndex(4)}
}
function setSmoke(){
  if(!map)return;
  if(smokeLayer){map.removeLayer(smokeLayer);smokeLayer=null}
  if($('xp-sharp-smoke').checked){
    smokeLayer=L.tileLayer(SMOKE($('xp-sharp-date').value||defaultDate()),{maxNativeZoom:6,maxZoom:21,opacity:.6,attribution:'NASA GIBS · MODIS Terra aerosol optical depth'}).addTo(map);smokeLayer.setZIndex(3);
    $('xp-sharp-status').textContent='Smoke layer: MODIS aerosol optical depth for '+($('xp-sharp-date').value||defaultDate())+'. Yellow to red means thicker haze or smoke; about 10 km detail.';
  }
  $('xp-sharp-date-label').classList.toggle('xp-dim',!(BASES[$('xp-sharp-base').value]?.dated||$('xp-sharp-smoke').checked));
}
function drawSpots(){
  if(!map||!spots)return;spots.clearLayers();
  if(!S.records)return;
  const [start,end]=bounds(),r=S.region,sensor=S.sensor;
  const rows=obs.filter(o=>o.date>=start&&o.date<=end&&(sensor==='Combined'||o.sensor===sensor)&&within(o.lat,o.lon,r));
  const byCell=new Map();
  for(const c of cellDays(rows)){const k=c.x+':'+c.y;if(!byCell.has(k))byCell.set(k,{lat:c.lat,lon:c.lon,days:0,records:[],sensors:new Set()});
    const g=byCell.get(k);g.days++;g.records.push(...c.records);c.sensors.forEach(s=>g.sensors.add(s))}
  const groups=[...byCell.values()].sort((a,b)=>b.days-a.days).slice(0,6000);
  for(const g of groups){
    const both=g.sensors.size===2;
    const marker=L.circleMarker([g.lat,g.lon],{renderer:canvasRenderer,radius:Math.min(11,4+g.days*1.3),color:'#fff2df',weight:1,fillColor:both?'#ff5a36':'#ff9b65',fillOpacity:.85});
    marker.on('click',()=>{
      const frp=g.records.map(x=>x.frp).filter(Number.isFinite),dates=[...new Set(g.records.map(x=>x.date))].sort();
      marker.bindPopup(`<b>${g.lat.toFixed(3)}, ${g.lon.toFixed(3)}</b><br>${g.days} day${g.days===1?'':'s'} with detections · ${[...g.sensors].join(' + ')}<br>${dates[0]}${dates.length>1?' to '+dates.at(-1):''}${frp.length?'<br>Peak fire radiative power '+Math.max(...frp).toFixed(1)+' MW':''}<br><small>Marker is the centre of a ~2 km grid cell, not an exact fire edge.</small>`).openPopup();
    });
    marker.addTo(spots);
  }
}
async function loadEvents(){
  if(!map||!events)return;
  if(!$('xp-sharp-events').checked){events.clearLayers();eventKey='';return}
  const b=map.getBounds(),date=$('xp-sharp-date').value||defaultDate();
  const [s,e]=S?.records?bounds():[addDays(date,-14),date];
  const box=[Math.max(-180,b.getWest()),Math.min(90,b.getNorth()),Math.min(180,b.getEast()),Math.max(-90,b.getSouth())].map(v=>v.toFixed(2)).join(',');
  const key=box+s+e;if(key===eventKey)return;eventKey=key;
  const status=$('xp-sharp-status');
  try{
    const res=await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?'+new URLSearchParams({category:'wildfires',status:'all',start:addDays(s,-7),end:addDays(e,7),bbox:box,limit:200}));
    if(!res.ok)throw Error('HTTP '+res.status);
    const list=(await res.json()).events??[];if(key!==eventKey)return;
    events.clearLayers();
    for(const ev of list){
      const point=[...(ev.geometry??[])].reverse().find(g=>g.type==='Point');if(!point)continue;
      const [lon,lat]=point.coordinates,first=ev.geometry[0]?.date?.slice(0,10),last=ev.geometry.at(-1)?.date?.slice(0,10),src=ev.sources?.[0]?.url;
      L.marker([lat,lon],{icon:L.divIcon({className:'xp-event',html:'<span>🔥</span>',iconSize:[26,26],iconAnchor:[13,13]}),title:ev.title})
        .bindPopup(`<b>${esc(ev.title)}</b><br>NASA EONET wildfire event<br>${first??''}${last&&last!==first?' to '+last:''}${ev.closed?'<br>Closed '+String(ev.closed).slice(0,10):'<br>Still open'}${src?`<br><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:''}`).addTo(events);
    }
    status.textContent=list.length?`${list.length} named wildfire event${list.length===1?'':'s'} from NASA EONET in this view and period.`:'NASA EONET lists no named wildfire events in this view and period. Its coverage is strongest for the United States.';
  }catch(err){status.textContent='NASA EONET could not be reached ('+err.message+').'}
}

window.addEventListener('earthpulse:render',e=>{const {observations,...state}=e.detail;S=state;obs=observations;build();sync()});
window.addEventListener('earthpulse:state',e=>{S=e.detail;build();if(!S.records)sync()});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)toggle(false)});
