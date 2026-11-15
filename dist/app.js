import {bounds,dayAt,parseFirms,cellDays,filterCells,peakWeek,sampleRows,seasonComparison} from './engine.mjs';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el};
const format=(date,options={month:'short',day:'numeric'})=>new Intl.DateTimeFormat('en-CA',{...options,timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
let cells=cellDays(sampleRows()), sample=true, year=2026, month=7, selected=null, interval=null;
const sensor=()=>$('sensor').value;
const monthLength=()=>new Date(Date.UTC(year,month,0)).getUTCDate();
const monthBounds=()=>[dayAt(year,month,1),dayAt(year,month,monthLength())];
const currentBounds=()=>interval??(selected?[selected,selected]:monthBounds());
const period=(start,end)=>start===end?format(start):format(start)+' – '+format(end);
function showChart(items,title,note,analysis=false){
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
    col.title=label+': '+item.value+' observed hotspot cell-days';col.setAttribute('aria-label',col.title);
    track.append(bar);col.append(track,make('span','',item.label));return col;
  }));
}
function mapCells(c){
  const [start,end]=currentBounds();
  $('map-date').textContent=period(start,end)+' · '+sensor();
  const byLocation=new Map();
  for(const point of c){
    const key=point.x+':'+point.y;
    if(!byLocation.has(key))byLocation.set(key,[]);
    byLocation.get(key).push(point);
  }
  const maxDays=Math.max(1,...[...byLocation.values()].map(points=>points.length));
  $('markers').replaceChildren(...[...byLocation.values()].map(points=>{
    const p=points[0];
    const pin=make('button','hot');
    pin.style.left=((p.lon-bounds.west)/(bounds.east-bounds.west)*100)+'%';
    pin.style.top=((bounds.north-p.lat)/(bounds.north-bounds.south)*100)+'%';
    const records=points.flatMap(x=>x.records).filter(r=>sensor()==='Combined'||r.sensor===sensor());
    pin.style.setProperty('--column-height',(8+48*points.length/maxDays)+'px');
    pin.title=p.lat.toFixed(2)+', '+p.lon.toFixed(2)+' · '+points.length+' cell-days';
    pin.setAttribute('aria-label',pin.title);
    pin.addEventListener('click',()=>{
      $('pixel-content').replaceChildren(make('p','',pin.title),...records.map(r=>make('div','',r.utc+' · '+r.sensor+' · '+(r.satellite||'Unknown satellite')+(r.confidence?' · Confidence '+r.confidence:''))));
      $('pixel').showModal();
    });return pin;
  }));
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
  $('month').textContent=format(first,{month:'long',year:'numeric'});
  $('data-note').textContent=sample?'Demo data · Simulated hotspots, not live NASA observations. Import FIRMS CSVs to analyze actual observations.':'Imported FIRMS CSVs · Observations only. Dates without records have unknown coverage.';
  const max=Math.max(1,...counts.values());
  const buttons=Array.from({length:(new Date(first+'T00:00:00Z').getUTCDay()+6)%7},()=>make('span'));
  const chart=[];
  for(let i=1;i<=monthLength();i++){
    const date=dayAt(year,month,i),value=counts.get(date)||0;
    const button=make('button','day'+((selected||interval)&&date>=start&&date<=end?' selected':''),i);
    if(value)button.style.setProperty('--tone',['#68402f','#89462e','#a95330','#c45934'][Math.min(3,Math.floor(value/max*4))]);
    button.title=format(date)+': '+(value?value+' observed hotspot cells':'No records')
    button.setAttribute('aria-label',button.title);
    button.addEventListener('click',()=>{selected=date;interval=null;render()});
    buttons.push(button);chart.push({label:i===1||i%5===0?i:'',full:format(date),value});
  }
  $('days').replaceChildren(...buttons);
  mapCells(filtered);
  showChart(chart,'Activity over time','Observed hotspot cell-days · '+format(first,{month:'long',year:'numeric'}));
  $('analysis-result').textContent='Choose an analysis to update the chart. Model-powered questions will be available after SI is connected.';
}
function analyze(operation){
  const [start,end]=currentBounds();
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
$('tilt').onclick=()=>{
  const active=$('map').classList.toggle('tilted');
  $('tilt').setAttribute('aria-pressed',active);
  $('tilt').textContent=active?'2D view':'3D view';
  $('map-scale').textContent=active?'Column height = observed days per cell':'Northwestern Ontario';
};
function changeMonth(delta){const d=new Date(Date.UTC(year,month-1+delta,1));year=d.getUTCFullYear();month=d.getUTCMonth()+1;selected=null;interval=null;render()}
$('prev').onclick=()=>changeMonth(-1);$('next').onclick=()=>changeMonth(1);
$('clear').onclick=()=>{selected=null;interval=null;render()};$('sensor').onchange=render;$('reset-chart').onclick=render;
$('import').onclick=()=>$('files').click();
$('files').onchange=async()=>{
  try{
    const data=(await Promise.all([...$('files').files].map(async f=>parseFirms(await f.text())))).flat();
    if(!data.length)throw Error('No recognizable MODIS or VIIRS observations inside the study area.');
    cells=cellDays(data);sample=false;const latest=data.map(r=>r.date).sort().at(-1);year=+latest.slice(0,4);month=+latest.slice(5,7);selected=null;interval=null;render();
  }catch(e){$('data-note').textContent='Import failed. '+e.message}
  $('files').value='';
};
$('export').onclick=()=>{
  const [start,end]=currentBounds();
  const rows=filterCells(cells,start,end,sensor()).flatMap(c=>c.records).filter(r=>sensor()==='Combined'||r.sensor===sensor());
  const csv=[['dataset','local_date','utc','latitude','longitude','instrument'],...rows.map(r=>[sample?'simulated':'imported_firms',r.date,r.utc,r.lat,r.lon,r.sensor])].map(r=>r.join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=make('a');a.href=url;a.download='io-earthpulse-'+start+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
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
  const wrap=make('div');
  wrap.append(make('div','eyebrow','MODULE PREVIEW'),make('h1','',title),make('p','',route==='trends'?'Explore how precipitation and other Earth variables change over time.':'Compare radar acquisitions to investigate surface change.' ));
  const card=make('article','card preview-visual');
  card.append(make('h2','',route==='trends'?'Example precipitation time series':'Example radar comparison'),make('p','','Illustrative preview · Analysis planned for a future release'));
  const visual=make('div',route==='trends'?'preview-bars':'radar-demo');
  if(route==='trends')for(const height of [48,58,46,61,48,51,57,42,38,45,29,35]){const bar=make('i');bar.style.height=height+'%';visual.append(bar)}
  else visual.append(make('div','','Earlier acquisition'),make('div','','Later acquisition'));
  card.append(visual);wrap.append(card);$('preview').replaceChildren(wrap);
}
window.addEventListener('hashchange',route);render();route();
