import {GOOGLE_MAPS_KEY} from './config.js';
let loader;
function loadGoogle(key){
  if(loader)return loader;
  loader=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const name='earthpulseGoogleReady';
    const timer=setTimeout(()=>fail('Google Maps did not load. Try again.'),12000);
    const release=()=>{clearTimeout(timer);delete window[name];delete window.gm_authFailure;};
    const fail=message=>{release();script.remove();reject(Error(message));};
    window.gm_authFailure=()=>fail('Google rejected the Maps key. Check billing, the enabled API, and the website restriction.');
    window[name]=()=>{clearTimeout(timer);delete window[name];resolve(window.google.maps);};
    script.onerror=()=>fail('Google Maps could not load. Try again.');
    script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,callback:name,loading:'async',v:'weekly'});
    document.head.append(script);
  }).catch(error=>{loader=null;throw error});
  return loader;
}
export function setupStreet(){
  const get=id=>document.getElementById(id);
  const canvas=get('street-map'),status=get('street-status');
  let map,traffic,service,preparing,position={lat:48.38,lng:-89.25},selecting=false,lookup=0,active=false;
  function links(){
    const coordinates=position.lat.toFixed(5)+','+position.lng.toFixed(5);
    get('street-coordinates').textContent=coordinates;
    get('street-external').href='https://www.google.com/maps/@?'+new URLSearchParams({api:'1',map_action:'map',center:coordinates,zoom:'15',basemap:'satellite',layer:'traffic'});
    get('pano-external').href='https://www.google.com/maps/@?'+new URLSearchParams({api:'1',map_action:'pano',viewpoint:coordinates});
  }
  async function openPano(loc){
    const ticket=++lookup;
    status.textContent='Looking for a nearby panorama…';
    try{
      const {data}=await service.getPanorama({location:loc,radius:80,preference:'nearest'});
      if(!active||ticket!==lookup)return;
      map.getStreetView().setPano(data.location.pano);
      map.getStreetView().setVisible(true);
      status.textContent='Street View · '+(data.imageDate?'captured '+data.imageDate:'capture date unavailable');
    }catch{
      if(active&&ticket===lookup)status.textContent='Street View could not load within 80 m of this point. Try a nearby road or use Pegman.';
    }
  }
  async function show(loc){
    active=true;position=loc;links();
    if(map){map.getStreetView().setVisible(false);map.setCenter(position);map.setZoom(15);return}
    if(preparing)return preparing;
    preparing=(async()=>{
      status.textContent='Checking Google Maps configuration…';
      try{
        let key=GOOGLE_MAPS_KEY;
        if(!key){
          const response=await fetch('/api/maps-config').catch(()=>null);
          if(response?.ok)key=(await response.json()).key;
        }
        if(!key)throw Error('The in-app Google Maps view is waiting for a restricted browser key.');
        const api=await loadGoogle(key);
        const [{Map,TrafficLayer},{StreetViewService}]=await Promise.all([api.importLibrary('maps'),api.importLibrary('streetView')]);
        canvas.hidden=false;
        map=new Map(canvas,{center:position,zoom:15,mapTypeId:'hybrid',streetViewControl:true,gestureHandling:'cooperative'});
        traffic=new TrafficLayer();
        service=new StreetViewService();
        map.addListener('click',event=>{
          if(!event.latLng)return;
          position=event.latLng.toJSON();links();
          if(selecting){selecting=false;get('pick-street').setAttribute('aria-pressed','false');openPano(position);}
        });
        get('traffic-toggle').hidden=false;get('pick-street').hidden=false;
        status.textContent='Select a point on the map or use Pegman for Street View.';
      }catch(error){status.textContent=error.message;}
      finally{preparing=null}
    })();
    return preparing;
  }
  get('traffic-toggle').onclick=()=>{
    const on=get('traffic-toggle').getAttribute('aria-pressed')!=='true';
    traffic.setMap(on?map:null);
    get('traffic-toggle').setAttribute('aria-pressed',on);
  };
  get('pick-street').onclick=()=>{
    selecting=!selecting;
    get('pick-street').setAttribute('aria-pressed',selecting);
    status.textContent=selecting?'Select a point to find nearby 360° imagery.':'Select a point on the map or use Pegman for Street View.';
  };
  return {show,hide(){active=false;lookup++;}};
}
