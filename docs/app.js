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

function toast(msg,accion,fn){
  const t=$('toast');t.textContent=msg;
  if(accion){const b=document.createElement('button');b.type='button';b.textContent=accion;b.onclick=()=>{t.hidden=true;fn()};t.append(b)}
  t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,accion?6000:2800);
}
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
    const chips=ev.slice(0,3).map(e=>`<div class="chip${cedida(e)?' cedida':''}" style="--c:${color(e.tipo)}">${e.ini?e.ini+' ':''}${esc((TIPOS[e.tipo]||TIPOS.otro).label.split(' /')[0])}</div>`).join('');
    const more=ev.length>3?`<div class="more">+${ev.length-3} más</div>`:'';
    cells.push(`<div class="${cls}" data-d="${s}" tabindex="0" role="button" aria-label="${fechaLarga(s)}, ${ev.length} turnos"><span class="num">${d.getDate()}</span>${chips}${more}</div>`);
  }
  $('grid').innerHTML=cells.join('');
}
function itemHTML(e,conFecha){
  const quien=e.creadoPor?` · cargó ${esc(e.creadoPor)}`:'';
  const tags=(e.cambio==='cedida'?`<span class="tag ced">cedida${e.colega?' a '+esc(e.colega):''}</span>`:'')
    +(e.cambio==='tomada'?`<span class="tag">cubrí${e.colega?' a '+esc(e.colega):''}</span>`:'')
    +(e.pago==='fijo'&&!cedida(e)?'<span class="tag fijo">sueldo fijo</span>':'')+(e.monto&&!cedida(e)?`<span class="tag ${e.cobrada?'ok':'pend'}">${fmt$(e.monto)} · ${e.cobrada?'cobrada':'a cobrar'}</span>`:'');
  return `<div class="item${cedida(e)?' cedida':''}" style="--c:${color(e.tipo)}" data-id="${esc(e.id)}" tabindex="0" role="button">
    <i></i><div><div class="t">${esc((TIPOS[e.tipo]||TIPOS.otro).label)}${tags}</div>
    <div class="m mono">${conFecha?fechaCorta(e.fecha)+' · ':''}${rango(e)}${horas(e)?' · '+horas(e)+' h':''}</div>
    ${e.lugar||e.nota||quien?`<div class="m">${esc(e.lugar)}${e.lugar&&e.nota?' — ':''}${esc(e.nota)}${quien}</div>`:''}</div>
    <button type="button" class="item-del" data-del="${esc(e.id)}" aria-label="Borrar ${esc((TIPOS[e.tipo]||TIPOS.otro).label)} del ${fechaLarga(e.fecha)}">Borrar</button></div>`;
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
  const g=delMes.filter(e=>TIPOS[e.tipo]?.guardia&&!cedida(e));
  $('s-guardias').textContent=g.length;
  $('s-horas').textContent=g.reduce((s,e)=>s+horas(e),0)+' h';
  const ocupados=new Set(delMes.filter(e=>e.tipo!=='plan'&&!cedida(e)).map(e=>e.fecha));
  $('s-libres').textContent=new Date(y,m+1,0).getDate()-ocupados.size;
  const now=new Date(); const ahora=iso(now)+' '+pad(now.getHours())+':'+pad(now.getMinutes());
  const p=eventos.filter(e=>TIPOS[e.tipo]?.guardia&&!cedida(e)&&(e.fecha+' '+(e.ini||'00:00'))>=ahora).sort((a,b)=>(a.fecha+a.ini).localeCompare(b.fecha+b.ini))[0];
  $('s-prox').textContent=p?fechaCorta(p.fecha)+(p.ini?' · '+p.ini:''):'Sin guardias cargadas';
}
// Valor de cada guardia, por tipo y lugar
const COBRABLES=['g24','g12','noc','con'];
function gruposValor(){
  const lug=new Map(lugaresUsados().map(l=>[clave(l),l]));
  const m=new Map();
  for(const e of eventos){
    if(!COBRABLES.includes(e.tipo)||cedida(e))continue;
    const k=grupoMonto(e);
    const g=m.get(k)||{k,tipo:e.tipo,nombre:lug.get(clave(e.lugar))||(e.nota||'').trim()||'sin lugar',n:0,nMes:0,valor:0,t:0,fijo:0};
    g.n++; if(e.pago==='fijo')g.fijo++;
    const d=parse(e.fecha); if(d.getFullYear()===vista.getFullYear()&&d.getMonth()===vista.getMonth())g.nMes++;
    const tt=e.editado||e.creado||0; if(e.monto>0&&tt>=g.t){g.valor=e.monto;g.t=tt}
    m.set(k,g);
  }
  return [...m.values()].map(g=>({...g,modo:g.fijo*2>=g.n&&g.fijo?'fijo':g.valor>0?'guardia':'sin'})).sort((a,b)=>b.n-a.n);
}
// Modo de cobro de un grupo, para que las guardias nuevas lo hereden
const modoGrupo=k=>(gruposValor().find(g=>g.k===k)||{}).modo||'sin';
let firmaValores='';
function renderValores(){
  const gs=gruposValor();
  const firma=JSON.stringify([vista.getMonth(),gs.map(g=>[g.k,g.n,g.nMes,g.valor,g.modo])]);
  if(firma===firmaValores)return; firmaValores=firma;
  const tb=$('valores-tabla');
  const opc=(i,g)=>`<select id="modo-${i}" aria-label="Cómo se cobra ${esc(CORTO[g.tipo])} en ${esc(g.nombre)}">
      <option value="guardia"${g.modo==='guardia'?' selected':''}>Por guardia</option>
      <option value="fijo"${g.modo==='fijo'?' selected':''}>Sueldo fijo</option>
      <option value="sin"${g.modo==='sin'?' selected':''}>Sin cobro</option></select>`;
  tb.innerHTML=gs.length?`<thead><tr><th>Guardia</th><th class="n">Guardias</th><th>Cobro</th><th class="n">Valor bruto ($)</th><th></th></tr></thead><tbody>${gs.map((g,i)=>`<tr><td><span class="chip-dot" style="--c:${color(g.tipo)}"></span>${esc(CORTO[g.tipo])} · ${esc(g.nombre)}</td><td class="n">${g.nMes} en ${MESES[vista.getMonth()].slice(0,3)} · ${g.n} en total</td><td>${opc(i,g)}</td><td class="n"><input type="number" inputmode="numeric" min="0" step="1" id="valor-${i}" value="${g.modo==='guardia'&&g.valor?g.valor:''}" placeholder="—"${g.modo==='guardia'?'':' disabled'} aria-label="Valor de ${esc(CORTO[g.tipo])} en ${esc(g.nombre)}"></td><td><button type="button" data-valor="${i}">Aplicar</button></td></tr>`).join('')}</tbody>`:'';
  tb.dataset.json=JSON.stringify(gs);
  if(!gs.some(g=>g.modo!=='sin'))$('valores').open=true;
}
$('valores-tabla').addEventListener('change',ev=>{
  const s=ev.target.closest('select[id^="modo-"]');if(!s)return;
  const i=s.id.slice(5), inp=$('valor-'+i);
  inp.disabled=s.value!=='guardia'; if(s.value==='guardia')inp.focus(); else inp.value='';
});
$('valores-tabla').addEventListener('click',async ev=>{
  const b=ev.target.closest('button[data-valor]');if(!b)return;
  const i=b.dataset.valor;
  const g=JSON.parse($('valores-tabla').dataset.json||'[]')[Number(i)];if(!g)return;
  const modo=$('modo-'+i).value;
  const v=modo==='guardia'?Math.round(Number($('valor-'+i).value)||0):0;
  if(modo==='guardia'&&!v){toast('Escribí el valor bruto de esa guardia.');$('valor-'+i).focus();return}
  const pago=modo==='fijo'?'fijo':'';
  const objetivo=eventos.filter(e=>grupoMonto(e)===g.k&&!cedida(e)&&!e.cobrada&&((e.monto||0)!==v||(e.pago||'')!==pago));
  if(!objetivo.length){toast('Ese grupo ya está así.');return}
  b.disabled=true;
  try{
    for(let j=0;j<objetivo.length;j+=400){
      const batch=writeBatch(db);
      for(const e of objetivo.slice(j,j+400))batch.set(doc(turnosCol,e.id),permitido({...e,monto:v,pago,editado:Date.now()}));
      await batch.commit();
    }
    firmaValores='';
    const que=modo==='guardia'?fmt$(v)+' por guardia':modo==='fijo'?'sueldo fijo':'sin cobro';
    toast(`${CORTO[g.tipo]} · ${g.nombre}: ${que} (${objetivo.length} guardias)`);
  }catch(err){errGuardar(err)}finally{b.disabled=false}
});
function renderCobro(){
  const y=vista.getFullYear(),m=vista.getMonth();
  const lista=eventos.filter(e=>{const d=parse(e.fecha);return d.getFullYear()===y&&d.getMonth()===m&&e.monto>0&&!cedida(e)});
  renderValores();
  $('cobro').hidden=!$('valores-tabla').rows.length&&!lista.length;
  $('cobro-resumen').hidden=!lista.length; if(!lista.length){$('cobro-mes').textContent='';return}
  $('cobro-mes').textContent=MESES[m]+' '+y;
  const lug=new Map(lugaresUsados().map(l=>[clave(l),l]));
  const grupos=new Map();
  for(const e of lista){const k=clave(e.lugar)||'(sin lugar)';const g=grupos.get(k)||{nombre:lug.get(clave(e.lugar))||'Sin lugar',n:0,total:0,cobrado:0,pend:[]};g.n++;g.total+=e.monto;if(e.cobrada)g.cobrado+=e.monto;else g.pend.push(e.id);grupos.set(k,g)}
  const total=lista.reduce((s,e)=>s+e.monto,0), cobrado=lista.filter(e=>e.cobrada).reduce((s,e)=>s+e.monto,0);
  $('cobro-tot').innerHTML=`<div><b>${fmt$(total)}</b><span>Total bruto</span></div><div><b>${fmt$(cobrado)}</b><span>Cobrado</span></div><div class="pend"><b>${fmt$(total-cobrado)}</b><span>Pendiente</span></div>`;
  const filas=[...grupos.entries()].sort((a,b)=>b[1].total-a[1].total).map(([k,g])=>`<tr><td>${esc(g.nombre)}</td><td class="n">${g.n}</td><td class="n">${fmt$(g.total)}</td><td class="n">${fmt$(g.total-g.cobrado)}</td><td>${g.pend.length?`<button type="button" data-cobrar="${esc(k)}">Marcar cobradas</button>`:'<span class="tag ok">al día</span>'}</td></tr>`).join('');
  $('cobro-tabla').innerHTML=`<thead><tr><th>Lugar</th><th class="n">Guardias</th><th class="n">Total</th><th class="n">Pendiente</th><th></th></tr></thead><tbody>${filas}</tbody>`;
  $('cobro-tabla').dataset.grupos=JSON.stringify(Object.fromEntries([...grupos.entries()].map(([k,g])=>[k,{nombre:g.nombre,pend:g.pend}])));
}
$('cobro-tabla').addEventListener('click',async ev=>{
  const b=ev.target.closest('button[data-cobrar]');if(!b)return;
  const g=JSON.parse($('cobro-tabla').dataset.grupos||'{}')[b.dataset.cobrar];if(!g||!g.pend.length)return;
  if(!b.dataset.c){b.dataset.c='1';b.classList.add('primary');b.textContent=`Confirmar (${g.pend.length})`;return}
  b.disabled=true;
  try{
    const batch=writeBatch(db);
    for(const id of g.pend){const e=eventos.find(x=>x.id===id);if(e)batch.set(doc(turnosCol,id),permitido({...e,cobrada:true,editado:Date.now()}))}
    await batch.commit();toast(g.pend.length+' guardias de '+g.nombre+' marcadas como cobradas');
  }catch(err){errGuardar(err)}
});
function render(){renderCobro();renderCal();renderDia();renderProx();renderStats();actualizarSugerencias();vistaPrevia();actualizarOrden()}

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

const permitido=e=>{
  const o={tipo:e.tipo,fecha:e.fecha,ini:e.ini||'',fin:e.fin||'',lugar:(e.lugar||'').slice(0,80),nota:(e.nota||'').slice(0,300),creadoPor:(e.creadoPor||'').slice(0,40),creado:Number(e.creado)||Date.now()};
  if(e.editado)o.editado=Number(e.editado);
  const m=Math.round(Number(e.monto));if(m>0&&m<1e8)o.monto=m;
  if(e.cobrada)o.cobrada=true;
  if(e.pago==='fijo'){o.pago='fijo';delete o.monto;delete o.cobrada}
  if(e.cambio==='cedida'||e.cambio==='tomada'){o.cambio=e.cambio;const c=String(e.colega||'').trim().slice(0,40);if(c)o.colega=c}
  return o;
};
const fmt$=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n||0);
const cedida=e=>e.cambio==='cedida';
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
    const nota=!clave(e.lugar)&&(e.nota||'').trim().length<=25?(e.nota||'').trim():'';
    const k=[e.tipo,clave(e.lugar),clave(nota),e.ini||'',e.fin||''].join('|');
    const x=m.get(k)||{n:0,e,nota};x.n++;m.set(k,x);
  }
  const lug=new Map(lugaresUsados().map(l=>[clave(l),l]));
  return [...m.values()].filter(x=>x.n>=2).sort((a,b)=>b.n-a.n).slice(0,6).map(({e,nota})=>({tipo:e.tipo,ini:e.ini||'',fin:e.fin||'',lugar:lug.get(clave(e.lugar))||'',nota}));
}
let firmaSug='';
function actualizarSugerencias(){
  const lugares=lugaresUsados(), rap=rapidosUsados();
  const firma=JSON.stringify([lugares,rap]); if(firma===firmaSug)return; firmaSug=firma;
  $('lugares').innerHTML=lugares.map(l=>`<option value="${esc(l)}"></option>`).join('');
  $('lugar-chips').innerHTML=lugares.slice(0,6).map(l=>`<button type="button" class="chip-btn" data-lugar="${esc(l)}">${esc(l)}</button>`).join('');
  $('rapidos').innerHTML=rap.map((r,i)=>`<button type="button" class="chip-btn" data-r="${i}" style="--c:${color(r.tipo)}"><i></i>${esc(CORTO[r.tipo])}${r.lugar?' · '+esc(r.lugar):r.nota?' · '+esc(r.nota):''}${r.ini&&r.tipo!=='g24'&&r.tipo!=='noc'?' · '+r.ini:''}</button>`).join('');
  $('rapidos').dataset.json=JSON.stringify(rap);
  $('rapidos-box').hidden=!rap.length;
  marcarLugar();
}
function marcarLugar(){const k=clave($('f-lugar').value);$('lugar-chips').querySelectorAll('.chip-btn').forEach(b=>b.setAttribute('aria-pressed',String(clave(b.dataset.lugar)===k&&!!k)))}
$('lugar-chips').addEventListener('click',e=>{const b=e.target.closest('.chip-btn');if(!b)return;$('f-lugar').value=b.dataset.lugar;marcarLugar();montoSugerido()});
$('f-lugar').addEventListener('input',marcarLugar);
$('rapidos').addEventListener('click',e=>{
  const b=e.target.closest('.chip-btn');if(!b)return;
  const r=JSON.parse($('rapidos').dataset.json||'[]')[Number(b.dataset.r)];if(!r)return;
  $('f-tipo').value=r.tipo;$('f-ini').value=r.ini;$('f-fin').value=r.fin;$('f-lugar').value=r.lugar;$('f-nota').value=r.nota||'';marcarLugar();montoSugerido();vistaPrevia();
  toast(CORTO[r.tipo]+(r.lugar?' · '+r.lugar:r.nota?' · '+r.nota:'')+': elegí la fecha y guardá');
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

// Monto sugerido: el último cargado para el mismo tipo y lugar
function montoSugerido(){
  if(editId||$('f-monto').dataset.manual)return;
  const tipo=$('f-tipo').value,k=clave($('f-lugar').value);
  const prev=eventos.filter(e=>e.tipo===tipo&&clave(e.lugar)===k&&e.monto>0).sort((a,b)=>(b.creado||0)-(a.creado||0))[0];
  $('f-monto').value=prev?prev.monto:'';
}
$('f-monto').addEventListener('input',()=>{$('f-monto').dataset.manual=$('f-monto').value?'1':''});
['f-tipo','f-lugar'].forEach(id=>$(id).addEventListener('change',montoSugerido));
$('f-lugar').addEventListener('input',montoSugerido);
$('f-cambio').addEventListener('change',()=>{$('colega-label').hidden=!$('f-cambio').value;if($('f-cambio').value)$('f-colega').focus()});

// Formulario
function aplicarTipo(){const t=TIPOS[$('f-tipo').value];$('f-ini').value=t.ini;$('f-fin').value=t.fin}
function resetForm(){
  editId=null;$('f').reset();$('f-tipo').value='g24';aplicarTipo();$('f-fecha').value=sel;
  $('f-monto').dataset.manual='';$('f-cobrada').checked=false;$('f-cambio').value='';$('f-colega').value='';$('colega-label').hidden=true;$('f-hasta').value='';$('f-dias').querySelectorAll('input').forEach(i=>i.checked=false);$('rep-row').hidden=false;marcarLugar();vistaPrevia();
  montoSugerido();
  $('form-titulo').textContent='Agregar turno';$('f-cancelar').hidden=true;$('f-borrar').hidden=true;$('f-borrar').textContent='Eliminar';$('f-borrar').dataset.c='';
}
function editar(id){
  const e=eventos.find(x=>x.id===id);if(!e)return;
  editId=id;$('f-tipo').value=TIPOS[e.tipo]?e.tipo:'otro';$('f-fecha').value=e.fecha;$('f-ini').value=e.ini||'';$('f-fin').value=e.fin||'';
  $('f-lugar').value=e.lugar||'';$('f-nota').value=e.nota||'';$('rep-row').hidden=true;marcarLugar();
  $('f-monto').value=e.monto||'';$('f-cobrada').checked=!!e.cobrada;$('f-cambio').value=e.cambio||'';$('f-colega').value=e.colega||'';$('colega-label').hidden=!e.cambio;
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
  const base={tipo:$('f-tipo').value,ini:$('f-ini').value,fin:$('f-fin').value,lugar:$('f-lugar').value.trim(),nota:$('f-nota').value.trim(),creadoPor:sesion.nombre,fecha,monto:$('f-monto').value,cobrada:$('f-cobrada').checked,cambio:$('f-cambio').value,colega:$('f-colega').value};
  if(!editId&&!(Math.round(Number(base.monto))>0)&&modoGrupo(grupoMonto(base))==='fijo')base.pago='fijo';
  if(editId){
    const prev=eventos.find(x=>x.id===editId)||{};
    setDoc(doc(turnosCol,editId),permitido({...base,pago:Math.round(Number(base.monto))>0?'':(prev.pago||''),creadoPor:prev.creadoPor||sesion.nombre,creado:prev.creado,editado:Date.now()})).catch(errGuardar);
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
  copiarMonto(base,editId);
  sel=fecha;resetForm();render();
});
// Al poner un monto, se copia a las demás guardias del mismo tipo y lugar que todavía no tienen monto
const grupoMonto=e=>e.tipo+'|'+(clave(e.lugar)||'nota:'+clave(e.nota));
function copiarMonto(base,idActual){
  const m=Math.round(Number(base.monto)); if(!(m>0))return;
  const g=grupoMonto(base);
  const otros=eventos.filter(e=>e.id!==idActual&&grupoMonto(e)===g&&!(e.monto>0)&&!cedida(e));
  if(!otros.length)return;
  const batch=writeBatch(db);
  for(const e of otros)batch.set(doc(turnosCol,e.id),permitido({...e,monto:m,editado:Date.now()}));
  batch.commit().catch(errGuardar);
  const donde=base.lugar||base.nota||'sin lugar';
  setTimeout(()=>toast(`${fmt$(m)} aplicado también a ${otros.length} ${otros.length===1?'guardia':'guardias'} (${CORTO[base.tipo]} · ${donde})`),1200);
}

// Borrar desde la lista: primer toque pide confirmar, segundo borra, y se puede deshacer
function borrarTurno(b){
  const ev=eventos.find(x=>x.id===b.dataset.del);if(!ev)return;
  if(!b.classList.contains('confirmar')){
    document.querySelectorAll('.item-del.confirmar').forEach(o=>{o.classList.remove('confirmar');o.textContent='Borrar'});
    b.classList.add('confirmar');b.textContent='¿Borrar?';
    clearTimeout(borrarTurno._t);borrarTurno._t=setTimeout(()=>{b.classList.remove('confirmar');b.textContent='Borrar'},4000);
    return;
  }
  const copia={...ev};delete copia.id;
  deleteDoc(doc(turnosCol,ev.id)).catch(errGuardar);
  if(editId===ev.id)resetForm();
  toast('Borrado: '+(TIPOS[ev.tipo]||TIPOS.otro).label+' del '+fechaCorta(ev.fecha),'Deshacer',()=>{
    setDoc(doc(turnosCol,ev.id),permitido(copia)).catch(errGuardar);toast('Turno recuperado');
  });
}

// Navegación
$('prev').onclick=()=>{vista=new Date(vista.getFullYear(),vista.getMonth()-1,1);render()};
$('next').onclick=()=>{vista=new Date(vista.getFullYear(),vista.getMonth()+1,1);render()};
$('btn-hoy').onclick=()=>{vista=new Date(hoy.getFullYear(),hoy.getMonth(),1);sel=iso(hoy);if(!editId)$('f-fecha').value=sel;render()};
function elegirDia(s){sel=s;const d=parse(s);if(d.getMonth()!==vista.getMonth())vista=new Date(d.getFullYear(),d.getMonth(),1);if(!editId)$('f-fecha').value=s;render()}
$('grid').addEventListener('click',e=>{const c=e.target.closest('.day');if(c)elegirDia(c.dataset.d)});
$('grid').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('day')){e.preventDefault();elegirDia(e.target.dataset.d)}});
for(const id of ['dia-lista','prox-lista']){
  $(id).addEventListener('click',e=>{const del=e.target.closest('.item-del');if(del){e.stopPropagation();borrarTurno(del);return}const it=e.target.closest('.item');if(!it)return;const ev=eventos.find(x=>x.id===it.dataset.id);if(ev&&id==='prox-lista')elegirDia(ev.fecha);editar(it.dataset.id)});
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
const CAMPOS=['tipo','fecha','ini','fin','lugar','nota','creadoPor','creado','monto','cobrada','cambio','colega','pago'];
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

// Ordenar lugares: unificar escrituras y pasar al campo Lugar los que quedaron en la nota
function formaPreferida(formas){
  // con tilde si existe alguna, si no la más usada
  const con=formas.filter(([f])=>/[^\x00-\x7F]/.test(f));
  return (con.length?con:formas).sort((a,b)=>b[1]-a[1])[0][0];
}
function propuestasOrden(){
  const m=new Map();
  for(const e of eventos){const k=clave(e.lugar);if(!k)continue;const x=m.get(k)||new Map();x.set(e.lugar.trim(),(x.get(e.lugar.trim())||0)+1);m.set(k,x)}
  const canon=new Map([...m.entries()].map(([k,f])=>[k,formaPreferida([...f.entries()])]));
  const out=[];
  for(const e of eventos){
    const k=clave(e.lugar);
    if(k){ if(canon.get(k)!==e.lugar){out.push({e,lugar:canon.get(k),nota:e.nota||''})} continue }
    const n=clave(e.nota).replace(/^guardia\s+(en\s+)?/,'');
    if(n&&canon.has(n))out.push({e,lugar:canon.get(n),nota:''});
  }
  return out;
}
function actualizarOrden(){
  const b=$('orden-btn'); if(!b||b.dataset.c)return;
  const n=propuestasOrden().length;
  b.disabled=!n; b.textContent=n?`Ordenar ${n} ${n===1?'turno':'turnos'}`:'No hay nada para ordenar';
}
$('orden-btn').addEventListener('click',async()=>{
  const b=$('orden-btn'); const lista=propuestasOrden(); if(!lista.length)return;
  if(!b.dataset.c){b.dataset.c='1';b.classList.add('primary');b.textContent=`Confirmar: ordenar ${lista.length} turnos`;return}
  b.disabled=true;
  try{
    const batch=writeBatch(db);
    for(const {e,lugar,nota} of lista)batch.set(doc(turnosCol,e.id),permitido({...e,lugar,nota,editado:Date.now()}));
    await batch.commit();
    toast(lista.length+' turnos ordenados');
  }catch(err){errGuardar(err)}
  finally{b.dataset.c='';b.classList.remove('primary');actualizarOrden()}
});

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
