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
async function bookings(from,to){const {data,error:e}=await db.from('bookings').select('id,starts_at,status,payment_status,payment_method,services(name,price),profiles(email)').gte('starts_at',from).lt('starts_at',to).order('starts_at',{ascending:true}).limit(1000);if(e)throw e;return data||[]}
function item(b,controls=false){return `<div class="item"><div><strong>${esc(b.services?.name||'Serviço')}</strong><p>${esc(fmt(b.starts_at))} · ${esc(b.profiles?.email||'Cliente')}</p><p>${cash(b.services?.price)} · ${esc(b.status)} · pagamento: ${esc(b.payment_status)}</p></div>${controls?`<div class="actions">${b.payment_status!=='paid'?`<button data-action="paid" data-id="${esc(b.id)}">Marcar pago</button>`:''}${b.status!=='completed'&&b.status!=='cancelled'?`<button class="secondary" data-action="completed" data-id="${esc(b.id)}">Concluir</button>`:''}</div>`:''}</div>`}
async function dashboard(){const a=$('#from').value,z=$('#to').value;if(a>z)throw Error('A data inicial não pode ser posterior à final.');const [start]=range(a),[,end]=range(z);const list=await bookings(start,end);$('#revenue').textContent=await ledgerRevenue(a,z);$('#completed').textContent=list.filter(b=>b.status==='completed').length;$('#cancelled').textContent=list.filter(b=>b.status==='cancelled').length;$('#pending').textContent=cash(list.filter(b=>b.payment_status!=='paid'&&!['cancelled'].includes(b.status)).reduce((s,b)=>s+Number(b.services?.price||0),0));const upcoming=list.filter(b=>new Date(b.starts_at)>=new Date()&&!['cancelled','completed'].includes(b.status)).slice(0,8);$('#upcoming').innerHTML=upcoming.map(b=>item(b)).join('')||'<p>Nenhum agendamento futuro neste período.</p>'}
async function agenda(){const [from,to]=range($('#agendaDate').value);const list=await bookings(from,to);$('#appointments').innerHTML=list.map(b=>item(b,true)).join('')||'<p>Nenhum agendamento neste dia.</p>'}
async function services(){const {data,error:e}=await db.from('services').select('*').order('name');if(e)throw e;$('#services').innerHTML=(data||[]).map(s=>`<div class="item"><div><strong>${esc(s.name)}</strong><p>${cash(s.price)} · ${Number(s.duration_minutes)} min · ${s.active?'Ativo':'Inativo'}</p></div><div class="actions"><button class="secondary" data-price="${esc(s.id)}">Alterar preço</button><button data-toggle="${esc(s.id)}" data-active="${s.active}">${s.active?'Desativar':'Ativar'}</button></div></div>`).join('')||'<p>Nenhum serviço cadastrado.</p>'}
async function init(){if(!window.SUPABASE_URL||!window.SUPABASE_ANON_KEY)throw Error('Configuração Supabase ausente.');const {data:{user},error:e}=await db.auth.getUser();if(e||!user){$('#authStatus').textContent='Faça login no site primeiro.';return}const {data:profile,error:pe}=await db.from('profiles').select('role').eq('id',user.id).maybeSingle();if(pe)throw pe;if(profile?.role!=='admin'){ $('#authStatus').textContent='Acesso restrito ao administrador.';return}$('#authStatus').textContent='Administrador';$('#content').hidden=false;$('#from').value=day().slice(0,8)+'01';$('#to').value=day();$('#agendaDate').value=day();await Promise.all([dashboard(),services(),loadSettings()])}
async function loadSettings(){const {data,error:e}=await db.from('barbershop_settings').select('*').limit(1).maybeSingle();if(e)throw e;settings=data;if(settings){$('#hoursForm').elements.open.value=String(settings.opening_time).slice(0,5);$('#hoursForm').elements.close.value=String(settings.closing_time).slice(0,5)}}
$('#nav').addEventListener('click',e=>{const btn=e.target.closest('[data-view]');if(!btn)return;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===btn));document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==btn.dataset.view);$('#pageTitle').textContent=btn.textContent;if(btn.dataset.view==='agenda')safe(agenda);if(btn.dataset.view==='dashboard')safe(dashboard);if(btn.dataset.view==='servicos')safe(services);if(btn.dataset.view==='financeiro')safe(financeRefresh)});
$('#refresh').onclick=()=>safe(dashboard);$('#reloadAgenda').onclick=()=>safe(agenda);$('#agendaDate').onchange=()=>safe(agenda);
$('#appointments').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;safe(async()=>{if(!confirm(b.dataset.action==='paid'?'Confirmar recebimento do pagamento?':'Marcar atendimento como concluído?'))return;const {error:x}=await db.rpc('admin_update_booking',{p_booking_id:b.dataset.id,p_action:b.dataset.action});if(x)throw x;await Promise.all([agenda(),dashboard()])})});
$('#services').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;safe(async()=>{if(b.dataset.price){const raw=prompt('Novo preço (R$):');if(raw===null)return;const price=Number(raw.replace(',','.'));if(!Number.isFinite(price)||price<0)throw Error('Preço inválido');const {error:x}=await db.from('services').update({price}).eq('id',b.dataset.price);if(x)throw x}else if(b.dataset.toggle){const {error:x}=await db.from('services').update({active:b.dataset.active!=='true'}).eq('id',b.dataset.toggle);if(x)throw x}await services()})});
$('#serviceForm').onsubmit=e=>{e.preventDefault();safe(async()=>{const f=e.currentTarget,v=new FormData(f);const {error:x}=await db.from('services').insert({name:String(v.get('name')).trim(),description:String(v.get('description')||''),price:Number(v.get('price')),duration_minutes:Number(v.get('duration')),active:true});if(x)throw x;f.reset();await services()})};
$('#hoursForm').onsubmit=e=>{e.preventDefault();safe(async()=>{if(!settings?.id)throw Error('Configurações não encontradas');const f=e.currentTarget;if(f.elements.close.value<=f.elements.open.value)throw Error('Horário de fechamento inválido');const {error:x}=await db.from('barbershop_settings').update({opening_time:f.elements.open.value,closing_time:f.elements.close.value}).eq('id',settings.id);if(x)throw x;await loadSettings();alert('Horários atualizados')})};
$('#blockForm').onsubmit=e=>{e.preventDefault();safe(async()=>{const f=e.currentTarget,v=new FormData(f),a=new Date(v.get('start')),z=new Date(v.get('end'));if(!(z>a))throw Error('Período inválido');const {error:x}=await db.from('blocked_periods').insert({starts_at:a.toISOString(),ends_at:z.toISOString(),reason:String(v.get('reason')||'')});if(x)throw x;f.reset();alert('Período bloqueado')})};
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
 $('#financeTransactions').innerHTML=list.map(t=>`<article class="item"><div><strong>${esc(t.description)}</strong><p>${esc(t.transaction_date.split('-').reverse().join('/'))} · ${t.type==='income'?'Receita':'Despesa'} · ${esc(financeMethod[t.payment_method]||'Não informado')}</p><p>${esc(financeStatus[t.status]||t.status)}${t.booking_id?' · Vinculado a agendamento':''}</p></div><div class="finance-item-right"><strong class="${t.type==='income'?'income':'expense'}">${t.type==='income'?'+':'−'} ${cash(t.amount)}</strong><div class="actions">${t.status==='pending'?`<button type="button" data-fin-action="paid" data-id="${esc(t.id)}">Marcar pago</button>`:''}<button class="secondary" type="button" data-fin-action="details" data-id="${esc(t.id)}">Detalhes</button></div></div></article>`).join('')||'<p>Nenhuma movimentação neste período.</p>';
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
