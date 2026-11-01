'use strict';
const $=s=>document.querySelector(s), db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
const cash=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const fmt=s=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Campo_Grande'}).format(new Date(s));
const error=e=>{$('#error').textContent=e.message||String(e);$('#error').hidden=false;console.error(e)};
const safe=async(p)=>{try{$('#error').hidden=true;await p()}catch(e){error(e)}};
let settings=null;
function range(date){const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);return [date+'T00:00:00-04:00',next.toISOString().slice(0,10)+'T00:00:00-04:00']}
async function bookings(from,to){const {data,error:e}=await db.from('bookings').select('id,starts_at,status,payment_status,payment_method,amount,services(name,price),profiles(email)').gte('starts_at',from).lt('starts_at',to).order('starts_at',{ascending:true}).limit(1000);if(e)throw e;return data||[]}
const bookingStatus={pending:'Aguardando',confirmed:'Confirmado',completed:'Concluído',cancelled:'Cancelado'};
const bookingPayment={pending:'Pendente',paid:'Recebido',refunded:'Reembolsado'};
const bookingMethod={cash:'Dinheiro presencial',pix_local:'Pix presencial',card_local:'Cartão presencial',pix_online:'Pix online',card_online:'Cartão online'};
const localPayment=m=>['cash','pix_local','card_local'].includes(m);
function item(b,controls=false){
 const cancelled=b.status==='cancelled',paid=b.payment_status==='paid';
 const amount=b.amount==null?'Valor não informado':cash(b.amount);
 const actions=controls?`<div class="actions booking-actions">
 ${!cancelled&&b.status!=='completed'?`<button type="button" class="secondary" data-action="completed" data-id="${esc(b.id)}">Concluir corte</button>`:''}
 ${!cancelled&&!paid&&b.payment_status==='pending'&&localPayment(b.payment_method)?`<button type="button" data-action="paid" data-id="${esc(b.id)}">Confirmar recebimento</button>`:''}
 ${!cancelled&&!paid&&b.status!=='completed'?`<button type="button" class="danger" data-action="cancelled" data-id="${esc(b.id)}">Cancelar</button>`:''}
 </div>`:'';
 return `<article class="item booking-item"><div class="booking-info"><strong>${esc(b.services?.name||'Serviço')}</strong>
 <p>${esc(fmt(b.starts_at))} · ${esc(b.profiles?.email||'Cliente')}</p>
 <p><strong>${esc(amount)}</strong> · ${esc(bookingMethod[b.payment_method]||b.payment_method||'Pagamento não informado')}</p>
 <div class="booking-tags"><span class="booking-tag">Atendimento: ${esc(bookingStatus[b.status]||b.status)}</span><span class="booking-tag ${paid?'tag-paid':''}">Pagamento: ${esc(bookingPayment[b.payment_status]||b.payment_status)}</span></div>
 </div>${actions}</article>`;
}
async function dashboard(){const a=$('#from').value,z=$('#to').value;if(a>z)throw Error('A data inicial não pode ser posterior à final.');const [start]=range(a),[,end]=range(z);const list=await bookings(start,end);$('#revenue').textContent=await ledgerRevenue(a,z);$('#completed').textContent=list.filter(b=>b.status==='completed').length;$('#cancelled').textContent=list.filter(b=>b.status==='cancelled').length;$('#pending').textContent=cash(list.filter(b=>b.payment_status!=='paid'&&!['cancelled'].includes(b.status)).reduce((s,b)=>s+Number(b.amount||0),0));const upcoming=list.filter(b=>new Date(b.starts_at)>=new Date()&&!['cancelled','completed'].includes(b.status)).slice(0,8);$('#upcoming').innerHTML=upcoming.map(b=>item(b)).join('')||'<p>Nenhum agendamento futuro neste período.</p>'}
async function agenda(){const [from,to]=range($('#agendaDate').value);const list=await bookings(from,to);$('#appointments').innerHTML=list.map(b=>item(b,true)).join('')||'<p>Nenhum agendamento neste dia.</p>'}
async function services(){const {data,error:e}=await db.from('services').select('*').order('name');if(e)throw e;$('#services').innerHTML=(data||[]).map(s=>`<div class="item"><div><strong>${esc(s.name)}</strong><p>${cash(s.price)} · ${Number(s.duration_minutes)} min · ${s.active?'Ativo':'Inativo'}</p></div><div class="actions"><button class="secondary" data-price="${esc(s.id)}">Alterar preço</button><button data-toggle="${esc(s.id)}" data-active="${s.active}">${s.active?'Desativar':'Ativar'}</button></div></div>`).join('')||'<p>Nenhum serviço cadastrado.</p>'}
async function init(){if(!window.SUPABASE_URL||!window.SUPABASE_ANON_KEY)throw Error('Configuração Supabase ausente.');const {data:{user},error:e}=await db.auth.getUser();if(e||!user){$('#authStatus').textContent='Faça login no site primeiro.';return}const {data:profile,error:pe}=await db.from('profiles').select('role').eq('id',user.id).maybeSingle();if(pe)throw pe;if(profile?.role!=='admin'){ $('#authStatus').textContent='Acesso restrito ao administrador.';return}$('#authStatus').textContent='Administrador';$('#content').hidden=false;$('#from').value=day().slice(0,8)+'01';$('#to').value=day();$('#agendaDate').value=day();$('#historyFrom').value=day().slice(0,8)+'01';$('#historyTo').value=day();$('#blocksFrom').value=day();$('#blocksTo').value=day().slice(0,8)+'28';await Promise.all([dashboard(),services(),loadSettings()])}
async function loadSettings(){const {data,error:e}=await db.from('barbershop_settings').select('*').limit(1).maybeSingle();if(e)throw e;settings=data;if(settings){renderWorkDays(settings.work_days);$('#infiniteStatus').textContent=settings.infinitepay_enabled?'Checkout online habilitado.':'Checkout online desabilitado.';const f=$('#infiniteForm');f.elements.handle.value=settings.infinitepay_handle||'';f.elements.public_link.value=settings.infinitepay_public_link||'';f.elements.enabled.checked=Boolean(settings.infinitepay_enabled);$('#hoursForm').elements.open.value=String(settings.opening_time).slice(0,5);$('#hoursForm').elements.close.value=String(settings.closing_time).slice(0,5)}}
// Troca de abas sem aguardar o Supabase e sem disparar consultas repetidas.
const viewTasks = {
  agenda: agenda, dashboard: dashboard, servicos: services,
  historico: historyRefresh,
  configuracoes: async () => { await loadSettings(); await blocksRefresh(); },
  financeiro: financeRefresh
};
const lastViewLoad = new Map();
const VIEW_CACHE_MS = 1500;
$('#nav').addEventListener('click', e => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  const view = btn.dataset.view;
  const current = document.querySelector('#nav [data-view].active');
  if (current === btn) return;
  // Reposiciona antes de ocultar o painel longo, evitando salto na rolagem.
  if (window.scrollY > 0) window.scrollTo(0, 0);
  document.querySelectorAll('#nav [data-view]').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== view; });
  $('#pageTitle').textContent = btn.textContent.trim();
  const task = viewTasks[view];
  if (task && Date.now() - (lastViewLoad.get(view) || 0) > VIEW_CACHE_MS) {
    lastViewLoad.set(view, Date.now());
    safe(async () => { try { await task(); } catch (err) { lastViewLoad.delete(view); throw err; } });
  }
});
$('#refresh').onclick=()=>safe(dashboard);$('#reloadAgenda').onclick=()=>safe(agenda);$('#agendaDate').onchange=()=>safe(agenda);
let bookingActionBusy=false;
$('#appointments').addEventListener('click',e=>{
 const btn=e.target.closest('[data-action]');if(!btn||bookingActionBusy)return;
 safe(async()=>{
  const action=btn.dataset.action;
  const messages={paid:'Confirma que o pagamento presencial foi efetivamente recebido? Isso registrará uma receita no financeiro.',completed:'Confirma que este corte foi realizado?',cancelled:'Confirma o cancelamento deste agendamento? O horário poderá voltar a ficar disponível.'};
  if(!messages[action]||!confirm(messages[action]))return;
  const reason=action==='cancelled'?prompt('Motivo do cancelamento (obrigatório):'):null;
  if(action==='cancelled'&&reason===null)return;
  if(action==='cancelled'&&!reason.trim())throw Error('Informe o motivo do cancelamento.');
  bookingActionBusy=true;btn.disabled=true;
  try{
   const {error:x}=action==='cancelled'?await db.rpc('admin_cancel_booking',{p_booking_id:btn.dataset.id,p_reason:reason.trim()}):await db.rpc('admin_update_booking',{p_booking_id:btn.dataset.id,p_action:action});
   if(x)throw x;
   await Promise.all([agenda(),dashboard()]);
   if(!document.querySelector('[data-panel="financeiro"]').hidden)await financeRefresh();
   alert(action==='paid'?'Pagamento confirmado. Confira o lançamento no Financeiro.':action==='completed'?'Atendimento concluído.':'Agendamento cancelado.');
  }finally{bookingActionBusy=false;btn.disabled=false}
 });
});
$('#services').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;safe(async()=>{if(b.dataset.price){const raw=prompt('Novo preço (R$):');if(raw===null)return;const price=Number(raw.replace(',','.'));if(!Number.isFinite(price)||price<0)throw Error('Preço inválido');const {error:x}=await db.from('services').update({price}).eq('id',b.dataset.price);if(x)throw x}else if(b.dataset.toggle){const {error:x}=await db.from('services').update({active:b.dataset.active!=='true'}).eq('id',b.dataset.toggle);if(x)throw x}await services()})});
$('#serviceForm').onsubmit=e=>{e.preventDefault();safe(async()=>{const f=e.currentTarget,v=new FormData(f);const {error:x}=await db.from('services').insert({name:String(v.get('name')).trim(),description:String(v.get('description')||''),price:Number(v.get('price')),duration_minutes:Number(v.get('duration')),active:true});if(x)throw x;f.reset();await services()})};
$('#hoursForm').onsubmit=e=>{e.preventDefault();safe(async()=>{if(!settings?.id)throw Error('Configurações não encontradas');const f=e.currentTarget;if(f.elements.close.value<=f.elements.open.value)throw Error('Horário de fechamento inválido');const {error:x}=await db.from('barbershop_settings').update({opening_time:f.elements.open.value,closing_time:f.elements.close.value}).eq('id',settings.id);if(x)throw x;await loadSettings();alert('Horários atualizados')})};
$('#blockForm').onsubmit=e=>{e.preventDefault();safe(async()=>{const f=e.currentTarget,v=new FormData(f),a=new Date(v.get('start')),z=new Date(v.get('end'));if(!(z>a))throw Error('Período inválido');const {error:x}=await db.from('blocked_periods').insert({starts_at:a.toISOString(),ends_at:z.toISOString(),reason:String(v.get('reason')||'')});if(x)throw x;f.reset();await blocksRefresh();alert('Período bloqueado')})};
$('#logout').onclick=()=>safe(async()=>{await db.auth.signOut();location.href='index.html'});
safe(init);

// FINANCEIRO: valores vêm exclusivamente de financial_transactions.
let financeCategories=[];
const financeStatus={paid:'Pago / recebido',pending:'Pendente',cancelled:'Cancelado'};
const financeMethod={cash:'Dinheiro',pix:'Pix',card:'Cartão',bank_transfer:'Transferência',other:'Outro'};
async function ledgerRevenue(from,to){
 const {data,error:e}=await db.from('financial_transactions').select('amount').eq('type','income').eq('status','paid').gte('transaction_date',from).lte('transaction_date',to).limit(10000);
 if(e)throw e;return cash((data||[]).reduce((s,t)=>s+Number(t.amount),0));
}
async function loadFinanceCategories(){
 const {data,error:e}=await db.from('financial_categories').select('id,name,type').order('name');if(e)throw e;
 financeCategories=data||[];syncFinanceCategories();
}
function syncFinanceCategories(){
 const type=$('#financeForm').elements.type.value;
 const options=financeCategories.filter(x=>x.type===type);
 $('#financeCategory').innerHTML='<option value="">Sem categoria</option>'+options.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
}
async function financeRefresh(){
 const from=$('#financeFrom').value,to=$('#financeTo').value;
 if(!from||!to||from>to)throw Error('Informe um período válido para o financeiro.');
 const {data,error:e}=await db.from('financial_transactions').select('id,type,description,amount,status,payment_method,transaction_date,notes,category_id,booking_id').gte('transaction_date',from).lte('transaction_date',to).order('transaction_date',{ascending:false}).limit(1000);
 if(e)throw e;
 const list=data||[];
 const sum=(type,status)=>list.filter(t=>t.type===type&&t.status===status).reduce((s,t)=>s+Number(t.amount),0);
 const inc=sum('income','paid'),exp=sum('expense','paid');
 $('#finIncome').textContent=cash(inc);$('#finExpenses').textContent=cash(exp);
 $('#finBalance').textContent=cash(inc-exp);$('#finPending').textContent=cash(sum('income','pending'));
 $('#financeTransactions').innerHTML=list.map(t=>`<article class="item"><div><strong>${esc(t.description)}</strong><p>${esc(t.transaction_date.split('-').reverse().join('/'))} · ${t.type==='income'?'Receita':'Despesa'} · ${esc(financeMethod[t.payment_method]||'Não informado')}</p><p>${esc(financeStatus[t.status]||t.status)}${t.booking_id?' · Vinculado a agendamento':''}</p></div><div class="finance-item-right"><strong class="${t.type==='income'?'income':'expense'}">${t.type==='income'?'+':'−'} ${cash(t.amount)}</strong><div class="actions">${t.status==='pending'&&!t.booking_id?`<button type="button" data-fin-action="paid" data-id="${esc(t.id)}">Marcar pago</button>`:''}<button class="secondary" type="button" data-fin-action="details" data-id="${esc(t.id)}">Detalhes</button></div></div></article>`).join('')||'<p>Nenhuma movimentação neste período.</p>';
 if(list.length===1000)$('#financeTransactions').insertAdjacentHTML('beforeend','<p class="hint">Exibindo os primeiros 1.000 registros. Reduza o período para consultar os demais.</p>');
}
$('#financeForm').elements.type.addEventListener('change',syncFinanceCategories);
$('#financeRefresh').onclick=()=>safe(financeRefresh);
$('#financeForm').onsubmit=e=>{e.preventDefault();safe(async()=>{
 const form=$('#financeForm'),v=new FormData(form),amount=Number(v.get('amount'));
 if(!Number.isFinite(amount)||amount<=0)throw Error('Informe um valor maior que zero.');
 const status=String(v.get('status'));
 const payload={type:String(v.get('type')),description:String(v.get('description')).trim(),category_id:v.get('category_id')||null,amount,payment_method:String(v.get('payment_method')),status,transaction_date:String(v.get('transaction_date')),paid_at:status==='paid'?new Date().toISOString():null,notes:String(v.get('notes')||'').trim()||null};
 if(!payload.description)throw Error('Informe a descrição.');
 const {data:{user},error:ue}=await db.auth.getUser();if(ue||!user)throw Error('Entre na conta do administrador.');payload.created_by=user.id;
 const {error:e}=await db.from('financial_transactions').insert(payload);if(e)throw e;
 form.reset();form.elements.transaction_date.value=day();syncFinanceCategories();await Promise.all([financeRefresh(),dashboard()]);alert('Movimentação salva com sucesso.');
})};
$('#financeTransactions').addEventListener('click',e=>{const btn=e.target.closest('[data-fin-action]');if(!btn)return;safe(async()=>{
 if(btn.dataset.finAction==='details'){
  const {data,error:x}=await db.from('financial_transactions').select('description,notes,status,booking_id').eq('id',btn.dataset.id).single();if(x)throw x;
  alert(`Descrição: ${data.description}\nSituação: ${financeStatus[data.status]||data.status}\nObservações: ${data.notes||'Nenhuma'}`);return;
 }
 if(!confirm('Confirmar que este valor foi efetivamente recebido ou pago?'))return;
 const {error:x}=await db.from('financial_transactions').update({status:'paid',paid_at:new Date().toISOString()}).eq('id',btn.dataset.id).eq('status','pending');if(x)throw x;
 await Promise.all([financeRefresh(),dashboard()]);
})});
// Carregar categorias apenas após a autenticação administrativa ser concluída.
const originalInit=init;
// Inicialização financeira independente, disparada quando o painel é liberado.
const financeObserver=new MutationObserver(()=>{
 if($('#content').hidden)return;financeObserver.disconnect();
 $('#financeFrom').value=day().slice(0,8)+'01';$('#financeTo').value=day();
 $('#financeForm').elements.transaction_date.value=day();
 safe(loadFinanceCategories);
});
financeObserver.observe($('#content'),{attributes:true,attributeFilter:['hidden']});

// ETAPA 4: historico, cancelamentos e configuracao de dias/folgas.
async function historyRefresh(){
 const from=$('#historyFrom').value,to=$('#historyTo').value;if(!from||!to||from>to)throw Error('Período inválido no histórico.');
 const [a]=range(from),[,z]=range(to);let list=await bookings(a,z);
 const status=$('#historyStatus').value,payment=$('#historyPayment').value;
 if(status!=='all')list=list.filter(b=>b.status===status);
 if(payment!=='all')list=list.filter(b=>b.payment_status===payment);
 $('#historyCount').textContent=`${list.length} agendamento(s) encontrado(s). Limite de consulta: 1.000 registros por período.`;
 $('#historyList').innerHTML=list.map(b=>item(b,false)).join('')||'<p>Nenhum atendimento encontrado.</p>';
}
$('#historyRefresh').onclick=()=>safe(historyRefresh);
const weekNames=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
let workDaysMode=null;
function renderWorkDays(value){
 const el=$('#daysOptions');if(!el)return;
 if(!Array.isArray(value)){workDaysMode=null;el.innerHTML='<p class="hint">Formato dos dias de funcionamento ainda não identificado. Não alteraremos esta configuração automaticamente.</p>';$('#daysForm button').disabled=true;return;}
 const allNumbers=value.every(v=>typeof v==='number');
 const allStrings=value.every(v=>typeof v==='string');
 if(!allNumbers&&!allStrings){workDaysMode=null;el.textContent='Formato não suportado.';$('#daysForm button').disabled=true;return;}
 // Mantém a convenção já utilizada pelo banco, sem tentar adivinhar códigos.
 workDaysMode=allNumbers?'numbers':'strings';
 if(allStrings){workDaysMode=null;el.innerHTML='<p class="hint">Dias armazenados como texto. Para evitar incompatibilidade, precisamos confirmar a convenção antes de editar.</p>';$('#daysForm button').disabled=true;return;}
 if(!value.includes(0)&&!value.includes(7)){workDaysMode=null;el.innerHTML='<p class="hint">A numeração dos dias não é inequívoca (0–6 ou 1–7). Não vamos alterar sem confirmar o padrão do banco.</p>';$('#daysForm button').disabled=true;return;}const oneBased=value.includes(7)&&!value.includes(0);
 workDaysMode=oneBased?'one-based':'zero-based';
 el.innerHTML=weekNames.map((name,i)=>`<label class="day-choice"><input type="checkbox" value="${oneBased?i+1:i}" ${value.includes(oneBased?i+1:i)?'checked':''}><span>${name}</span></label>`).join('');
 $('#daysForm button').disabled=false;
}
$('#daysForm').onsubmit=e=>{e.preventDefault();safe(async()=>{
 if(!settings?.id||!workDaysMode)throw Error('Configuração de dias indisponível.');
 const values=[...document.querySelectorAll('#daysOptions input:checked')].map(x=>Number(x.value));
 if(!values.length)throw Error('Selecione pelo menos um dia.');
 if(!confirm('Salvar os dias de funcionamento para novas reservas?'))return;
 const {error:x}=await db.from('barbershop_settings').update({work_days:values}).eq('id',settings.id);if(x)throw x;
 await loadSettings();alert('Dias atualizados. Confira os horários no site público.');
})};
async function blocksRefresh(){
 const a=$('#blocksFrom').value,z=$('#blocksTo').value;if(!a||!z||a>z)throw Error('Período inválido.');
 const [from]=range(a),[,to]=range(z);
 const {data,error:x}=await db.from('blocked_periods').select('id,starts_at,ends_at,reason').lt('starts_at',to).gt('ends_at',from).order('starts_at').limit(300);if(x)throw x;
 $('#blocksList').innerHTML=(data||[]).map(b=>`<article class="item"><div><strong>${esc(b.reason||'Período bloqueado')}</strong><p>${esc(fmt(b.starts_at))} até ${esc(fmt(b.ends_at))}</p></div><button type="button" class="secondary" data-unblock="${esc(b.id)}">Desbloquear</button></article>`).join('')||'<p>Nenhum bloqueio neste período.</p>';
}
$('#blocksRefresh').onclick=()=>safe(blocksRefresh);
$('#blocksList').addEventListener('click',e=>{const b=e.target.closest('[data-unblock]');if(!b)return;safe(async()=>{
 if(!confirm('Remover este bloqueio e liberar o período para novas reservas?'))return;
 b.disabled=true;try{const {error:x}=await db.from('blocked_periods').delete().eq('id',b.dataset.unblock);if(x)throw x;await blocksRefresh()}finally{b.disabled=false}
})});

// Configuracao de pagamentos online: apenas admin via RPC.
$('#infiniteForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;safe(async()=>{
 const button=f.querySelector('button');button.disabled=true;
 try {const {error:x}=await db.rpc('admin_save_infinitepay_settings',{p_handle:f.elements.handle.value.trim().replace(/^\$/,''),p_public_link:f.elements.public_link.value.trim()||null,p_enabled:f.elements.enabled.checked});if(x)throw x;await loadSettings();alert('Configuração InfinitePay salva.');}
 finally {button.disabled=false}
})};
