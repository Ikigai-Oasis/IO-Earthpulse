// IO earthpulse enhancements: harmonized fire history, Fire Detective game, NASA POWER Earth Trends.
// Additive module: listens to 'earthpulse:render' events from app.js and renders extra cards.
import {within,cellDays,dayAt} from './engine.mjs';

const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!==undefined)e.innerHTML=html;return e};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=v=>!Number.isFinite(v)?'–':v>=1e4?Math.round(v/1e3)+'k':v>=1e3?(v/1e3).toFixed(1)+'k':v>=100?Math.round(v).toString():v>=10?v.toFixed(0):v.toFixed(v%1?1:0);
const full=v=>Number.isFinite(v)?Math.round(v).toLocaleString('en-CA'):'–';
const median=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
const quant=(a,q)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),p=(s.length-1)*q,b=Math.floor(p);return s[b]+(s[Math.min(b+1,s.length-1)]-s[b])*(p-b)};

/* ---------- statistics ---------- */
function erf(x){const t=1/(1+.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return x>=0?y:-y}
export function mannKendall(v){
  const n=v.length;if(n<4)return null;let s=0;
  for(let i=0;i<n-1;i++)for(let j=i+1;j<n;j++)s+=Math.sign(v[j]-v[i]);
  const ties={};v.forEach(x=>ties[x]=(ties[x]||0)+1);let tc=0;
  Object.values(ties).forEach(t=>{if(t>1)tc+=t*(t-1)*(2*t+5)});
  const vs=(n*(n-1)*(2*n+5)-tc)/18;if(vs<=0)return {s,z:0,p:1};
  const z=s>0?(s-1)/Math.sqrt(vs):s<0?(s+1)/Math.sqrt(vs):0;
  return {s,z,p:2*(1-.5*(1+erf(Math.abs(z)/Math.SQRT2)))};
}
export function senSlope(xs,ys){
  const sl=[];for(let i=0;i<xs.length-1;i++)for(let j=i+1;j<xs.length;j++)if(xs[j]!==xs[i])sl.push((ys[j]-ys[i])/(xs[j]-xs[i]));
  const b=median(sl);return {b,a:median(ys.map((y,i)=>y-b*xs[i]))};
}
function ols(xs,ys){
  const n=xs.length,mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;
  let sxx=0,sxy=0;for(let i=0;i<n;i++){sxx+=(xs[i]-mx)**2;sxy+=(xs[i]-mx)*(ys[i]-my)}
  const b=sxy/sxx,a=my-b*mx;let sse=0;for(let i=0;i<n;i++)sse+=(ys[i]-a-b*xs[i])**2;
  const se=Math.sqrt(sse/(n-2)/sxx);return {a,b,se,ci:1.96*se,mx,my};
}
function pearson(xs,ys){
  const n=xs.length,mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;let a=0,b=0,c=0;
  for(let i=0;i<n;i++){a+=(xs[i]-mx)*(ys[i]-my);b+=(xs[i]-mx)**2;c+=(ys[i]-my)**2}
  return b&&c?a/Math.sqrt(b*c):0;
}
const pText=p=>p<.001?'p < 0.001':'p = '+p.toFixed(3);

/* ---------- colour ramps (perceptual, colourblind-safe) ---------- */
const INFERNO=[[0,'#1b0c41'],[.2,'#4a0c6b'],[.35,'#781c6d'],[.5,'#a52c60'],[.65,'#cf4446'],[.78,'#ed6925'],[.9,'#fb9b06'],[1,'#fcffa4']];
const DIVERGE=[[0,'#3b4cc0'],[.25,'#7b9ff9'],[.5,'#2a3236'],[.75,'#f49a7b'],[1,'#c0282d']];
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function ramp(stops,t){t=Math.max(0,Math.min(1,t));for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){const[t0,c0]=stops[i-1],[t1,c1]=stops[i],u=(t-t0)/(t1-t0),a=hex(c0),b=hex(c1);return a.map((x,k)=>Math.round(x+(b[k]-x)*u))}return hex(stops.at(-1)[1])}
const rgb=c=>`rgb(${c})`,ink=c=>(.2126*c[0]+.7152*c[1]+.0722*c[2])>150?'#111':'#fff';
const grad=s=>`linear-gradient(90deg,${s.map(([t,c])=>c+' '+t*100+'%').join(',')})`;

/* ---------- small SVG chart kit ---------- */
function ticks(max,n=4){if(!(max>0))return[0,1];const raw=max/n,p=10**Math.floor(Math.log10(raw)),st=[1,2,2.5,5,10].map(x=>x*p).find(x=>x>=raw);const o=[];for(let v=0;v<=max+st*1e-3;v+=st)o.push(+v.toFixed(10));if(o.at(-1)<max)o.push(o.at(-1)+st);return o}
function rangeTicks(lo,hi,n=4){const span=hi-lo||1,raw=span/n,p=10**Math.floor(Math.log10(raw)),st=[1,2,2.5,5,10].map(x=>x*p).find(x=>x>=raw);const o=[];for(let v=Math.floor(lo/st)*st;v<=hi+st*1e-3;v+=st)o.push(+v.toFixed(10));return o}

/* ---------- harmonized fire history ---------- */
let history=null, histKey=null, calMode='count', lastDetail=null;
function buildHistory(d){
  const rows=d.observations.filter(r=>within(r.lat,r.lon,d.region));
  const cells=cellDays(rows);
  const mi=date=>(+date.slice(0,4)-2000)*12+(+date.slice(5,7)-1);
  // sensor coverage from all loaded rows (not just the region)
  const has=[new Set(),new Set()];
  for(const r of d.observations)has[r.sensor==='VIIRS'?1:0].add(mi(r.date));
  const span=s=>has[s].size?[Math.min(...has[s]),Math.max(...has[s])]:null;
  const cov=[span(0),span(1)];
  const covered=(s,m)=>d.sample?has[s].has(m):!!cov[s]&&m>=cov[s][0]&&m<=cov[s][1];
  const all=[...has[0],...has[1]];if(!all.length)return null;
  const m0=Math.floor(Math.min(...all)/12)*12,m1=Math.max(...all);
  const N=m1-m0+1,M=new Float64Array(N),V=new Float64Array(N),C=new Float64Array(N);
  for(const c of cells){const k=mi(c.date)-m0;C[k]++;if(c.sensors.has('MODIS'))M[k]++;if(c.sensors.has('VIIRS'))V[k]++}
  // calibrate MODIS-only cell-days to combined (MODIS+VIIRS) cell-days on months both instruments observed
  const pairs=[];for(let k=0;k<N;k++){const m=m0+k;if(covered(0,m)&&covered(1,m)&&(M[k]||C[k]))pairs.push([M[k],C[k],m])}
  let fit=null;
  if(pairs.length>=3){let sxy=0,sxx=0;pairs.forEach(([x,y])=>{sxy+=x*y;sxx+=x*x});if(sxx){const r=pearson(pairs.map(p=>p[0]),pairs.map(p=>p[1]));fit={k:sxy/sxx,r2:r*r,n:pairs.length}}}
  const H=new Float64Array(N).fill(NaN),src=new Array(N).fill('');
  for(let k=0;k<N;k++){const m=m0+k,cm=covered(0,m),cv=covered(1,m);
    if(cv){H[k]=C[k];src[k]=cm?'B':'V'}else if(cm){H[k]=fit?fit.k*M[k]:M[k];src[k]='M'}}
  return {m0,m1,N,M,V,C,H,src,fit,pairs,cov,y0:2000+Math.floor(m0/12),y1:2000+Math.floor(m1/12),sample:d.sample};
}
const hv=(h,y,mo)=>{const k=(y-2000)*12+mo-h.m0;return k>=0&&k<h.N?h.H[k]:NaN};
const monthMedian=(h,mo,except)=>{const v=[];for(let y=h.y0;y<=h.y1;y++){if(y===except)continue;const x=hv(h,y,mo);if(Number.isFinite(x))v.push(x)}return median(v)};

function historyCard(){
  const card=el('article','card xp-card xp-history');
  card.innerHTML=`<div class="card-head"><div><h2>Fire history · harmonized calendar</h2><p>Every month on record. MODIS-only years are calibrated to the combined MODIS + VIIRS scale so all years compare fairly.</p></div>
  <div class="xp-seg" role="group" aria-label="Calendar view"><button data-cal="count" aria-pressed="true">Cell-days</button><button data-cal="anom" aria-pressed="false">vs median</button></div></div>
  <div class="xp-kpis" id="xp-kpis"></div><div class="xp-calwrap"><table class="xp-cal" id="xp-cal"></table></div>
  <div class="card-foot"><span id="xp-legend"></span><span class="xp-foot-actions"><span id="xp-fit"></span><button id="xp-csv">↓ Calendar CSV</button></span></div>`;
  card.querySelectorAll('[data-cal]').forEach(b=>b.onclick=()=>{calMode=b.dataset.cal;card.querySelectorAll('[data-cal]').forEach(x=>x.setAttribute('aria-pressed',x===b));renderHistory()});
  card.querySelector('#xp-csv').onclick=exportHistory;
  card.querySelector('#xp-cal').onclick=e=>{const td=e.target.closest('td[data-y]');if(!td)return;window.dispatchEvent(new CustomEvent('earthpulse:goto',{detail:{year:+td.dataset.y,month:+td.dataset.mo+1}}))};
  return card;
}
function renderHistory(){
  const h=history,t=document.getElementById('xp-cal');if(!t)return;
  if(!h){t.innerHTML='<tr><td class="xp-empty">Load or import FIRMS records to build the history.</td></tr>';document.getElementById('xp-kpis').innerHTML='';return}
  let max=0;for(const v of h.H)if(v>max)max=v;const lmax=Math.log1p(max)||1,anom=calMode==='anom';
  let html=`<thead><tr><th></th>${MON.map(m=>`<th>${m}</th>`).join('')}<th class="xp-tot">Year</th></tr></thead><tbody>`;
  for(let y=h.y1;y>=h.y0;y--){
    html+=`<tr><th class="xp-y">${y}</th>`;let tot=0,k=0;
    for(let mo=0;mo<12;mo++){
      const v=hv(h,y,mo),idx=(y-2000)*12+mo-h.m0;
      if(!Number.isFinite(v)){html+='<td class="xp-na"></td>';continue}
      tot+=v;k++;const med=monthMedian(h,mo,y),pct=med>0?(v-med)/med*100:v>0?Infinity:0;
      let bg,txt;
      if(anom){bg=ramp(DIVERGE,(Math.max(-2,Math.min(2,Math.log2((v+1)/(med+1))))+2)/4);txt=Number.isFinite(med)?(Number.isFinite(pct)?(pct>=0?'+':'')+Math.round(pct)+'%':'new'):'–'}
      else{bg=v>0?ramp(INFERNO,.08+.92*Math.log1p(v)/lmax):null;txt=fmt(v)}
      const src={B:'MODIS + VIIRS',V:'VIIRS',M:'MODIS, calibrated'}[h.src[idx]];
      const tip=`${MON[mo]} ${y}: ${full(v)} cell-days (${src})\nMedian ${MON[mo]} in other years: ${full(med)}${Number.isFinite(pct)&&Number.isFinite(med)?'\nAnomaly: '+(pct>=0?'+':'')+Math.round(pct)+'%':''}\nClick to open this month in the explorer`;
      html+=`<td class="xp-s${h.src[idx]}" data-y="${y}" data-mo="${mo}" title="${esc(tip)}" style="${bg?`background:${rgb(bg)};color:${ink(bg)}`:''}">${txt}</td>`;
    }
    html+=`<td class="xp-tot">${k?fmt(tot)+(k<12?'*':''):''}</td></tr>`;
  }
  t.innerHTML=html+'</tbody>';
  document.getElementById('xp-legend').innerHTML=anom
    ?`Below median <i class="xp-ramp" style="background:${grad(DIVERGE)}"></i> Above median · <b class="xp-u xp-uM"></b>MODIS calibrated <b class="xp-u xp-uV"></b>VIIRS/both · * partial year`
    :`0 <i class="xp-ramp" style="background:${grad(INFERNO)}"></i> ${fmt(max)} per month · <b class="xp-u xp-uM"></b>MODIS calibrated <b class="xp-u xp-uV"></b>VIIRS/both · * partial year`;
  document.getElementById('xp-fit').textContent=h.fit?`Calibration: combined ≈ ${h.fit.k.toFixed(2)} × MODIS (R² ${h.fit.r2.toFixed(2)}, ${h.fit.n} months)`:'Calibration needs 3+ months observed by both instruments';
  // KPIs
  const clim=MON.map((_,mo)=>monthMedian(h,mo,null));let pk=-1;clim.forEach((v,i)=>{if(Number.isFinite(v)&&(pk<0||v>clim[pk]))pk=i});if(pk<0)pk=0;
  const ann=[];for(let y=h.y0;y<=h.y1;y++){let s=0,k=0;for(let mo=0;mo<12;mo++){const v=hv(h,y,mo);if(Number.isFinite(v)){s+=v;k++}}if(k)ann.push({y,t:s,k})}
  const comp=ann.filter(a=>a.k===12);
  let last=null;outer:for(let y=h.y1;y>=h.y0;y--)for(let mo=11;mo>=0;mo--)if(Number.isFinite(hv(h,y,mo))){last={y,mo};break outer}
  let lastTxt='–',lastChip='';
  if(last){const v=hv(h,last.y,last.mo),med=monthMedian(h,last.mo,last.y);
    if(Number.isFinite(med)){const pct=med>0?(v-med)/med*100:v>0?Infinity:0;lastTxt=Number.isFinite(pct)?(pct>=0?'+':'')+Math.round(pct)+'%':'new';
      const [cls,word]=pct>50?['c-hot','Well above normal']:pct>15?['c-warm','Above normal']:pct<-15?['c-cool','Below normal']:['c-flat','Near normal'];
      lastChip=`<em class="xp-chip ${cls}">${word}</em><small>${MON[last.mo]} ${last.y}: ${full(v)} vs median ${full(med)}</small>`}
    else lastChip=`<small>${MON[last.mo]} ${last.y}: no earlier ${MON[last.mo]} to compare</small>`}
  const series=comp.length>=4?comp:ann;let trend='–',trendChip='<small>Needs 4+ years of data</small>';
  if(series.length>=4){const mk=mannKendall(series.map(a=>a.t)),ss=senSlope(series.map(a=>a.y),series.map(a=>a.t));
    trend=(ss.b>=0?'+':'')+fmt(ss.b)+'/yr';
    trendChip=`<em class="xp-chip ${mk.p<.05?(ss.b>0?'c-hot':'c-cool'):'c-flat'}">${mk.p<.05?'Significant '+(ss.b>0?'increase':'decrease'):'Not significant'}</em><small>Mann-Kendall ${pText(mk.p)}, ${series.length} ${series===comp?'complete ':''}years</small>`}
  document.getElementById('xp-kpis').innerHTML=`
    <div><span>Peak fire month</span><strong>${Number.isFinite(clim[pk])?MON[pk]:'–'}</strong><small>median ${full(clim[pk])} cell-days</small></div>
    <div><span>Latest month vs history</span><strong>${lastTxt}</strong>${lastChip}</div>
    <div><span>Trend in yearly totals</span><strong>${trend}</strong>${trendChip}</div>`;
}
function exportHistory(){
  const h=history;if(!h)return;
  const rows=[`# IO earthpulse harmonized fire calendar${h.sample?' (SIMULATED DEMO DATA)':''}; region ${lastDetail?.regionKey}; calibration ${h.fit?'combined = '+h.fit.k.toFixed(4)+' x MODIS':'none'}`,'year,month,modis_cell_days,viirs_cell_days,combined_cell_days,harmonized_cell_days,source,median_same_month,anomaly_pct'];
  for(let k=0;k<h.N;k++){const m=h.m0+k,y=2000+Math.floor(m/12),mo=m%12,v=h.H[k],med=monthMedian(h,mo,y);
    rows.push([y,mo+1,h.M[k],h.V[k],h.C[k],Number.isFinite(v)?v.toFixed(1):'',{B:'both',V:'viirs',M:'modis_calibrated'}[h.src[k]]||'',Number.isFinite(med)?med.toFixed(1):'',med>0&&Number.isFinite(v)?((v-med)/med*100).toFixed(1):''].join(','))}
  const url=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));const a=el('a');a.href=url;a.download='io-earthpulse-calendar-'+(lastDetail?.regionKey||'region')+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* ---------- Fire Detective game ---------- */
let game={score:0,round:0,streak:0,best:0,q:null,answered:false,plays:0};
function detectiveCard(){
  const card=el('article','card xp-card xp-game');
  card.innerHTML=`<div class="card-head"><div><h2>Fire Detective</h2><p>Three questions about the data on screen. Read the map, calendar and charts, then answer.</p></div><span class="edition" id="xp-score">SCORE 0</span></div>
  <div class="xp-game-body"><div class="xp-progress" id="xp-progress"></div><p class="xp-q" id="xp-q"></p><div class="xp-opts" id="xp-opts"></div><p class="xp-explain" id="xp-explain" aria-live="polite"></p>
  <div class="xp-game-actions"><button id="xp-next">Start investigation</button><span id="xp-badge"></span></div></div>`;
  card.querySelector('#xp-next').onclick=nextRound;
  return card;
}
function makeQuestions(d){
  const cells=cellDays(d.observations.filter(r=>within(r.lat,r.lon,d.region)));
  const ym=d.year+'-'+String(d.month).padStart(2,'0'),mName=MON[d.month-1]+' '+d.year;
  const inMonth=cells.filter(c=>c.date.startsWith(ym));const qs=[];
  // Q1 busiest day
  const byDay=new Map();inMonth.forEach(c=>byDay.set(c.date,(byDay.get(c.date)||0)+1));
  const days=[...byDay].sort((a,b)=>b[1]-a[1]);
  if(days.length>=3){const best=days[0],others=[days[Math.floor(days.length/2)],days.at(-1)];
    const opts=[best,...others].map(([dt,v])=>({label:MON[+dt.slice(5,7)-1]+' '+(+dt.slice(8)),v})).sort(()=>Math.random()-.5);
    qs.push({q:`Which day in ${mName} had the most hotspot cells?`,opts:opts.map(o=>o.label),answer:opts.findIndex(o=>o.v===best[1]&&o.label===MON[+best[0].slice(5,7)-1]+' '+(+best[0].slice(8))),
      why:`${MON[+best[0].slice(5,7)-1]} ${+best[0].slice(8)} had ${best[1]} cells. The other options had ${others.map(o=>o[1]).join(' and ')}. Tip: the darkest square in the Fire calendar marks the peak day.`})}
  // Q2 sensor
  const m=inMonth.filter(c=>c.sensors.has('MODIS')).length,v=inMonth.filter(c=>c.sensors.has('VIIRS')).length;
  if(m+v>0)qs.push({q:`In ${mName}, which instrument detected hotspots in more grid cells?`,opts:['MODIS (1 km pixels)','VIIRS (375 m pixels)','About the same'],
    answer:Math.abs(m-v)<=Math.max(m,v)*.1?2:v>m?1:0,why:`VIIRS saw ${v} cell-days and MODIS saw ${m}. VIIRS has smaller pixels, so it usually catches smaller fires that MODIS misses. That is why the two records must be harmonized before comparing years.`});
  // Q3 above/below prior median
  const yrs=[...new Set(cells.map(c=>c.date.slice(0,4)))].map(Number).filter(y=>y<d.year);
  const tot=y=>cells.filter(c=>c.date.startsWith(y+'-'+String(d.month).padStart(2,'0'))).length;
  const prior=yrs.map(tot).filter(x=>x>0);
  if(prior.length>=2){const cur=tot(d.year),med=median(prior);
    qs.push({q:`Compared with earlier years, was ${mName} above or below the usual ${MON[d.month-1]}?`,opts:['Above the median','Below the median'],answer:cur>=med?0:1,
      why:`${mName} had ${cur} cell-days. The median ${MON[d.month-1]} in ${yrs.length} earlier years was ${full(med)}. "Compare seasons" in the Analysis workspace shows this as a chart.`})}
  // Q4 persistence
  const loc=new Map();inMonth.forEach(c=>{const k=c.x+':'+c.y;loc.set(k,(loc.get(k)||0)+1)});
  if(loc.size>=5){const rep=[...loc.values()].filter(x=>x>1).length,share=rep/loc.size;
    qs.push({q:`What share of hotspot locations in ${mName} were detected on more than one day?`,opts:['Under 20%','20–50%','Over 50%'],answer:share<.2?0:share<=.5?1:2,
      why:`${rep} of ${loc.size} locations (${Math.round(share*100)}%) were seen on 2+ days. Repeat detections can mean a long-burning fire, but satellite revisits can also catch the same fire twice.`})}
  return qs.slice(0,3);
}
function nextRound(){
  const d=lastDetail;if(!d)return;
  if(!game.qs||game.round>=game.qs.length){game.qs=makeQuestions(d);game.round=0;game.score=0;game.plays++;
    if(!game.qs.length){document.getElementById('xp-q').textContent='Not enough records in this month for an investigation. Pick a busier month or load more data.';return}}
  const q=game.qs[game.round];game.answered=false;
  document.getElementById('xp-q').textContent=`Case ${game.round+1} of ${game.qs.length}: ${q.q}`;
  document.getElementById('xp-explain').textContent='';document.getElementById('xp-badge').textContent='';
  document.getElementById('xp-progress').innerHTML=game.qs.map((_,i)=>`<i class="${i<game.round?'done':i===game.round?'now':''}"></i>`).join('');
  const box=document.getElementById('xp-opts');box.replaceChildren(...q.opts.map((o,i)=>{const b=el('button','',esc(o));b.onclick=()=>answer(i,b);return b}));
  const nb=document.getElementById('xp-next');nb.hidden=true;
}
function answer(i,btn){
  if(game.answered)return;game.answered=true;const q=game.qs[game.round],ok=i===q.answer;
  if(ok){game.score++;game.streak++;game.best=Math.max(game.best,game.streak)}else game.streak=0;
  [...document.getElementById('xp-opts').children].forEach((b,k)=>{b.disabled=true;b.classList.toggle('right',k===q.answer);b.classList.toggle('wrong',k===i&&!ok)});
  document.getElementById('xp-explain').innerHTML=`<b>${ok?'Correct.':'Not quite.'}</b> ${esc(q.why)}`;
  document.getElementById('xp-score').textContent=`SCORE ${game.score}/${game.qs.length} · STREAK ${game.streak}`;
  game.round++;const nb=document.getElementById('xp-next');nb.hidden=false;
  if(game.round>=game.qs.length){
    const r=game.score/game.qs.length,badge=r===1?['🔥','Fire Detective','Perfect case file.']:r>=.6?['🛰','Satellite Analyst','Solid reading of the evidence.']:['🌫','Smoke Reader','Every detective starts somewhere.'];
    document.getElementById('xp-badge').innerHTML=`<span class="xp-badge" aria-hidden="true">${badge[0]}</span><b>${badge[1]}</b> · ${badge[2]} Best streak ${game.best}.`;
    nb.textContent='New investigation';document.getElementById('xp-progress').innerHTML=game.qs.map(()=>'<i class="done"></i>').join('');
  }else nb.textContent='Next case';
}

/* ---------- mount on Fire Intelligence ---------- */
function mount(){
  const host=document.getElementById('xp');if(!host||host.childElementCount)return;
  host.append(historyCard(),detectiveCard());
}
window.addEventListener('earthpulse:render',e=>{
  const d=e.detail;lastDetail=d;mount();
  const key=d.observations.length+'|'+d.regionKey+'|'+[d.region.west,d.region.south,d.region.east,d.region.north].join(',')+'|'+d.sample;
  if(key!==histKey){histKey=key;history=buildHistory(d);renderHistory();game.qs=null;}
});

/* ---------- Earth Trends · NASA POWER ---------- */
const VARS={
  T2M:{name:'Air temperature',unit:'°C',def:'Average air temperature 2 m above the ground.',agg:'mean',up:'warming',down:'cooling'},
  T2M_MAX:{name:'Daily maximum temperature',unit:'°C',def:'Average of each day\'s hottest temperature. Hot afternoons dry out forest fuels.',agg:'mean',up:'hotter afternoons',down:'cooler afternoons'},
  PRECTOTCORR:{name:'Precipitation',unit:'mm/day',def:'Rain and snow reaching the ground, averaged per day. Less rain means drier fuels.',agg:'mean',up:'wetter',down:'drier'},
  RH2M:{name:'Relative humidity',unit:'%',def:'How close the air is to saturation. Low humidity lets fires spread faster.',agg:'mean',up:'more humid',down:'drier air'},
  WS2M:{name:'Wind speed',unit:'m/s',def:'Average wind speed 2 m above the ground. Wind pushes fire fronts forward.',agg:'mean',up:'windier',down:'calmer'},
  GWETTOP:{name:'Surface soil wetness',unit:'0–1',def:'How wet the top 5 cm of soil is, from 0 (dry) to 1 (saturated).',agg:'mean',up:'wetter soils',down:'drier soils'}
};
const SEASONS={annual:['Whole year',[0,1,2,3,4,5,6,7,8,9,10,11]],fire:['Fire season (May–Sep)',[4,5,6,7,8]],summer:['Summer (Jun–Aug)',[5,6,7]],spring:['Spring (Mar–May)',[2,3,4]],winter:['Winter (Dec–Feb)',[11,0,1]]};
const QUESTIONS=[['Is the fire season getting hotter?','T2M_MAX','fire'],['Is summer getting drier?','PRECTOTCORR','summer'],['Is the air getting drier during fire season?','RH2M','fire'],['Are soils drying out in spring?','GWETTOP','spring']];
const powerCache=new Map();
let trend={lat:48.38,lon:-89.25,place:'Thunder Bay',v:'T2M_MAX',season:'fire',data:null,status:''};
async function loadPower(lat,lon){
  const key=lat.toFixed(2)+','+lon.toFixed(2);if(powerCache.has(key))return powerCache.get(key);
  const end=new Date().getUTCFullYear()-1;
  const url=`https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=${Object.keys(VARS).join(',')}&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=1981&end=${end}&format=JSON`;
  const res=await fetch(url);if(!res.ok)throw Error('NASA POWER returned HTTP '+res.status);
  const json=await res.json(),par=json?.properties?.parameter;if(!par)throw Error('NASA POWER returned no parameters');
  powerCache.set(key,par);return par;
}
function seasonSeries(par,v,season){
  const months=SEASONS[season][1],byYear=new Map();
  for(const [k,val] of Object.entries(par[v]||{})){
    const y=+k.slice(0,4),mo=+k.slice(4)-1;if(mo>11||val===-999||!Number.isFinite(val))continue;
    if(!months.includes(mo))continue;const yy=season==='winter'&&mo===11?y+1:y;
    if(!byYear.has(yy))byYear.set(yy,[]);byYear.get(yy).push(val);
  }
  return [...byYear].filter(([,a])=>a.length===months.length).map(([y,a])=>({y,v:a.reduce((s,x)=>s+x,0)/a.length})).sort((a,b)=>a.y-b.y);
}
function trendsPage(){
  const wrap=el('div','xp-trends');
  wrap.innerHTML=`<div class="eyebrow">EARTH SYSTEM TREND DETECTIVE</div><h1>Earth Trends</h1><p>Is the climate behind the fires changing? Pick a place and a variable from NASA POWER (MERRA-2 and satellite-derived data since 1981), then test whether the trend is significant.</p>
  <div class="xp-qs" id="xp-qs">${QUESTIONS.map((q,i)=>`<button data-q="${i}">${esc(q[0])}</button>`).join('')}</div>
  <div class="actions xp-trend-controls">
    <label>Place <select id="xp-place"><option value="48.38,-89.25,Thunder Bay">Thunder Bay, ON</option><option value="49.79,-92.84,Dryden">Dryden, ON</option><option value="50.99,-93.79,Red Lake">Red Lake, ON</option><option value="56.73,-111.38,Fort McMurray">Fort McMurray, AB</option><option value="39.76,-121.62,Paradise">Paradise, CA</option><option value="-8.76,-63.90,Porto Velho">Porto Velho, Brazil</option><option value="-33.87,151.21,Sydney">Sydney, Australia</option><option value="38.72,-9.14,Lisbon">Lisbon, Portugal</option><option value="custom">Custom point…</option></select></label>
    <label id="xp-custom" hidden>Lat <input id="xp-lat" type="number" step="0.01" value="48.38"> Lon <input id="xp-lon" type="number" step="0.01" value="-89.25"> <button id="xp-go">Go</button></label>
    <label>Variable <select id="xp-var">${Object.entries(VARS).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('')}</select></label>
    <label>Season <select id="xp-season">${Object.entries(SEASONS).map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join('')}</select></label>
  </div>
  <div class="notice" id="xp-tstatus" role="status"></div>
  <div class="xp-trend-grid"><article class="card"><div class="card-head"><div><h2 id="xp-ttitle"></h2><p id="xp-tdef"></p></div><span class="edition">NASA POWER</span></div><div id="xp-tchart" class="xp-chart"></div>
  <div class="card-foot"><span>Bars: each year's average · Line: Sen's slope trend · Band: 95% confidence range of a linear fit</span></div></article>
  <article class="card xp-verdict"><div class="card-head"><div><h2>Verdict</h2><p>What the statistics say</p></div></div><div id="xp-verdict" class="xp-verdict-body"></div></article></div>
  <article class="card xp-link"><div class="card-head"><div><h2>Fire link</h2><p>Does this variable move with yearly hotspot activity in the loaded fire records?</p></div></div><div id="xp-firelink" class="xp-verdict-body"></div></article>
  <p class="xp-src">Data: NASA Prediction Of Worldwide Energy Resources (POWER) project, monthly point API, power.larc.nasa.gov. Grid ≈ 0.5° × 0.625°, so values describe the surrounding area, not one street.</p>`;
  const sync=()=>{wrap.querySelector('#xp-var').value=trend.v;wrap.querySelector('#xp-season').value=trend.season};
  wrap.querySelector('#xp-qs').onclick=e=>{const b=e.target.closest('[data-q]');if(!b)return;const q=QUESTIONS[+b.dataset.q];trend.v=q[1];trend.season=q[2];sync();drawTrend()};
  wrap.querySelector('#xp-var').onchange=e=>{trend.v=e.target.value;drawTrend()};
  wrap.querySelector('#xp-season').onchange=e=>{trend.season=e.target.value;drawTrend()};
  wrap.querySelector('#xp-place').onchange=e=>{const v=e.target.value;wrap.querySelector('#xp-custom').hidden=v!=='custom';if(v==='custom')return;const[a,b,c]=v.split(',');trend.lat=+a;trend.lon=+b;trend.place=c;fetchTrend()};
  wrap.querySelector('#xp-go').onclick=()=>{const a=+wrap.querySelector('#xp-lat').value,b=+wrap.querySelector('#xp-lon').value;if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180)return;trend.lat=a;trend.lon=b;trend.place=a.toFixed(2)+', '+b.toFixed(2);fetchTrend()};
  sync();setTimeout(fetchTrend,0);return wrap;
}
async function fetchTrend(){
  const st=document.getElementById('xp-tstatus');if(!st)return;st.textContent='Loading NASA POWER monthly data for '+trend.place+'…';
  try{trend.data=await loadPower(trend.lat,trend.lon);trend.status='';drawTrend()}
  catch(e){trend.data=null;st.textContent='NASA POWER could not be reached ('+e.message+'). Check your connection and try again.';document.getElementById('xp-tchart').innerHTML='';document.getElementById('xp-verdict').innerHTML='';document.getElementById('xp-firelink').innerHTML=''}
}
function drawTrend(){
  const box=document.getElementById('xp-tchart');if(!box||!trend.data)return;
  const V=VARS[trend.v],s=seasonSeries(trend.data,trend.v,trend.season);
  document.getElementById('xp-tstatus').textContent=`${trend.place} (${trend.lat.toFixed(2)}°, ${trend.lon.toFixed(2)}°) · ${SEASONS[trend.season][0]} · ${s.length} years from NASA POWER`;
  document.getElementById('xp-ttitle').textContent=`${V.name}, ${SEASONS[trend.season][0].replace(/^./,c=>c.toLowerCase())}, ${trend.place}`;
  document.getElementById('xp-tdef').textContent=V.def;
  if(s.length<8){box.innerHTML='<p class="xp-empty">Not enough complete years for this season.</p>';return}
  const xs=s.map(d=>d.y),ys=s.map(d=>d.v),mk=mannKendall(ys),ss=senSlope(xs,ys),lr=ols(xs,ys);
  const W=Math.max(320,box.clientWidth||700),H=280,P={l:48,r:14,t:14,b:26},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const lo=Math.min(...ys),hi=Math.max(...ys),pad=(hi-lo)*.15||1,yt=rangeTicks(lo-pad,hi+pad,4),y0=yt[0],y1=yt.at(-1);
  const x=y=>P.l+(y-xs[0]+.5)/(xs.length)*iw,y=v=>P.t+ih-(v-y0)/(y1-y0)*ih,bw=iw/xs.length;
  const mean=ys.reduce((a,b)=>a+b,0)/ys.length;
  const bars=s.map(d=>{const c=d.v>=mean?'var(--orange)':'#6ca79f';return `<rect x="${x(d.y)-bw*.36}" y="${Math.min(y(d.v),y(mean))}" width="${bw*.72}" height="${Math.max(1,Math.abs(y(d.v)-y(mean)))}" fill="${c}" opacity=".85" rx="1.5"><title>${d.y}: ${d.v.toFixed(2)} ${V.unit}</title></rect>`}).join('');
  const yb=(xx,sl)=>lr.my+sl*(xx-lr.mx),xa=xs[0],xb=xs.at(-1);
  const band=`<path d="M${x(xa)},${y(Math.max(yb(xa,lr.b+lr.ci),yb(xa,lr.b-lr.ci)))}L${x(xb)},${y(Math.max(yb(xb,lr.b+lr.ci),yb(xb,lr.b-lr.ci)))}L${x(xb)},${y(Math.min(yb(xb,lr.b+lr.ci),yb(xb,lr.b-lr.ci)))}L${x(xa)},${y(Math.min(yb(xa,lr.b+lr.ci),yb(xa,lr.b-lr.ci)))}Z" fill="var(--green)" opacity=".1"/>`;
  const line=`<line x1="${x(xs[0])}" x2="${x(xs.at(-1))}" y1="${y(ss.a+ss.b*xs[0])}" y2="${y(ss.a+ss.b*xs.at(-1))}" stroke="var(--green)" stroke-width="2.5"/>`;
  const step=Math.ceil(xs.length/(W/52));
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(V.name)} by year">
    ${yt.map(v=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P.l-6}" y="${y(v)+4}" text-anchor="end">${+v.toFixed(2)}</text>`).join('')}
    <line x1="${P.l}" x2="${W-P.r}" y1="${y(mean)}" y2="${y(mean)}" stroke="var(--muted)" stroke-dasharray="3 4"/>
    ${bars}${band}${line}${xs.map((yr,i)=>i%step?'':`<text x="${x(yr)}" y="${H-7}" text-anchor="middle">${yr}</text>`).join('')}
    <text x="${P.l}" y="${P.t-2}">${V.unit}</text></svg>`;
  const decade=ss.b*10,sig=mk.p<.05,dir=ss.b>0?V.up:V.down,first=xs[0],lastY=xs.at(-1);
  const change=ss.b*(lastY-first);
  document.getElementById('xp-verdict').innerHTML=`
    <div class="xp-big">${decade>=0?'+':''}${decade.toFixed(Math.abs(decade)<.1?3:2)} <small>${V.unit} per decade</small></div>
    <em class="xp-chip ${sig?(ss.b>0===(trend.v.startsWith('T')||trend.v==='WS2M')?'c-hot':'c-cool'):'c-flat'}">${sig?'Significant trend: '+dir:'No significant trend'}</em>
    <dl><dt>Mann-Kendall test</dt><dd>Z = ${mk.z.toFixed(2)}, ${pText(mk.p)}</dd><dt>Sen's slope</dt><dd>${ss.b>=0?'+':''}${ss.b.toFixed(4)} ${V.unit}/yr</dd><dt>Linear fit, 95% CI</dt><dd>${(lr.b*10).toFixed(3)} ± ${(lr.ci*10).toFixed(3)} per decade</dd><dt>Change ${first}–${lastY}</dt><dd>${change>=0?'+':''}${change.toFixed(2)} ${V.unit}</dd></dl>
    <p>${sig?`Over ${xs.length} years the ${SEASONS[trend.season][0].replace(/^./,c=>c.toLowerCase())} ${V.name.toLowerCase()} near ${esc(trend.place)} moved toward <b>${esc(dir)}</b> more consistently than chance would explain (p &lt; 0.05).`:`The ${V.name.toLowerCase()} wobbles from year to year, and the overall direction is not yet distinguishable from chance. A longer record or a different season might show a clearer signal.`}</p>`;
  drawFireLink(s);
}
function drawFireLink(s){
  const box=document.getElementById('xp-firelink');if(!box)return;const h=history;
  if(!h){box.innerHTML='<p>Load FIRMS records in Fire Intelligence to compare.</p>';return}
  const months=SEASONS[trend.season][1],fire=new Map();
  for(let y=h.y0;y<=h.y1;y++){let t=0,k=0;for(const mo of months){const v=hv(h,y,mo);if(Number.isFinite(v)){t+=v;k++}}if(k===months.length)fire.set(y,t)}
  const both=s.filter(d=>fire.has(d.y));
  if(both.length<4){box.innerHTML=`<p>The loaded fire records cover ${fire.size} complete ${SEASONS[trend.season][0].replace(/^./,c=>c.toLowerCase())} season${fire.size===1?'':'s'}${lastDetail?.sample?' (simulated demo)':''}. Import FIRMS archive CSVs spanning 4+ years for the region you are studying to test the link.</p>`;return}
  const r=pearson(both.map(d=>d.v),both.map(d=>fire.get(d.y)));
  const strength=Math.abs(r)>.6?'strong':Math.abs(r)>.3?'moderate':'weak';
  box.innerHTML=`<div class="xp-big">r = ${r.toFixed(2)}</div><p>A <b>${strength} ${r>0?'positive':'negative'}</b> relationship across ${both.length} seasons: years with ${r>0?'higher':'lower'} ${VARS[trend.v].name.toLowerCase()} tended to have more hotspot cell-days. Correlation is a clue, not proof of cause.</p>`;
}
export function renderTrends(container){container.replaceChildren(trendsPage())}
window.addEventListener('resize',()=>{if(document.getElementById('xp-tchart')&&trend.data)drawTrend()});
