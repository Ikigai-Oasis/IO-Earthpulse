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
  const sensor=params.get('sensor');
  if(!['MODIS','VIIRS','Combined'].includes(sensor))return error('Invalid instrument.',400);
  try{
    const feeds=await Promise.all((sensor==='Combined'?['MODIS','VIIRS']:[sensor]).map(async instrument=>{
      const product=products[instrument][date?1:0];
      const path=[env.FIRMS_MAP_KEY,product,area==='world'?area:coords.join(','),'1',...(date?[date]:[])].join('/');
      const response=await fetchData('https://firms.modaps.eosdis.nasa.gov/api/area/csv/'+path,{redirect:'manual',signal:AbortSignal.timeout(18000)});
      const csv=await response.text();
      const reason=csv.trim().slice(0,160);
      if(/^Invalid MAP_KEY\.?$/i.test(reason))throw Error('key');
      if(response.status>=300&&response.status<400)throw Error('redirect');
      if(!response.ok)throw Error('status:'+response.status);
      const fields=csv.trimStart().split(/\r?\n/,1)[0].toLowerCase().split(',').map(field=>field.trim().replace(/^"|"$/g,''));
      if(!response.ok||!['latitude','longitude','acq_date','acq_time'].every(field=>fields.includes(field)))throw Error('FIRMS response unavailable');
      return {product,csv};
    }));
    return Response.json({feeds},{headers:{'Cache-Control':'private, max-age=120'}});
  }catch(cause){
    if(cause.message==='key')return error('NASA FIRMS rejected the configured MAP_KEY. Check that it is the FIRMS key, rather than an api.nasa.gov developer key.',502);
    if(cause.message==='redirect')return error('NASA FIRMS redirected the request. Hotspot records could not load.',502);
    if(/^status:\d{3}$/.test(cause.message))return error('NASA FIRMS returned HTTP '+cause.message.slice(7)+'. Try another region or date.',502);
    if(cause.message==='FIRMS response unavailable')return error('NASA FIRMS returned a response without hotspot CSV fields. Try another region or instrument.',502);
    return error('The site could not reach NASA FIRMS. Try refreshing the feed.',502);
  }
}
