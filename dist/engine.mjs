const zone = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Thunder_Bay',year:'numeric',month:'2-digit',day:'2-digit'});
export const bounds = {west:-94,east:-85,south:47,north:52};
export const dayAt = (year,month,day) => new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10);
export const inside = (lat,lon) => lat>=bounds.south && lat<=bounds.north && lon>=bounds.west && lon<=bounds.east;
export function parseFirms(csv) {
  const lines = csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  const split = line => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x=>x.trim().replace(/^"|"$/g,''));
  const keys = split(lines.shift()).map(x=>x.toLowerCase());
  const required = ['latitude','longitude','acq_date','acq_time'];
  if (!required.every(key=>keys.includes(key))) throw Error('Required FIRMS fields: latitude, longitude, acq_date, acq_time.');
  const rows=[];
  for(const line of lines.filter(Boolean)){
    const fields=split(line);
    const get=k=>fields[keys.indexOf(k)]??'';
    const lat=Number(get('latitude')),lon=Number(get('longitude'));
    const satellite=get('satellite');
    const sensor=(get('instrument') || (['Aqua','Terra','A','T'].includes(satellite)?'MODIS':['N','N20','N21','NOAA-20','NOAA-21','Suomi NPP'].includes(satellite)?'VIIRS':'')).toUpperCase();
    const time=get('acq_time').padStart(4,'0');
    const date=get('acq_date');
    if(!inside(lat,lon)||!['MODIS','VIIRS'].includes(sensor)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}$/.test(time)||+time.slice(0,2)>23||+time.slice(2)>59)continue;
    const utc=new Date(date+'T'+time.slice(0,2)+':'+time.slice(2)+':00Z');
    if(!Number.isFinite(+utc)||utc.toISOString().slice(0,10)!==date)continue;
    const parts=Object.fromEntries(zone.formatToParts(utc).map(x=>[x.type,x.value]));
    rows.push({lat,lon,sensor,satellite,date:parts.year+'-'+parts.month+'-'+parts.day,utc:utc.toISOString(),confidence:get('confidence'),version:get('version')});
  }
  return rows;
}
export function cellDays(rows) {
  const cells=new Map();
  for(const r of rows){
    const x=Math.floor((r.lon-bounds.west)*73/2),y=Math.floor((r.lat-bounds.south)*111/2);
    const key=r.date+':'+x+':'+y;
    if(!cells.has(key)) cells.set(key,{x,y,date:r.date,lat:bounds.south+(y+.5)*2/111,lon:bounds.west+(x+.5)*2/73,sensors:new Set(),records:[]});
    const c=cells.get(key);
    c.sensors.add(r.sensor);c.records.push(r);
  }
  return [...cells.values()];
}
export function filterCells(cells,start,end,sensor='Combined'){
  return cells.filter(c=>c.date>=start&&c.date<=end&&(sensor==='Combined'||c.sensors.has(sensor)));
}
export function peakWeek(cells,year,month,sensor){
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  return Array.from({length:days-6},(_,i)=>{
    const start=dayAt(year,month,i+1),end=dayAt(year,month,i+7);
    return {start,end,value:filterCells(cells,start,end,sensor).length};
  }).sort((a,b)=>b.value-a.value)[0];
}
export function sampleRows(){
  let state=52401;
  const rng=()=>((state=(Math.imul(1664525,state)+1013904223)>>>0)/4294967296);
  const rows=[];
  for(const year of [2023,2024,2025,2026])for(let day=1;day<=31;day++){
    const pulse=Math.exp(-Math.pow((day-16)/6,2));
    const count=Math.floor(rng()*4+pulse*(year===2026?22:8+(year%3)*5));
    for(let i=0;i<count;i++){
      const date=dayAt(year,7,day),lat=48.95+rng()*2.25,lon=-92.7+rng()*5.9,sensor=rng()>.34?'VIIRS':'MODIS';
      rows.push({date,lat,lon,sensor,utc:date+'T17:15:00Z',satellite:'Sample'});
      if(rng()>.77)rows.push({date,lat,lon,sensor:sensor==='MODIS'?'VIIRS':'MODIS',utc:date+'T19:15:00Z',satellite:'Sample'});
    }
  }
  return rows;
}

export function seasonComparison(cells,start,end,sensor){
  const currentYear=start.slice(0,4);
  const years=[...new Set(cells.map(cell=>cell.date.slice(0,4)))].sort();
  const items=years.filter(year=>year<=currentYear).map(label=>({
    label,
    value:filterCells(cells,label+start.slice(4),label+end.slice(4),sensor).length
  })).filter(item=>item.value>0);
  const prior=items.filter(item=>item.label<currentYear);
  const values=prior.map(item=>item.value).sort((a,b)=>a-b);
  const middle=Math.floor(values.length/2);
  const median=!values.length?null:values.length%2?values[middle]:(values[middle-1]+values[middle])/2;
  return {
    items,
    current:items.find(item=>item.label===currentYear)?.value??null,
    baseline:prior.map(item=>item.label),
    median
  };
}
