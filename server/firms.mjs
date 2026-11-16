import {validBounds} from '../dist/engine.mjs';
const products={
  MODIS:['MODIS_NRT','MODIS_SP'],
  VIIRS:['VIIRS_NOAA20_NRT','VIIRS_NOAA20_SP']
};
const error=(message,status)=>Response.json({message},{status});
export async function firms(request,env,fetchData=fetch){
  if(request.method!=='GET')return error('Use GET.',405);
  if(!/^[A-Za-z0-9_-]{20,80}$/.test(env.FIRMS_MAP_KEY??''))return error('FIRMS credentials have not been configured.',503);
  const params=new URL(request.url).searchParams;
  const area=params.get('area');
  const coords=area?.split(',').map(v=>v.trim()?Number(v):NaN);
  if(area!=='world'&&(coords?.length!==4||!validBounds({west:coords[0],south:coords[1],east:coords[2],north:coords[3]})))return error('Invalid bounding box.',400);
  const date=params.get('date');
  const day=date&&new Date(date+'T00:00:00Z');
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(+day)||day.toISOString().slice(0,10)!==date||day>Date.now()))return error('Invalid UTC date.',400);
  const end=params.get('end');
  const endDay=end&&new Date(end+'T00:00:00Z');
  if(end&&(!date||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(+endDay)||endDay.toISOString().slice(0,10)!==end||endDay>Date.now()||endDay<day))return error('Enter a valid end date on or after the start date.',400);
  const span=end?Math.round((endDay-day)/86400000)+1:1;
  if(span>(area==='world'?5:62))return error('Choose a region for up to 62 days. Worldwide requests support up to five days.',400);
  const sensor=params.get('sensor');
  if(!['MODIS','VIIRS','Combined'].includes(sensor))return error('Invalid instrument.',400);
  try{
    const instruments=sensor==='Combined'?['MODIS','VIIRS']:[sensor];
    async function nasa(path){
      const response=await fetchData('https://firms.modaps.eosdis.nasa.gov/api/'+path,{redirect:'manual',signal:AbortSignal.timeout(18000)});
      const body=await response.text();
      if(/^Invalid MAP_KEY\.?$/i.test(body.trim()))throw Error('key');
      if(response.status>=300&&response.status<400)throw Error('redirect');
      if(!response.ok)throw Error('status:'+response.status);
      return body;
    }
    async function fetchFeeds(standard,days,start){
      return Promise.all(instruments.map(async instrument=>{
        const product=products[instrument][standard?1:0];
        const path=[env.FIRMS_MAP_KEY,product,area==='world'?area:coords.join(','),days,...(start?[start]:[])].join('/');
        const csv=await nasa('area/csv/'+path);
        const fields=csv.trimStart().split(/\r?\n/,1)[0].toLowerCase().split(',').map(field=>field.trim().replace(/^"|"$/g,''));
        if(!['latitude','longitude','acq_date','acq_time'].every(field=>fields.includes(field)))throw Error('FIRMS response unavailable');
        return {product,csv};
      }));
    }
    const hasRows=feeds=>feeds.some(feed=>feed.csv.trim().split(/\r?\n/).length>1);
    let feeds=[];
    if(date){
      const batches=Array.from({length:Math.ceil(span/5)},(_,index)=>{
        const offset=index*5;
        return [Math.min(5,span-offset),new Date(+day+offset*86400000).toISOString().slice(0,10)];
      });
      for(let i=0;i<batches.length;i+=3){
        const result=await Promise.all(batches.slice(i,i+3).map(([days,start])=>fetchFeeds(true,days,start)));
        feeds.push(...result.flat());
      }
    }else{
      feeds=await fetchFeeds(false,3,null);
    }
    let mode=date?'dated':'recent';
    let window=date?{start:date,end:end??date}:null;
    if(!date&&area==='world'&&!hasRows(feeds)){
      try{
        const availability=await nasa('data_availability/csv/'+env.FIRMS_MAP_KEY+'/ALL');
        const dates=instruments.map(instrument=>{
          const product=products[instrument][1];
          const line=availability.split(/\r?\n/).find(row=>row.split(',')[0].trim().replace(/^"|"$/g,'')===product);
          return line?.match(/\d{4}-\d{2}-\d{2}/g)?.sort().at(-1);
        });
        if(dates.every(Boolean)){
          const end=dates.sort()[0];
          const start=new Date(Date.parse(end)-4*86400000).toISOString().slice(0,10);
          feeds=await fetchFeeds(true,5,start);
          mode='archive';
          window={start,end};
        }
      }catch{
        // Keep the successful recent response if the archive cannot be fetched.
      }
    }
    return Response.json({feeds,mode,window,empty:!hasRows(feeds)},{headers:{'Cache-Control':'private, max-age:120'}});
  }catch(cause){
    if(cause.message==='key')return error('NASA FIRMS rejected the configured MAP_KEY. Check that it is the FIRMS key, rather than an api.nasa.gov developer key.',502);
    if(cause.message==='redirect')return error('NASA FIRMS redirected the request. Hotspot records could not load.',502);
    if(/^status:\d{3}$/.test(cause.message))return error('NASA FIRMS returned HTTP '+cause.message.slice(7)+'. Try another region or date.',502);
    if(cause.message==='FIRMS response unavailable')return error('NASA FIRMS returned a response without hotspot CSV fields. Try another region or instrument.',502);
    return error('The site could not reach NASA FIRMS. Try refreshing the feed.',502);
  }
}
