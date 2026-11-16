import {createGlobe} from './globe.mjs';
import {regions,within,validBounds,zoomAt,dayAt,parseFirms,cellDays,filterCells,peakWeek,sampleRows,seasonComparison} from './engine.mjs';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el};
const format=(date,options={month:'short',day:'numeric'})=>new Intl.DateTimeFormat('en-CA',{...options,timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
let observations=sampleRows(), regionKey='thunderbay', region=regions.thunderbay;
let cells=cellDays(observations), sample=true, year=2026, month=7, selected=null, interval=null;
let replayTimer=null;
const sensor=()=>$('sensor').value;
const monthLength=()=>new Date(Date.UTC(year,month,0)).getUTCDate();
const monthBounds=()=>[dayAt(year,month,1),dayAt(year,month,monthLength())];
const currentBounds=()=>interval??(selected?[selected,selected]:monthBounds());
const period=(start,end)=>start===end?format(start):format(start)+' – '+format(end);
function showChart(items,title,note,analysis=false,unit='observed hotspot cell-days'){
  $('chart-title').textContent=title;
  $('chart-note').textContent=note;
  $('reset-chart').hidden=!analysis;
  $('chart-values').hidden=!analysis;
  $('chart-values').replaceChildren(...items.map(item=>make('span','',item.label+' · '+item.value.toLocaleString())));
  const max=Math.max(1,...items.map(x=>x.value));
  $('chart').replaceChildren(...items.map(item=>{
    const col=make('div','bar-col');const track=make('div','bar-track');const bar=make('div','bar');
    bar.style.height=(item.value/max*100)+'%';
    const label=item.full??item.label;
    col.title=label+': '+item.value+' '+unit;col.setAttribute('aria-label',col.title);
    track.append(bar);col.append(track,make('span','',item.label));return col;
  }));
}
function mapCells(c){
  const [start,end]=currentBounds();
  $('map-date').textContent=period(start,end)+' UTC · '+sensor();
  const byLocation=new Map();
  for(const point of c){
    const key=point.x+':'+point.y;
    if(!byLocation.has(key))byLocation.set(key,[]);
    byLocation.get(key).push(point);
  }
  $('scale-note').textContent=c.length?byLocation.size.toLocaleString()+' mapped cells':'No matching records';
  const showPower=$('metric').value==='frp';
  const groups=[...byLocation.values()];
  const visible=groups.length<=2500?groups:groups.sort((a,b)=>b.length-a.length).slice(0,2500);
  if(visible.length<groups.length)$('scale-note').textContent='Showing '+visible.length.toLocaleString()+' of '+groups.length.toLocaleString()+' cells · analysis includes all';
  $('globe-markers').replaceChildren();
  $('markers').replaceChildren(...visible.map(points=>{
    const p=points[0];
    const pin=make('button','hot');
    pin.style.left=clamp((p.lon-region.west)/(region.east-region.west)*100,0,100)+'%';
    pin.style.top=clamp((region.north-p.lat)/(region.north-region.south)*100,0,100)+'%';
    const records=points.flatMap(x=>x.records).filter(r=>sensor()==='Combined'||r.sensor===sensor());
    const peakPower=records.reduce((max,r)=>Number.isFinite(r.frp)?Math.max(max??0,r.frp):max,null);
    pin.style.setProperty('--column-height',(showPower?(peakPower===null?0:Math.min(64,6+Math.sqrt(peakPower)*4)):Math.min(64,6+points.length*7))+'px');
    pin.style.setProperty('--globe-dot',Math.min(16,5+(showPower?Math.sqrt(peakPower??0)*.55:points.length*1.5))+'px');
    pin.classList.toggle('unavailable-power',showPower&&peakPower===null);

    pin.dataset.lon=p.lon;pin.dataset.lat=p.lat;
    pin.title=p.lat.toFixed(2)+', '+p.lon.toFixed(2)+' · '+points.length+' cell-days';
    pin.setAttribute('aria-label',pin.title);
    pin.addEventListener('click',()=>{
      stopReplay();
      $('pixel-content').replaceChildren(make('p','',pin.title),...records.map(r=>make('div','',r.utc+' · '+r.sensor+' · '+(r.satellite||'Unknown satellite')+(r.confidence?' · Confidence '+r.confidence:'')+(Number.isFinite(r.frp)?' · '+r.frp+' MW FRP':''))));
      $('pixel').showModal();
    });return pin;
  }));
  syncGlobeMarkers();
}
function render(){
  const [first,last]=monthBounds(), [start,end]=currentBounds();
  const inMonth=filterCells(cells,first,last,sensor());
  const filtered=filterCells(cells,start,end,sensor());
  const counts=new Map();
  inMonth.forEach(c=>counts.set(c.date,(counts.get(c.date)||0)+1));
  $('total').textContent=filtered.length.toLocaleString();
  $('both').textContent=filtered.filter(c=>c.sensors.size===2).length.toLocaleString();
  const peak=[...filtered.reduce((days,c)=>days.set(c.date,(days.get(c.date)||0)+1),new Map())].sort((a,b)=>b[1]-a[1])[0];
  $('peak').textContent=peak?format(peak[0]):'—';
  $('replay-day').max=monthLength();
  $('replay-day').value=(selected??interval?.[0]??first).slice(-2);
  $('replay-label').textContent=selected?format(selected):interval?period(...interval):'Whole month';
  $('month').textContent=format(first,{month:'long',year:'numeric'});
  $('data-note').textContent=firmsConnected?'NASA FIRMS · '+($('nasa-date').value?'Selected UTC day':'Most recent UTC day')+' · Dates without records have unknown coverage.':sample?'Demo data · Simulated hotspots, not live NASA observations. Import FIRMS CSVs to analyze actual observations.':'Imported FIRMS CSVs · Observations only. Dates without records have unknown coverage.';
  const max=Math.max(1,...counts.values());
  const buttons=Array.from({length:(new Date(first+'T00:00:00Z').getUTCDay()+6)%7},()=>make('span'));
  const chart=[];
  for(let i=1;i<=monthLength();i++){
    const date=dayAt(year,month,i),value=counts.get(date)||0;
    const button=make('button','day'+((selected||interval)&&date>=start&&date<=end?' selected':''),i);
    if(value)button.style.setProperty('--tone',['#68402f','#89462e','#a95330','#c45934'][Math.min(3,Math.floor(value/max*4))]);
    button.title=format(date)+': '+(value?value+' observed hotspot cells':'No records')
    button.setAttribute('aria-label',button.title);
    button.addEventListener('click',()=>{stopReplay();selectDay(Number(date.slice(-2)))});
    buttons.push(button);chart.push({label:i===1||i%5===0?i:'',full:format(date),value});
  }
  $('days').replaceChildren(...buttons);
  mapCells(filtered);
  showChart(chart,'Activity over time','Observed hotspot cell-days · '+format(first,{month:'long',year:'numeric'}));
  $('analysis-result').textContent='Choose an analysis to update the chart. Model-powered questions will be available after SI is connected.';
}
function analyze(operation){
  stopReplay();
  const [start,end]=currentBounds();
  if(operation==='persistence'){
    const locations=new Map();
    for(const cell of filterCells(cells,start,end,sensor())){
      const key=cell.x+':'+cell.y;
      locations.set(key,(locations.get(key)??0)+1);
    }
    const buckets=[0,0,0];
    for(const days of locations.values()) buckets[Math.min(days,3)-1]++;
    showChart(['1 day','2 days','3+ days'].map((label,index)=>({label,value:buckets[index]})),'Repeat hotspot observations',period(start,end)+' · unique grid cells',true,'grid cells');
    $('analysis-result').textContent=locations.size?(buckets[1]+buckets[2])+' of '+locations.size+' mapped cells had observations on multiple UTC days. Repeat detections alone cannot establish whether the same fire persisted.':'No records in this selection.';
    return;
  }
  if(operation==='week'){
    const peak=peakWeek(cells,year,month,sensor());
    if(!peak.value){$('analysis-result').textContent='No observations in this month for the selected instrument.';return}
    interval=[peak.start,peak.end];selected=null;render();
    const daily=Array.from({length:7},(_,i)=>{const date=dayAt(year,month,+peak.start.slice(-2)+i);return {label:format(date),value:filterCells(cells,date,date,sensor()).length}});
    showChart(daily,'Peak seven-day window',period(...interval),true);
    $('analysis-result').textContent=period(...interval)+' had the highest observed total in this month: '+peak.value+' hotspot cell-days.';
    return;
  }
  if(operation==='sensors'){
    const items=['MODIS','VIIRS','Combined'].map(label=>({label,value:filterCells(cells,start,end,label).length}));
    showChart(items,'Instrument comparison',period(start,end),true);
    $('analysis-result').textContent='The combined result counts overlapping grid cells once per day. Differences may reflect sensor sensitivity and observation schedules.';
    return;
  }
  const comparison=seasonComparison(cells,start,end,sensor());
  showChart(comparison.items,'Same dates across seasons',period(start,end)+' · '+sensor(),true);
  const {current,median,baseline}=comparison;
  if(current===null||baseline.length<2){
    $('analysis-result').textContent='A baseline needs records for the selected year and at least two prior years. Years without matching records are omitted.';
    return;
  }
  const delta=current-median;
  const change=delta===0?'matched':(median>0?Math.round(Math.abs(delta)/median*100)+'% '+(delta>0?'above':'below'):'above');
  $('analysis-result').textContent=start.slice(0,4)+' recorded '+current+' hotspot cell-days and '+(delta===0?'matched':'was '+change)+' the prior-year median of '+median+' ('+baseline.join(', ')+'). Differences may reflect uneven satellite coverage.';

}
for(const b of document.querySelectorAll('[data-analysis]'))b.addEventListener('click',()=>analyze(b.dataset.analysis));
const map=$('map');
let sphere;
try{sphere=createGlobe($('earth-globe'))}catch{}
let globeOn=Boolean(sphere), globeLongitude=-95, globeLatitude=24;
let frame;
function drawGlobe(){
  if(!globeOn||frame!==undefined)return;
  frame=requestAnimationFrame(()=>{
    frame=undefined;
    if(!globeOn)return;
    sphere.draw(globeLongitude,globeLatitude,camera.zoom);
    for(const pin of $('globe-markers').children){
      const point=sphere.project(Number(pin.dataset.lon),Number(pin.dataset.lat));
      pin.hidden=!point;
      if(point){pin.style.left=point.x+'px';pin.style.top=point.y+'px';}
    }
  });
}
function syncGlobeMarkers(){
  const from=$(globeOn?'markers':'globe-markers');
  const to=$(globeOn?'globe-markers':'markers');
  for(const pin of [...from.children]){
    pin.hidden=false;
    if(!globeOn){
      pin.style.left=clamp((Number(pin.dataset.lon)-region.west)/(region.east-region.west)*100,0,100)+'%';
      pin.style.top=clamp((region.north-Number(pin.dataset.lat))/(region.north-region.south)*100,0,100)+'%';
    }
    to.append(pin);
  }
  drawGlobe();
}
function focusGlobe(){
  globeLongitude=regionKey==='world'?-95:(region.west+region.east)/2;
  globeLatitude=regionKey==='world'?24:(region.south+region.north)/2;
}
$('globe-toggle').disabled=!sphere;
$('globe-toggle').onclick=()=>{
  globeOn=!globeOn;
  resetCamera();
  syncGlobeMarkers();
  updateSource();
};

const camera={pitch:44,bearing:-8,zoom:1,x:0,y:0,orbit:true};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
function resetCamera(){
  Object.assign(camera,{pitch:44,bearing:-8,zoom:1,x:0,y:0});
  focusGlobe();
  updateCamera();
}
function zoom(factor,x=map.clientWidth/2,y=map.clientHeight/2){
  Object.assign(camera,zoomAt(camera,factor,x,y));
  updateCamera();
}
function updateCamera(){
  map.classList.toggle('tilted',camera.orbit);
  map.classList.toggle('globe-mode',globeOn);
  $('globe-toggle').setAttribute('aria-pressed',globeOn);
  $('globe-toggle').textContent=globeOn?'Globe':'Map';
  $('tilt').hidden=globeOn;
  $('metric-label').textContent=globeOn?'Marker size':'Column height';
  drawGlobe();
  map.style.setProperty('--pitch',camera.pitch+'deg');
  map.style.setProperty('--bearing',camera.bearing+'deg');
  map.style.setProperty('--stage-zoom',camera.zoom);
  map.style.setProperty('--stage-x',camera.x+'px');
  map.style.setProperty('--stage-y',camera.y+'px');
  $('zoom-readout').textContent=camera.zoom.toFixed(1)+'×';
  $('tilt').setAttribute('aria-pressed',camera.orbit);
  $('tilt').textContent=camera.orbit?'Orbit':'Top down';
  $('camera-hint').textContent=globeOn?'Drag to rotate Earth · Scroll or pinch to zoom':camera.orbit?'Drag to orbit · Scroll to zoom':'Drag to pan · Scroll to zoom';
}
$('tilt').onclick=()=>{camera.orbit=!camera.orbit;updateCamera()};
for(const control of document.querySelectorAll('[data-camera]')){
  control.onclick=()=>{
    const action=control.dataset.camera;
    if(action==='reset')resetCamera();
    if(action==='zoom-in')zoom(1.25);
    if(action==='zoom-out')zoom(.8);
    if(action==='left'||action==='right'){
      camera.orbit=true;
      if(globeOn)globeLongitude+=action==='left'?-15:15;else camera.bearing+=action==='left'?-15:15;
    }
    updateCamera();
  };
}
map.addEventListener('wheel',event=>{
  if(event.target.closest('.view-tools'))return;
  event.preventDefault();
  const rect=map.getBoundingClientRect();
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?map.clientHeight:1);
  zoom(Math.exp(clamp(-delta*.002,-.4,.4)),event.clientX-rect.left,event.clientY-rect.top);
},{passive:false});
const pointers=new Map();
let gesture=null;
function resetGesture(){
  const [first,second]=pointers.values();
  gesture=second?{
    distance:Math.max(1,Math.hypot(first.x-second.x,first.y-second.y)),
    x:(first.x+second.x)/2,y:(first.y+second.y)/2
  }:first?{...first}:null;
}
map.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('button')||pointers.size>=2)return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  map.setPointerCapture(event.pointerId);
  map.classList.add('dragging');
  resetGesture();
});
map.addEventListener('pointermove',event=>{
  if(!pointers.has(event.pointerId)||!gesture)return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const previous=gesture;
  resetGesture();
  const dx=gesture.x-previous.x,dy=gesture.y-previous.y;
  if(pointers.size===2){
    const rect=map.getBoundingClientRect();
    Object.assign(camera,zoomAt(camera,gesture.distance/previous.distance,previous.x-rect.left,previous.y-rect.top));
    camera.x+=dx;camera.y+=dy;
  }else if(globeOn){
    globeLongitude-=dx*.45/camera.zoom;
    globeLatitude=clamp(globeLatitude+dy*.45/camera.zoom,-89,89);
  }else if(camera.orbit&&!event.shiftKey){
    camera.bearing+=dx*.28;
    camera.pitch=clamp(camera.pitch+dy*.24,18,66);
  }else{
    camera.x+=dx;camera.y+=dy;
  }
  updateCamera();
});
for(const type of ['pointerup','pointercancel','lostpointercapture']){
  map.addEventListener(type,event=>{
    pointers.delete(event.pointerId);
    resetGesture();
    if(!pointers.size)map.classList.remove('dragging');
  });
}
function setExpanded(state){
  if($('map-card').classList.contains('expanded')===state)return;
  resetCamera();
  $('map-card').classList.toggle('expanded',state);
  $('expand').setAttribute('aria-pressed',state);
  $('expand').querySelector('span').textContent=state?'Close':'Expand';
  document.body.classList.toggle('explorer-open',state);
}
$('expand').onclick=()=>setExpanded($('expand').getAttribute('aria-pressed')==='false');
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('pixel').open)setExpanded(false);
});
function selectDay(day){
  selected=dayAt(year,month,day);
  interval=null;
  render();
}
function stopReplay(){
  clearInterval(replayTimer);
  replayTimer=null;
  $('play').textContent='▶';
  $('play').setAttribute('aria-label','Play timeline');
}
function startReplay(){
  const first=selected&&Number(selected.slice(-2))<monthLength()?Number(selected.slice(-2)):1;
  selectDay(first);
  $('play').textContent='Ⅱ';
  $('play').setAttribute('aria-label','Pause timeline');
  replayTimer=setInterval(()=>{
    const day=Number(selected.slice(-2));
    if(day>=monthLength()){stopReplay();return}
    selectDay(day+1);
  },Number($('speed').value));
}
$('play').onclick=()=>replayTimer?stopReplay():startReplay();
$('replay-day').oninput=()=>{stopReplay();selectDay(Number($('replay-day').value))};
$('speed').onchange=()=>{if(replayTimer){stopReplay();startReplay()}};
updateCamera();
function changeMonth(delta){stopReplay();const d=new Date(Date.UTC(year,month-1+delta,1));year=d.getUTCFullYear();month=d.getUTCMonth()+1;selected=null;interval=null;render()}
$('prev').onclick=()=>changeMonth(-1);$('next').onclick=()=>changeMonth(1);
$('clear').onclick=()=>{stopReplay();selected=null;interval=null;render()};$('sensor').onchange=()=>updateSource();$('reset-chart').onclick=render;
$('import').onclick=()=>$('files').click();
$('files').onchange=async()=>{
  try{
    const data=(await Promise.all([...$('files').files].map(async f=>parseFirms(await f.text())))).flat();
    if(!data.length)throw Error('No recognizable MODIS or VIIRS observations in the selected CSVs.');
    stopReplay();replayObservations=data;replaySample=false;observations=data;sample=false;const latest=data.map(r=>r.date).sort().at(-1);year=+latest.slice(0,4);month=+latest.slice(5,7);$('data-mode').value='records';setRegion('world',regions.world);
  }catch(e){$('data-note').textContent='Import failed. '+e.message}
  $('files').value='';
};
$('export').onclick=()=>{
  const [start,end]=currentBounds();
  const rows=filterCells(cells,start,end,sensor()).flatMap(c=>c.records).filter(r=>sensor()==='Combined'||r.sensor===sensor());
  const csv=[['dataset','utc_date','utc','latitude','longitude','instrument','frp_mw'],...rows.map(r=>[sample?'simulated':'imported_firms',r.date,r.utc,r.lat,r.lon,r.sensor,r.frp??''])].map(r=>r.join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=make('a');a.href=url;a.download='io-earthpulse-'+start+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const nasaMode=()=>$('data-mode').value;
const nasaLayers={
  MODIS:['MODIS_Aqua_Thermal_Anomalies_All','MODIS_Terra_Thermal_Anomalies_All'],
  VIIRS:['VIIRS_NOAA20_Thermal_Anomalies_375m_All']
};
function gibsUrl(box,layers,date){
  const {west,east,south,north}=box;
  const ratio=(east-west)/(north-south);
  const width=Math.max(1,Math.round(Math.min(1440,720*ratio)));
  const height=Math.max(1,Math.round(Math.min(720,1440/ratio)));
  const query=new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',LAYERS:layers.join(','),STYLES:layers.map(()=> '').join(','),FORMAT:'image/png',BBOX:[west,south,east,north].join(','),WIDTH:width,HEIGHT:height,SRS:'EPSG:4326',TRANSPARENT:'TRUE'});
  if(date)query.set('TIME',date);
  return 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?'+query;
}
const blueMarble='BlueMarble_ShadedRelief_Bathymetry';
let imageRequest=0;
let timePlaying=false,timeTimer;
function stopEarthTime(){
  timePlaying=false;clearTimeout(timeTimer);$('earth-play').textContent='▶ Play 4D';
}
function advanceEarthTime(){
  if(!timePlaying)return;
  timeTimer=setTimeout(()=>{
    const date=new Date($('nasa-date').value+'T00:00:00Z');
    date.setUTCDate(date.getUTCDate()+1);
    const next=date.toISOString().slice(0,10);
    if(next>$('nasa-date').max){stopEarthTime();return;}
    $('nasa-date').value=next;
    updateSource();
  },1000);
}
$('earth-play').onclick=()=>{
  if(timePlaying){stopEarthTime();return;}
  if($('nasa-date').value>=$('nasa-date').max){
    $('nasa-date').value=new Date(Date.parse($('nasa-date').max)-6*86400000).toISOString().slice(0,10);
  }
  timePlaying=true;$('earth-play').textContent='Ⅱ Pause 4D';updateSource();
};
function setGlobeTexture(url,ticket){
  const texture=new Image();
  texture.crossOrigin='anonymous';
  texture.onload=()=>{
    if(ticket!==imageRequest||!globeOn)return;
    try{sphere.upload(texture);drawGlobe()}catch{
      globeOn=false;resetCamera();syncGlobeMarkers();updateSource();
    }
  };
  texture.onerror=()=>{
    if(ticket!==imageRequest||!globeOn)return;
    globeOn=false;resetCamera();syncGlobeMarkers();updateSource();
  };
  texture.src=url;
}
let firmsRequest;
let firmsConnected=false;
let replayObservations=observations;
let replaySample=true;
function loadFirms(ticket){
  firmsRequest=new AbortController();
  const area=regionKey==='world'?'world':[region.west,region.south,region.east,region.north].join(',');
  const parameters=new URLSearchParams({area,sensor:sensor()});
  if($('nasa-date').value)parameters.set('date',$('nasa-date').value);
  $('data-note').textContent='Loading NASA FIRMS hotspot records…';
  fetch('/api/firms?'+parameters,{signal:firmsRequest.signal})
    .then(async response=>{
      const payload=await response.json();
      if(!response.ok)throw Error(payload.message);
      return payload.feeds.flatMap(feed=>parseFirms(feed.csv));
    }).then(rows=>{
      if(ticket!==imageRequest)return;
      observations=rows;
      sample=false;
      cells=cellDays(rows.filter(r=>within(r.lat,r.lon,region)));
      const date=parameters.get('date')||rows.map(r=>r.date).sort().at(-1)||new Date().toISOString().slice(0,10);
      year=+date.slice(0,4);month=+date.slice(5,7);
      selected=date;interval=null;
      firmsConnected=true;
      updateSource(true);
    }).catch(error=>{
      if(ticket===imageRequest&&error.name!=='AbortError')$('data-note').textContent=error.message||'FIRMS records could not load.';
    });
}

function updateSource(ready=false){
  clearTimeout(timeTimer);
  const mode=nasaMode();
  firmsRequest?.abort();
  const firmsMode=mode==='firms';
  if(!ready)firmsConnected=false;
  const records=mode==='records'||(firmsMode&&firmsConnected);
  if(mode==='records'&&observations!==replayObservations){
    observations=replayObservations;sample=replaySample;
    cells=cellDays(observations.filter(r=>within(r.lat,r.lon,region)));
    const date=observations.map(r=>r.date).sort().at(-1);
    year=+date.slice(0,4);month=+date.slice(5,7);selected=null;interval=null;
  }
  const image=$('nasa-imagery');
  const ticket=++imageRequest;
  const plane=document.querySelector('.map-plane');
  plane.style.backgroundImage='url("'+gibsUrl(region,[blueMarble])+'")';
  $('nasa-date-label').hidden=mode!=='date'&&!firmsMode;
  $('refresh-nasa').hidden=mode==='records';
  $('earth-play').hidden=mode!=='date';
  if(mode!=='date')stopEarthTime();
  for(const selector of ['.stats','.calendar-card','.trend-card','.analysis-card','.replay','#export']){
    document.querySelector(selector).hidden=!records;
  }
  $('map-card').classList.toggle('nasa-map',!records);
  $('markers').hidden=!records;
  $('globe-markers').hidden=!records;
  image.hidden=true;
  if(records){if(globeOn)setGlobeTexture(gibsUrl(regions.world,[blueMarble]),ticket);render();return}
  if(firmsMode){loadFirms(ticket);return}
  stopReplay();
  const date=mode==='date' ? $('nasa-date').value : '';
  $('map-date').textContent=(date?date+' UTC':'NASA latest available')+' · '+sensor();
  if(mode==='date'&&!date){$('data-note').textContent='Choose a UTC date for the NASA hotspot layer.';return}
  $('data-note').textContent='Loading NASA thermal-anomaly imagery…';
  const layers=sensor()==='Combined'?[...nasaLayers.MODIS,...nasaLayers.VIIRS]:nasaLayers[sensor()];
  const request=new Image();
  let timeout=setTimeout(()=>failed('NASA imagery request timed out. Refresh or try a different date or region.'),15000);
  function failed(message){
    clearTimeout(timeout);
    if(ticket!==imageRequest)return;
    imageRequest++;
    stopEarthTime();
    $('data-note').textContent=message;
  }
  if(globeOn)request.crossOrigin='anonymous';
  request.onload=()=>{
    clearTimeout(timeout);
    if(ticket!==imageRequest)return;
    image.src=request.src;
    image.hidden=false;
    if(globeOn){try{sphere.upload(request);drawGlobe()}catch{globeOn=false;resetCamera();updateSource();return}}
    advanceEarthTime();
    $('data-note').textContent=(date?'NASA GIBS · Requested observation date '+date+' UTC. ':'NASA GIBS · Latest published imagery by sensor. Update times can differ. ')+'An empty view can reflect a gap in satellite coverage.';
  };
  request.onerror=()=>failed('NASA imagery unavailable for this request. Try a different date, sensor, or region.');
  request.src=gibsUrl(globeOn?regions.world:region,[blueMarble,...layers],date);
}
function setRegion(key,box){
  stopReplay();
  regionKey=key;
  region=box;
  $('region').value=key;
  $('edit-bounds').hidden=key!=='custom';
  $('map-heading').textContent=$('region').selectedOptions[0].textContent.replace('…','')+' explorer';
  map.classList.toggle('regional-basemap',key!=='thunderbay');
  cells=cellDays(observations.filter(row=>within(row.lat,row.lon,box)));
  selected=null;interval=null;
  resetCamera();
  updateSource();
}
$('region').onchange=()=>{
  const key=$('region').value;
  if(key!=='custom'){setRegion(key,regions[key]);return}
  openBounds();
};
function openBounds(){
  for(const field of ['west','south','east','north'])$(field).value=region[field];
  $('bounds-error').textContent='';
  $('bounds-dialog').showModal();
}
$('edit-bounds').onclick=openBounds;
$('cancel-bounds').onclick=()=>$('bounds-dialog').close();
$('bounds-dialog').onclose=()=>{$('region').value=regionKey};
$('bounds-form').onsubmit=event=>{
  event.preventDefault();
  const box=Object.fromEntries(['west','south','east','north'].map(key=>[key,$(key).valueAsNumber]));
  if(!validBounds(box)){
    $('bounds-error').textContent='West must be less than east, and south less than north. Use two views for regions across the date line.';
    return;
  }
  setRegion('custom',box);
  $('bounds-dialog').close();
};
$('metric').onchange=()=>mapCells(filterCells(cells,...currentBounds(),sensor()));
window.addEventListener('resize',resetCamera);
function route(){
  const route=['trends','radar'].includes(location.hash.slice(1))?location.hash.slice(1):'fire';
  const title={fire:'Fire Intelligence',trends:'Earth Trends',radar:'Radar Change'}[route];
  $('crumb').textContent=title;
  for(const tab of ['fire','trends','radar']){
    $('nav-'+tab).classList.toggle('active',route===tab);
    if(route===tab)$('nav-'+tab).setAttribute('aria-current','page');else $('nav-'+tab).removeAttribute('aria-current');
  }
  $('fire').hidden=route!=='fire';$('preview').hidden=route==='fire';
  if(route==='fire')return;
  stopReplay();stopEarthTime();setExpanded(false);
  const wrap=make('div');
  wrap.append(make('div','eyebrow','MODULE PREVIEW'),make('h1','',title),make('p','',route==='trends'?'Explore how precipitation and other Earth variables change over time.':'Compare radar acquisitions to investigate surface change.' ));
  const card=make('article','card preview-visual');
  card.append(make('h2','',route==='trends'?'Example precipitation time series':'Example radar comparison'),make('p','','Illustrative preview · Analysis planned for a future release'));
  const visual=make('div',route==='trends'?'preview-bars':'radar-demo');
  if(route==='trends')for(const height of [48,58,46,61,48,51,57,42,38,45,29,35]){const bar=make('i');bar.style.height=height+'%';visual.append(bar)}
  else visual.append(make('div','','Earlier acquisition'),make('div','','Later acquisition'));
  card.append(visual);wrap.append(card);$('preview').replaceChildren(wrap);
}
$('nasa-date').max=new Date().toISOString().slice(0,10);
$('nasa-date').value=$('nasa-date').max;
$('data-mode').onchange=()=>{if(nasaMode()==='firms')$('nasa-date').value='';else if(!$('nasa-date').value)$('nasa-date').value=$('nasa-date').max;updateSource()};
$('nasa-date').onchange=()=>{stopEarthTime();updateSource()};
$('refresh-nasa').onclick=()=>updateSource();
window.addEventListener('hashchange',route);
setRegion('world',regions.world);
route();
