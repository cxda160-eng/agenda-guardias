import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const TIPOS = {
  g24:{label:'Guardia 24 h', ini:'08:00', fin:'08:00', guardia:true},
  g12:{label:'Guardia 12 h', ini:'08:00', fin:'20:00', guardia:true},
  noc:{label:'Guardia nocturna', ini:'20:00', fin:'08:00', guardia:true},
  fel:{label:'Fellowship / cardiología', ini:'08:00', fin:'16:00'},
  con:{label:'Consultorio / otro trabajo', ini:'14:00', fin:'18:00'},
  plan:{label:'Plan compartido', ini:'', fin:''},
  otro:{label:'Otro', ini:'', fin:''}
};
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const toMin=t=>{const [h,m]=t.split(':').map(Number);return h*60+m};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function horas(e){if(!e.ini||!e.fin)return 0;let a=toMin(e.ini),b=toMin(e.fin);if(b<=a)b+=1440;return (b-a)/60}
const cruza=e=>e.ini&&e.fin&&toMin(e.fin)<=toMin(e.ini);
const fechaLarga=s=>{const d=parse(s);return DIAS[d.getDay()]+' '+d.getDate()+' de '+MESES[d.getMonth()]};
const fechaCorta=s=>{const d=parse(s);return DIAS[d.getDay()].slice(0,3)+' '+d.getDate()+' '+MESES[d.getMonth()].slice(0,3)};
const rango=e=>e.ini?(e.ini+(e.fin?' – '+e.fin+(cruza(e)?' (+1)':''):'')):'Todo el día';
const color=t=>`var(--t-${TIPOS[t]?t:'otro'})`;

// Almacenamiento local: solo la sesión de este dispositivo
const ls={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(_){}},del(k){try{localStorage.removeItem(k)}catch(_){}}};
let sesion={pin:ls.get('ag_pin')||'',nombre:ls.get('ag_nombre')||''};
ls.del('ag_cache'); // copia vieja de la versión Netlify; Firebase guarda su propia copia sin conexión

// Firebase
const configurado=FIREBASE_CONFIG&&FIREBASE_CONFIG.projectId&&!/^PEGAR/.test(FIREBASE_CONFIG.projectId);
let db=null;
if(configurado){
  const app=initializeApp(FIREBASE_CONFIG);
  try{db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}
  catch(_){db=initializeFirestore(app,{})}
}
async function idAgenda(pin){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('agenda-guardias:'+pin));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
let agendaId=null, turnosCol=null, desuscribir=null;

let eventos=[];
const hoy=new Date(); let vista=new Date(hoy.getFullYear(),hoy.getMonth(),1); let sel=iso(hoy); let editId=null;

$('f-tipo').innerHTML=Object.entries(TIPOS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
$('legend').innerHTML=Object.entries(TIPOS).map(([k,v])=>`<span style="--c:${color(k)}">${v.label}</span>`).join('');

function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2800)}
function setSync(txt,err){const s=$('sync');s.textContent=txt;s.classList.toggle('err',!!err)}
const porDia=s=>eventos.filter(e=>e.fecha===s).sort((a,b)=>(a.ini||'').localeCompare(b.ini||''));

function renderCal(){
  $('mes').textContent=MESES[vista.getMonth()]+' '+vista.getFullYear();
  const first=new Date(vista.getFullYear(),vista.getMonth(),1);
  const start=new Date(first); start.setDate(1-((first.getDay()+6)%7));
  const cells=[]; const hoyS=iso(hoy);
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    if(i>=35&&d.getMonth()!==vista.getMonth())break;
    const s=iso(d), ev=porDia(s);
    const cls=['day',d.getMonth()!==vista.getMonth()?'out':'',s===hoyS?'today':'',s===sel?'sel':''].join(' ');
    const chips=ev.slice(0,3).map(e=>`<div class="chip" style="--c:${color(e.tipo)}">${e.ini?e.ini+' ':''}${esc((TIPOS[e.tipo]||TIPOS.otro).label.split(' /')[0])}</div>`).join('');
    const more=ev.length>3?`<div class="more">+${ev.length-3} más</div>`:'';
    cells.push(`<div class="${cls}" data-d="${s}" tabindex="0" role="button" aria-label="${fechaLarga(s)}, ${ev.length} turnos"><span class="num">${d.getDate()}</span>${chips}${more}</div>`);
  }
  $('grid').innerHTML=cells.join('');
}
function itemHTML(e,conFecha){
  const quien=e.creadoPor?` · cargó ${esc(e.creadoPor)}`:'';
  return `<div class="item" style="--c:${color(e.tipo)}" data-id="${esc(e.id)}" tabindex="0" role="button">
    <i></i><div><div class="t">${esc((TIPOS[e.tipo]||TIPOS.otro).label)}</div>
    <div class="m mono">${conFecha?fechaCorta(e.fecha)+' · ':''}${rango(e)}${horas(e)?' · '+horas(e)+' h':''}</div>
    ${e.lugar||e.nota||quien?`<div class="m">${esc(e.lugar)}${e.lugar&&e.nota?' — ':''}${esc(e.nota)}${quien}</div>`:''}</div></div>`;
}
function renderDia(){
  $('dia-titulo').textContent=sel===iso(hoy)?'Hoy, '+fechaLarga(sel):fechaLarga(sel);
  const ev=porDia(sel);
  $('dia-lista').innerHTML=ev.length?ev.map(e=>itemHTML(e,false)).join(''):'<p class="empty">Día libre. Usá el formulario de abajo para agregar un turno.</p>';
}
function renderProx(){
  const hoyS=iso(hoy);
  const prox=eventos.filter(e=>e.fecha>=hoyS).sort((a,b)=>(a.fecha+(a.ini||'')).localeCompare(b.fecha+(b.ini||''))).slice(0,8);
  $('prox-lista').innerHTML=prox.length?prox.map(e=>itemHTML(e,true)).join(''):'<p class="empty">Todavía no hay turnos cargados. Elegí un día en el calendario y agregá la primera guardia.</p>';
}
function renderStats(){
  const y=vista.getFullYear(),m=vista.getMonth();
  const delMes=eventos.filter(e=>{const d=parse(e.fecha);return d.getFullYear()===y&&d.getMonth()===m});
  const g=delMes.filter(e=>TIPOS[e.tipo]?.guardia);
  $('s-guardias').textContent=g.length;
  $('s-horas').textContent=g.reduce((s,e)=>s+horas(e),0)+' h';
  const ocupados=new Set(delMes.filter(e=>e.tipo!=='plan').map(e=>e.fecha));
  $('s-libres').textContent=new Date(y,m+1,0).getDate()-ocupados.size;
  const now=new Date(); const ahora=iso(now)+' '+pad(now.getHours())+':'+pad(now.getMinutes());
  const p=eventos.filter(e=>TIPOS[e.tipo]?.guardia&&(e.fecha+' '+(e.ini||'00:00'))>=ahora).sort((a,b)=>(a.fecha+a.ini).localeCompare(b.fecha+b.ini))[0];
  $('s-prox').textContent=p?fechaCorta(p.fecha)+(p.ini?' · '+p.ini:''):'Sin guardias cargadas';
}
function render(){renderCal();renderDia();renderProx();renderStats();actualizarSugerencias();vistaPrevia()}

// Sincronización en vivo
function escuchar(){
  if(desuscribir)desuscribir();
  desuscribir=onSnapshot(turnosCol,{includeMetadataChanges:true},snap=>{
    eventos=snap.docs.map(d=>({id:d.id,...d.data()})).filter(e=>e.fecha);
    if(snap.metadata.hasPendingWrites)setSync('Guardando…');
    else if(snap.metadata.fromCache)setSync(navigator.onLine?'Conectando…':'Sin conexión · los cambios se guardan al volver la señal',!navigator.onLine);
    else{const t=new Date();setSync('Sincronizado '+pad(t.getHours())+':'+pad(t.getMinutes()));}
    render();
  },err=>{setSync('No se pudo conectar con la agenda',true);console.error(err)});
}
window.addEventListener('offline',()=>setSync('Sin conexión · los cambios se guardan al volver la señal',true));

const permitido=e=>({tipo:e.tipo,fecha:e.fecha,ini:e.ini||'',fin:e.fin||'',lugar:(e.lugar||'').slice(0,80),nota:(e.nota||'').slice(0,300),creadoPor:(e.creadoPor||'').slice(0,40),creado:Number(e.creado)||Date.now(),...(e.editado?{editado:Number(e.editado)}:{})});
const errGuardar=err=>{console.error(err);toast(err&&err.code==='permission-denied'?'Firebase rechazó el cambio: revisá las reglas de la base.':'No se pudo guardar el cambio.')};

// Lugares y accesos rápidos, a partir de lo que ya está cargado
const clave=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const CORTO={g24:'24 h',g12:'12 h',noc:'Nocturna',fel:'Fellowship',con:'Consultorio',plan:'Plan',otro:'Otro'};
function lugaresUsados(){
  const m=new Map();
  for(const e of eventos){const k=clave(e.lugar);if(!k)continue;const x=m.get(k)||{n:0,formas:new Map()};x.n++;x.formas.set(e.lugar.trim(),(x.formas.get(e.lugar.trim())||0)+1);m.set(k,x)}
  return [...m.values()].sort((a,b)=>b.n-a.n).map(x=>[...x.formas.entries()].sort((a,b)=>b[1]-a[1]||(b[0].normalize('NFD').length-a[0].length))[0][0]);
}
function rapidosUsados(){
  const m=new Map();
  for(const e of eventos){
    if(!TIPOS[e.tipo]||e.tipo==='plan')continue;
    const k=[e.tipo,clave(e.lugar),e.ini||'',e.fin||''].join('|');
    const x=m.get(k)||{n:0,e};x.n++;m.set(k,x);
  }
  const lug=new Map(lugaresUsados().map(l=>[clave(l),l]));
  return [...m.values()].filter(x=>x.n>=2).sort((a,b)=>b.n-a.n).slice(0,6).map(({e})=>({tipo:e.tipo,ini:e.ini||'',fin:e.fin||'',lugar:lug.get(clave(e.lugar))||''}));
}
let firmaSug='';
function actualizarSugerencias(){
  const lugares=lugaresUsados(), rap=rapidosUsados();
  const firma=JSON.stringify([lugares,rap]); if(firma===firmaSug)return; firmaSug=firma;
  $('lugares').innerHTML=lugares.map(l=>`<option value="${esc(l)}"></option>`).join('');
  $('lugar-chips').innerHTML=lugares.slice(0,6).map(l=>`<button type="button" class="chip-btn" data-lugar="${esc(l)}">${esc(l)}</button>`).join('');
  $('rapidos').innerHTML=rap.map((r,i)=>`<button type="button" class="chip-btn" data-r="${i}" style="--c:${color(r.tipo)}"><i></i>${esc(CORTO[r.tipo])}${r.lugar?' · '+esc(r.lugar):''}${r.ini&&r.tipo!=='g24'&&r.tipo!=='noc'?' · '+r.ini:''}</button>`).join('');
  $('rapidos').dataset.json=JSON.stringify(rap);
  $('rapidos-box').hidden=!rap.length;
  marcarLugar();
}
function marcarLugar(){const k=clave($('f-lugar').value);$('lugar-chips').querySelectorAll('.chip-btn').forEach(b=>b.setAttribute('aria-pressed',String(clave(b.dataset.lugar)===k&&!!k)))}
$('lugar-chips').addEventListener('click',e=>{const b=e.target.closest('.chip-btn');if(!b)return;$('f-lugar').value=b.dataset.lugar;marcarLugar()});
$('f-lugar').addEventListener('input',marcarLugar);
$('rapidos').addEventListener('click',e=>{
  const b=e.target.closest('.chip-btn');if(!b)return;
  const r=JSON.parse($('rapidos').dataset.json||'[]')[Number(b.dataset.r)];if(!r)return;
  $('f-tipo').value=r.tipo;$('f-ini').value=r.ini;$('f-fin').value=r.fin;$('f-lugar').value=r.lugar;marcarLugar();vistaPrevia();
  toast(CORTO[r.tipo]+(r.lugar?' · '+r.lugar:'')+': elegí la fecha y guardá');
});

// Repetición: fechas de una guardia fija
const MAX_REP=60;
function fechasRepetidas(desde,modo,hasta,dias){
  if(modo==='0'||!hasta||hasta<desde)return [desde];
  const out=[]; const d=parse(desde);
  if(modo==='dias'){
    const set=new Set(dias.length?dias:[d.getDay()]);
    while(iso(d)<=hasta&&out.length<MAX_REP){if(set.has(d.getDay()))out.push(iso(d));d.setDate(d.getDate()+1)}
  }else{
    const paso={w1:7,w2:14,d3:3,d4:4}[modo]||7;
    while(iso(d)<=hasta&&out.length<MAX_REP){out.push(iso(d));d.setDate(d.getDate()+paso)}
  }
  return out;
}
const diasElegidos=()=>[...$('f-dias').querySelectorAll('input:checked')].map(i=>Number(i.value));
const yaExiste=(f,tipo,ini)=>eventos.some(e=>e.fecha===f&&e.tipo===tipo&&(e.ini||'')===ini);
function vistaPrevia(){
  const modo=$('f-rep').value, p=$('rep-prev');
  $('f-hasta').disabled=modo==='0'; $('f-dias').hidden=modo!=='dias';
  if(modo==='0'||editId){p.hidden=true;return}
  const fecha=$('f-fecha').value;
  if(!$('f-hasta').value&&fecha){const d=parse(fecha);d.setDate(d.getDate()+28);$('f-hasta').value=iso(d)}
  if(modo==='dias'&&!diasElegidos().length&&fecha){const cb=$('f-dias').querySelector(`input[value="${parse(fecha).getDay()}"]`);if(cb)cb.checked=true}
  const todas=fechasRepetidas(fecha,modo,$('f-hasta').value,diasElegidos());
  const nuevas=todas.filter(f=>!yaExiste(f,$('f-tipo').value,$('f-ini').value));
  p.hidden=false;
  if(!fecha||!todas.length){p.textContent='Elegí la fecha de inicio y hasta cuándo.';return}
  p.textContent=`Se van a cargar ${nuevas.length} ${nuevas.length===1?'turno':'turnos'}${nuevas.length?` (${fechaCorta(nuevas[0])} → ${fechaCorta(nuevas[nuevas.length-1])})`:''}`+
    (todas.length>nuevas.length?`. ${todas.length-nuevas.length} ya estaban cargados y no se repiten.`:'.')+(todas.length>=MAX_REP?` Máximo ${MAX_REP} por vez.`:'');
}
['f-rep','f-hasta','f-fecha','f-tipo','f-ini'].forEach(id=>$(id).addEventListener('change',vistaPrevia));
$('f-dias').addEventListener('change',vistaPrevia);

// Formulario
function aplicarTipo(){const t=TIPOS[$('f-tipo').value];$('f-ini').value=t.ini;$('f-fin').value=t.fin}
function resetForm(){
  editId=null;$('f').reset();$('f-tipo').value='g24';aplicarTipo();$('f-fecha').value=sel;
  $('f-hasta').value='';$('f-dias').querySelectorAll('input').forEach(i=>i.checked=false);$('rep-row').hidden=false;marcarLugar();vistaPrevia();
  $('form-titulo').textContent='Agregar turno';$('f-cancelar').hidden=true;$('f-borrar').hidden=true;$('f-borrar').textContent='Eliminar';$('f-borrar').dataset.c='';
}
function editar(id){
  const e=eventos.find(x=>x.id===id);if(!e)return;
  editId=id;$('f-tipo').value=TIPOS[e.tipo]?e.tipo:'otro';$('f-fecha').value=e.fecha;$('f-ini').value=e.ini||'';$('f-fin').value=e.fin||'';
  $('f-lugar').value=e.lugar||'';$('f-nota').value=e.nota||'';$('rep-row').hidden=true;marcarLugar();
  $('form-titulo').textContent='Editar turno';$('f-cancelar').hidden=false;$('f-borrar').hidden=false;$('f-borrar').textContent='Eliminar';$('f-borrar').dataset.c='';
  $('form-card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
}
$('f-tipo').addEventListener('change',aplicarTipo);
$('f-cancelar').addEventListener('click',resetForm);
$('f-borrar').addEventListener('click',()=>{
  const b=$('f-borrar');
  if(!b.dataset.c){b.dataset.c='1';b.textContent='Confirmar eliminación';return}
  if(!editId)return;
  deleteDoc(doc(turnosCol,editId)).catch(errGuardar);
  toast('Turno eliminado');resetForm();
});
$('f').addEventListener('submit',ev=>{
  ev.preventDefault();
  const fecha=$('f-fecha').value;if(!fecha){toast('Elegí una fecha.');return}
  const base={tipo:$('f-tipo').value,ini:$('f-ini').value,fin:$('f-fin').value,lugar:$('f-lugar').value.trim(),nota:$('f-nota').value.trim(),creadoPor:sesion.nombre,fecha};
  if(editId){
    const prev=eventos.find(x=>x.id===editId)||{};
    setDoc(doc(turnosCol,editId),permitido({...base,creadoPor:prev.creadoPor||sesion.nombre,creado:prev.creado,editado:Date.now()})).catch(errGuardar);
    toast('Cambios guardados');
  }else{
    const modo=$('f-rep').value;
    let fechas=fechasRepetidas(fecha,modo,$('f-hasta').value,diasElegidos());
    if(modo!=='0')fechas=fechas.filter(f=>!yaExiste(f,base.tipo,base.ini));
    if(!fechas.length){toast('Esas guardias ya estaban cargadas.');return}
    const batch=writeBatch(db);
    for(const f of fechas)batch.set(doc(turnosCol,crypto.randomUUID()),permitido({...base,fecha:f,creado:Date.now()}));
    batch.commit().catch(errGuardar);
    toast(fechas.length>1?fechas.length+' turnos agregados':'Turno agregado');
  }
  sel=fecha;resetForm();render();
});

// Navegación
$('prev').onclick=()=>{vista=new Date(vista.getFullYear(),vista.getMonth()-1,1);render()};
$('next').onclick=()=>{vista=new Date(vista.getFullYear(),vista.getMonth()+1,1);render()};
$('btn-hoy').onclick=()=>{vista=new Date(hoy.getFullYear(),hoy.getMonth(),1);sel=iso(hoy);if(!editId)$('f-fecha').value=sel;render()};
function elegirDia(s){sel=s;const d=parse(s);if(d.getMonth()!==vista.getMonth())vista=new Date(d.getFullYear(),d.getMonth(),1);if(!editId)$('f-fecha').value=s;render()}
$('grid').addEventListener('click',e=>{const c=e.target.closest('.day');if(c)elegirDia(c.dataset.d)});
$('grid').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('day')){e.preventDefault();elegirDia(e.target.dataset.d)}});
for(const id of ['dia-lista','prox-lista']){
  $(id).addEventListener('click',e=>{const it=e.target.closest('.item');if(!it)return;const ev=eventos.find(x=>x.id===it.dataset.id);if(ev&&id==='prox-lista')elegirDia(ev.fecha);editar(it.dataset.id)});
  $(id).addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.classList.contains('item'))e.target.click()});
}

// Exportar al calendario del celular (.ics para importar)
const p2=pad;
function utc(fecha,hora){const [y,m,d]=fecha.split('-').map(Number);const [h,mi]=hora.split(':').map(Number);const t=new Date(Date.UTC(y,m-1,d,h+3,mi));return `${t.getUTCFullYear()}${p2(t.getUTCMonth()+1)}${p2(t.getUTCDate())}T${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}00Z`}
function masDias(fecha,n){const [y,m,d]=fecha.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+n));return `${t.getUTCFullYear()}-${p2(t.getUTCMonth()+1)}-${p2(t.getUTCDate())}`}
const escICS=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/([,;])/g,'\\$1');
function plegar(l){const enc=new TextEncoder();if(enc.encode(l).length<=75)return l;const out=[];let a='';for(const ch of l){if(enc.encode(a+ch).length>(out.length?74:75)){out.push(a);a=''}a+=ch}out.push(a);return out.join('\r\n ')}
function generarICS(lista){
  const ahora=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Agenda de Guardias//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Agenda de Guardias'];
  for(const e of lista){
    const titulo=(TIPOS[e.tipo]||TIPOS.otro).label+(e.lugar?' · '+e.lugar:'');
    L.push('BEGIN:VEVENT',`UID:${e.id}@agenda-guardias`,`DTSTAMP:${ahora}`,`SUMMARY:${escICS(titulo)}`);
    if(e.ini){
      let fin=e.fin,ff=e.fecha;
      if(!fin){const m=toMin(e.ini)+60;fin=p2(Math.floor(m/60)%24)+':'+p2(m%60);if(m>=1440)ff=masDias(e.fecha,1)}
      else if(toMin(fin)<=toMin(e.ini))ff=masDias(e.fecha,1);
      L.push(`DTSTART:${utc(e.fecha,e.ini)}`,`DTEND:${utc(ff,fin)}`);
    }else L.push(`DTSTART;VALUE=DATE:${e.fecha.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${masDias(e.fecha,1).replace(/-/g,'')}`);
    const desc=[e.nota,e.creadoPor?'Cargó: '+e.creadoPor:''].filter(Boolean).join('\n');
    if(desc)L.push(`DESCRIPTION:${escICS(desc)}`);
    if(e.lugar)L.push(`LOCATION:${escICS(e.lugar)}`);
    if(TIPOS[e.tipo]?.guardia&&e.ini){
      L.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${escICS(titulo)}`,'TRIGGER:-PT12H','END:VALARM');
      L.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${escICS(titulo)}`,'TRIGGER:-PT1H','END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(plegar).join('\r\n')+'\r\n';
}
window.__generarICS=generarICS;
$('btn-cal').onclick=()=>{
  const p=$('cal-sync');p.hidden=!p.hidden;$('btn-cal').setAttribute('aria-expanded',String(!p.hidden));
  if(!p.hidden){if(!$('cal-desde').value)$('cal-desde').value=iso(hoy);p.scrollIntoView({block:'nearest'})}
};
$('cal-descargar').onclick=()=>{
  const desde=$('cal-desde').value||iso(hoy);
  const lista=eventos.filter(e=>e.fecha>=desde).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  if(!lista.length){toast('No hay turnos desde esa fecha.');return}
  const blob=new Blob([generarICS(lista)],{type:'text/calendar;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='agenda-guardias.ics';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
  toast(lista.length+' turnos listos para importar');
};

// Respaldo: exportar e importar todos los turnos
const CAMPOS=['tipo','fecha','ini','fin','lugar','nota','creadoPor','creado'];
async function huella(e){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode([e.tipo,e.fecha,e.ini,e.fin,e.lugar,e.nota].join('|')));
  return 'r-'+[...new Uint8Array(buf)].slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('');
}
$('resp-copiar').onclick=()=>{
  const datos=JSON.stringify({agenda:'guardias',version:2,turnos:eventos.map(e=>CAMPOS.map(k=>e[k]??''))});
  const ta=$('resp-texto');
  const fallback=()=>{ta.value=datos;ta.focus();ta.select();toast('Respaldo listo en el cuadro: copialo con Ctrl+C')};
  if(navigator.clipboard)navigator.clipboard.writeText(datos).then(()=>toast(eventos.length+' turnos copiados. Pegalos en un lugar seguro.')).catch(fallback);else fallback();
};
$('resp-importar').onclick=async()=>{
  let filas;
  try{const j=JSON.parse($('resp-texto').value.trim());filas=Array.isArray(j)?j:j.turnos}catch(_){toast('Ese texto no es un respaldo válido.');return}
  if(!Array.isArray(filas)||!filas.length){toast('El respaldo no tiene turnos.');return}
  const lista=filas.map(f=>Array.isArray(f)?Object.fromEntries(CAMPOS.map((k,i)=>[k,f[i]])):f)
    .filter(e=>e&&TIPOS[e.tipo]&&/^\d{4}-\d{2}-\d{2}$/.test(e.fecha||''));
  if(!lista.length){toast('El respaldo no tiene turnos válidos.');return}
  const b=$('resp-importar');b.disabled=true;
  try{
    for(let i=0;i<lista.length;i+=400){
      const batch=writeBatch(db);
      for(const e of lista.slice(i,i+400)){const n=permitido({...e,ini:e.ini||'',fin:e.fin||''});batch.set(doc(turnosCol,await huella(n)),n)}
      await batch.commit();
    }
    $('resp-texto').value='';toast(lista.length+' turnos importados');
  }catch(err){errGuardar(err)}finally{b.disabled=false}
};

// Sesión
function mostrarApp(){$('login').hidden=true;$('app').hidden=false;$('l-nueva').hidden=true;resetForm();render();setSync('Conectando…');escuchar()}
function salir(msg){
  if(desuscribir){desuscribir();desuscribir=null}
  sesion.pin='';ls.del('ag_pin');eventos=[];agendaId=null;
  $('app').hidden=true;$('login').hidden=false;$('l-nombre').value=sesion.nombre;$('l-pin').value='';$('l-nueva').hidden=true;
  $('l-err').hidden=!msg;$('l-err').textContent=msg||'';
}
$('btn-salir').onclick=()=>salir();
async function abrir(pin){agendaId=await idAgenda(pin);turnosCol=collection(db,'agendas',agendaId,'turnos');return doc(db,'agendas',agendaId,'meta','info')}
$('lf').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!db){$('l-err').hidden=false;$('l-err').textContent='Falta configurar Firebase en firebase-config.js.';return}
  const nombre=$('l-nombre').value.trim(),pin=$('l-pin').value;
  if(!nombre||!pin)return;
  const btn=$('l-btn');btn.disabled=true;$('l-err').hidden=true;$('l-nueva').hidden=true;
  try{
    const info=await abrir(pin);
    const snap=await getDoc(info);
    if(snap.exists()){
      sesion={pin,nombre};ls.set('ag_pin',pin);ls.set('ag_nombre',nombre);mostrarApp();
    }else{
      $('l-err').hidden=false;$('l-err').textContent='No hay ninguna agenda con ese PIN. Revisalo, o creá una agenda nueva si es la primera vez.';
      $('l-nueva').hidden=false;
      $('l-crear').onclick=async()=>{
        if(pin.length<6){$('l-err').textContent='Para crear la agenda usá un PIN de al menos 6 caracteres.';return}
        $('l-crear').disabled=true;
        try{await setDoc(info,{creada:Date.now(),version:2});sesion={pin,nombre};ls.set('ag_pin',pin);ls.set('ag_nombre',nombre);mostrarApp();toast('Agenda creada')}
        catch(err){$('l-err').textContent=err&&err.code==='permission-denied'?'Firebase no dejó crear la agenda: revisá las reglas.':'No se pudo crear la agenda. Revisá la conexión.'}
        finally{$('l-crear').disabled=false}
      };
    }
  }catch(err){
    $('l-err').hidden=false;
    $('l-err').textContent=err&&err.code==='permission-denied'?'Firebase rechazó el acceso: revisá las reglas de la base.':'No se pudo conectar. Probá de nuevo cuando tengas señal.';
  }finally{btn.disabled=false}
});

if(sesion.pin&&db){abrir(sesion.pin).then(mostrarApp)}else salir(configurado?'':'Falta configurar Firebase en firebase-config.js.');

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}
