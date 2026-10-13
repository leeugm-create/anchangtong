/* 案场通 · 前端（第一阶段演示版） */
'use strict';

/* ---------- 基础 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = () => localStorage.getItem('act_token') || '';
let ME = null;

function toast(msg) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token(), ...(opts.headers || {}) },
  });
  if (res.status === 401) { localStorage.removeItem('act_token'); ME = null; location.hash = '#/login'; throw new Error('登录过期'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

/* ---------- 图标（线性，统一 24 视图） ---------- */
const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.6c2.6.3 4.7 1.9 5.5 4.4"/></svg>',
  pool: '<svg viewBox="0 0 24 24"><path d="M12 3v10"/><path d="m7 8 5-5 5 5"/><path d="M4 13v7h16v-7"/><path d="M4 16.5h16"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6.5 8-6.5s7 2.5 8 6.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5c.8 2 2.2 3.4 4.2 4.2L14 12.5l5 2v4c0 .6-.4 1-1 1C10.5 19.5 4.5 13.5 4.5 6c0-.6.4-1 1-1Z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m4 12.5 5 5L20 6.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
};

const NAV = [
  { r: 'home', t: '工作台', i: I.home },
  { r: 'register', t: '登记', i: I.pen },
  { r: 'customers', t: '客户', i: I.users },
  { r: 'units', t: '销控', i: I.chart },
  { r: 'pool', t: '公池', i: I.pool, badge: () => ME && ME._poolCount > 0 ? ME._poolCount : 0 },
  { r: 'mine', t: '我的', i: I.me },
];

/* ---------- 框架 ---------- */
function shell(active) {
  const roleName = ME.role === 'manager' ? '销售经理' : '置业顾问';
  $('#topbar').innerHTML = `
    <div class="brand"><div class="logo">案</div>案场通</div>
    <div class="spacer"></div>
    <div class="who">${esc(ME.name)}<span class="role-tag">${roleName}</span></div>`;
  $('#tabbar').innerHTML = NAV.map(n => {
    const b = n.badge ? n.badge() : 0;
    return `<a href="#/${n.r}" class="${active === n.r ? 'on' : ''}">${n.i}<span>${n.t}</span>${b ? `<span class="badge">${b > 99 ? '99+' : b}</span>` : ''}</a>`;
  }).join('');
  $('#sidebar').innerHTML = `
    <div class="brand"><div class="logo">案</div>案场通</div>
    ${NAV.map(n => `<a href="#/${n.r}" class="${active === n.r ? 'on' : ''}">${n.i}${n.t}</a>`).join('')}
    <div class="foot">${esc(ME.name)} · ${roleName}<br>江河序案场演示版</div>`;
}

function openModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
window.closeModal = closeModal;

const intentName = { A: 'A·重点', B: 'B·意向', C: 'C·一般', D: 'D·观望' };
const CHANNELS = ['自然到访', '中介带访', '老带新', '网络咨询', '电话咨询'];

function customerRow(c, showOwner) {
  const days = c.in_pool ? Math.floor((Date.now() - new Date(c.last_follow_at.replace(' ', 'T')).getTime()) / 864e5) : 0;
  return `<a class="row" href="#/customer/${c.id}">
    <div class="avatar">${esc(c.name[0] || '客')}</div>
    <div class="info">
      <div class="name">${esc(c.name)}<span class="intent ${c.intent}">${c.intent}</span>${c.in_pool ? '<span class="pool-flag">公池</span>' : ''}</div>
      <div class="sub">${esc(c.phone)} · ${esc(c.channel)}${showOwner && c.owner_name ? ' · ' + esc(c.owner_name) : ''}${c.in_pool ? ' · ' + days + '天没跟了' : ''}</div>
    </div>
    <div class="arrow">›</div>
  </a>`;
}

/* ---------- 登录 ---------- */
async function vLogin() {
  $('#topbar').innerHTML = ''; $('#tabbar').innerHTML = ''; $('#sidebar').innerHTML = '';
  $('#view').innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <div class="logo">案</div>
    <h1>案场通</h1>
    <div class="sub">江河序案场 · 客户管理系统（演示版）</div>
    <div class="form" id="login-form">
      <div class="field"><label>手机号</label><input id="li-phone" inputmode="numeric" placeholder="输入登录手机号" value="13800000001"></div>
      <div class="field"><label>密码</label><input id="li-pass" type="password" placeholder="输入密码" value="123456"></div>
      <button class="btn primary" onclick="doLogin()">登录</button>
    </div>
    <div class="demo-hint">
      <b>演示账号</b>（密码都是 123456）<br>
      销售经理：13800000001（张伟）<br>
      置业顾问：13800000002（李娜）/ 13800000003（王强）
    </div>
  </div></div>`;
  $('#li-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}
async function doLogin() {
  const phone = $('#li-phone').value.trim(), password = $('#li-pass').value;
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ phone, password }) });
    localStorage.setItem('act_token', d.token);
    ME = d.user;
    location.hash = '#/home';
  } catch (e) { toast(e.message); }
}
window.doLogin = doLogin;

/* ---------- 工作台 ---------- */
async function vHome() {
  shell('home');
  const s = await api('/api/stats');
  ME._poolCount = s.pool;
  shell('home');
  const todo = await api('/api/customers?status=active').catch(() => ({ list: [] }));
  const urgent = todo.list.filter(c => !c.in_pool).sort((a, b) => a.last_follow_at < b.last_follow_at ? -1 : 1).slice(0, 5);
  $('#view').innerHTML = `
    <div class="page-title">今天案场怎么样</div>
    <div class="stats">
      <div class="stat"><div class="n">${s.todayVisit}</div><div class="l">今日来访（组）</div></div>
      <div class="stat"><div class="n">${s.weekNew}</div><div class="l">7天新增</div></div>
      <div class="stat"><div class="n">${s.mine}</div><div class="l">我在跟</div></div>
      <div class="stat hot"><div class="n">${s.pool}</div><div class="l">公池待抢</div></div>
      <div class="stat"><div class="n">${s.deals}</div><div class="l">已成交</div></div>
    </div>
    <div class="quick">
      <a href="#/register?t=visit"><span class="ic blue">${I.pen}</span>来访登记</a>
      <a href="#/register?t=call"><span class="ic green">${I.phone}</span>来电登记</a>
      <a href="#/pool"><span class="ic orange">${I.pool}</span>公池抢客</a>
      <a href="#/customers"><span class="ic red">${I.users}</span>我的客户</a>
    </div>
    <div class="section-title">该跟进了（按上次跟进时间排）</div>
    <div id="urgent">${urgent.length ? urgent.map(c => customerRow(c, ME.role === 'manager')).join('') : '<div class="empty"><div class="big">都跟得挺紧</div><div class="small">手里的客户最近都联系过，继续保持</div></div>'}</div>`;
}

/* ---------- 登记（来访/来电） ---------- */
let regTab = 'visit';
async function vRegister() {
  shell('register');
  const t = (location.hash.split('?')[1] || '').includes('t=call') ? 'call' : 'visit';
  regTab = t;
  $('#view').innerHTML = `
    <div class="page-title">客户登记</div>
    <div class="seg">
      <button class="${t === 'visit' ? 'on' : ''}" onclick="setRegTab('visit')">来访登记</button>
      <button class="${t === 'call' ? 'on' : ''}" onclick="setRegTab('call')">来电登记</button>
    </div>
    <div class="card pad"><div class="form">
      <div class="field"><label><span class="req">*</span>客户姓名</label><input id="rg-name" placeholder="比如：陈建国"></div>
      <div class="field"><label><span class="req">*</span>手机号</label><input id="rg-phone" inputmode="numeric" maxlength="11" placeholder="11 位手机号"></div>
      <div class="field"><label>渠道</label><select id="rg-channel">${CHANNELS.map(c => `<option ${c === (t === 'call' ? '电话咨询' : '自然到访') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>意向等级</label><select id="rg-intent">
        <option value="A">A · 重点跟（近期能定）</option><option value="B">B · 有意向（在对比）</option>
        <option value="C" selected>C · 一般（先了解）</option><option value="D">D · 随缘（意向弱）</option>
      </select></div>
      <div class="field"><label>需求</label><input id="rg-demand" placeholder="比如：118㎡三房，想要高楼层"></div>
      <div class="field"><label>预算</label><input id="rg-budget" placeholder="比如：80万左右"></div>
      <div class="field"><label>备注</label><textarea id="rg-note" placeholder="第一印象、关键信息，随手记"></textarea></div>
      <button class="btn primary" onclick="doRegister()">${t === 'visit' ? '登记到来访' : '登记到来电'}</button>
    </div></div>`;
}
function setRegTab(t) { location.hash = '#/register?t=' + (t === 'call' ? 'call' : 'visit'); }
window.setRegTab = setRegTab;
async function doRegister() {
  const body = {
    name: $('#rg-name').value.trim(), phone: $('#rg-phone').value.trim(),
    channel: $('#rg-channel').value, intent: $('#rg-intent').value,
    demand: $('#rg-demand').value.trim(), budget: $('#rg-budget').value.trim(),
    note: $('#rg-note').value.trim(), source_type: regTab === 'call' ? '来电' : '来访',
  };
  if (!body.name) return toast('客户姓名还没填');
  if (!/^1\d{10}$/.test(body.phone)) return toast('手机号得是 11 位数字');
  try {
    const d = await api('/api/customers', { method: 'POST', body: JSON.stringify(body) });
    toast('登记成功，已归到你名下');
    location.hash = '#/customer/' + d.id;
  } catch (e) {
    if (e.message.includes('已经登记')) { toast('这个手机号已经登记过了，不能重复录'); }
    else toast(e.message);
  }
}
window.doRegister = doRegister;

/* ---------- 客户列表 ---------- */
const custFilter = { q: '', channel: '', intent: '', status: '' };
async function vCustomers() {
  shell('customers');
  $('#view').innerHTML = `
    <div class="page-title">客户</div>
    <div class="searchbar"><input id="cq" placeholder="搜姓名 / 手机号" value="${esc(custFilter.q)}"><button class="btn primary" style="width:auto;padding:11px 18px" onclick="applyCustFilter()">搜</button></div>
    <div class="filters" id="cf-channel">${['', ...CHANNELS].map(c => `<button class="chip ${custFilter.channel === c ? 'on' : ''}" onclick="setCF('channel','${c}')">${c || '全部渠道'}</button>`).join('')}</div>
    <div class="filters">
      ${['', 'A', 'B', 'C', 'D'].map(i => `<button class="chip ${custFilter.intent === i ? 'on' : ''}" onclick="setCF('intent','${i}')">${i ? intentName[i] : '全部意向'}</button>`).join('')}
      ${['', 'active', 'deal'].map(s => `<button class="chip ${custFilter.status === s ? 'on' : ''}" onclick="setCF('status','${s}')">${{ '': '全部状态', active: '跟进中', deal: '已成交' }[s]}</button>`).join('')}
    </div>
    <div id="clist"><div class="empty"><div class="small">正在加载…</div></div></div>`;
  $('#cq').addEventListener('keydown', e => { if (e.key === 'Enter') applyCustFilter(); });
  loadCustList();
}
function setCF(k, v) { custFilter[k] = custFilter[k] === v ? '' : v; vCustomers(); }
window.setCF = setCF;
function applyCustFilter() { custFilter.q = $('#cq').value.trim(); loadCustList(); }
window.applyCustFilter = applyCustFilter;
async function loadCustList() {
  const p = new URLSearchParams();
  if (custFilter.q) p.set('q', custFilter.q);
  if (custFilter.channel) p.set('channel', custFilter.channel);
  if (custFilter.intent) p.set('intent', custFilter.intent);
  if (custFilter.status) p.set('status', custFilter.status);
  try {
    const d = await api('/api/customers?' + p.toString());
    $('#clist').innerHTML = d.list.length
      ? `<div style="font-size:12.5px;color:var(--muted);margin:2px 2px 10px">共 ${d.list.length} 位客户</div>` + d.list.map(c => customerRow(c, ME.role === 'manager')).join('')
      : '<div class="empty"><div class="big">没找到符合条件的客户</div><div class="small">换个条件试试，或者去登记一个新客户</div></div>';
  } catch (e) { $('#clist').innerHTML = `<div class="empty"><div class="small">${esc(e.message)}</div></div>`; }
}

/* ---------- 客户详情 ---------- */
async function vCustomer(id) {
  shell('customers');
  let d;
  try { d = await api('/api/customers/' + id); }
  catch (e) { $('#view').innerHTML = `<div class="empty"><div class="big">打不开了</div><div class="small">${esc(e.message)}</div></div>`; return; }
  const c = d.customer;
  const days = c.in_pool ? Math.floor((Date.now() - new Date(c.last_follow_at.replace(' ', 'T')).getTime()) / 864e5) : 0;
  const canAct = ME.role === 'manager' || c.owner_id === ME.id;
  $('#view').innerHTML = `
    <div class="page-title" style="display:flex;align-items:center;gap:8px">
      <a href="javascript:history.back()" style="text-decoration:none;color:var(--primary);font-size:16px;font-weight:600">‹ 返回</a>
      <span style="flex:1"></span>
    </div>
    <div class="card pad" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div class="avatar" style="width:48px;height:48px;border-radius:50%;background:#e8eefb;color:var(--primary);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:18px">${esc(c.name[0])}</div>
        <div><div style="font-size:18px;font-weight:800;display:flex;gap:8px;align-items:center">${esc(c.name)}<span class="intent ${c.intent}">${intentName[c.intent]}</span>${c.in_pool ? '<span class="pool-flag">公池 · ' + days + '天没跟</span>' : ''}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:2px">${esc(c.channel)} · ${esc(c.source_type)} · 归属：${esc(c.owner_name || '—')}</div></div>
      </div>
      <div class="kv"><div class="k">手机号</div><div class="v"><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div></div>
      <div class="kv"><div class="k">需求</div><div class="v">${esc(c.demand || '—')}</div></div>
      <div class="kv"><div class="k">预算</div><div class="v">${esc(c.budget || '—')}</div></div>
      <div class="kv"><div class="k">备注</div><div class="v">${esc(c.note || '—')}</div></div>
      <div class="kv"><div class="k">最后跟进</div><div class="v">${esc(c.last_follow_at)}</div></div>
    </div>
    ${canAct ? `<button class="btn primary" onclick="openFollowup(${c.id})">写跟进</button>` : ''}
    ${c.in_pool && c.owner_id !== ME.id ? `<button class="btn warn" style="margin-top:10px" onclick="grab(${c.id})">抢到我名下</button>` : ''}
    ${ME.role === 'manager' ? `
    <div class="btn-row" style="margin-top:10px">
      <button class="btn ghost" onclick="openTransfer(${c.id},'${esc(c.owner_name || '')}')">判客</button>
      <button class="btn ghost" onclick="openEdit(${c.id})">改资料</button>
      <button class="btn danger-ghost" onclick="delCustomer(${c.id})">删除</button>
    </div>` : ''}
    <div class="section-title">跟进记录（${c.followups.length}）</div>
    <div class="card pad">
      ${c.followups.length ? `<div class="timeline">${c.followups.map(f => `
        <div class="tl-item"><div class="t">${esc(f.created_at)} · ${esc(f.user_name || '')}</div>
        <div class="c">${esc(f.content)}</div>${f.next_plan ? `<div class="p">下一步：${esc(f.next_plan)}</div>` : ''}</div>`).join('')}</div>`
        : '<div class="empty" style="padding:20px"><div class="small">还没有跟进记录，点上面"写跟进"记第一条</div></div>'}
    </div>
    ${c.transfers.length ? `<div class="section-title">归属变动</div><div class="card">${c.transfers.map(t => `
      <div class="log-row"><span class="a">判客</span>${esc(t.created_at)} · ${esc(t.from_name || '公池')} → ${esc(t.to_name)}${t.reason ? ' · ' + esc(t.reason) : ''}</div>`).join('')}</div>` : ''}
    ${c.phone_changes.length ? `<div class="section-title">号码变更留痕</div><div class="card">${c.phone_changes.map(p => `
      <div class="log-row"><span class="a">改号</span>${esc(p.created_at)} · ${esc(p.old_phone)} → ${esc(p.new_phone)} · 操作人 ${esc(p.op_name || '')}</div>`).join('')}</div>` : ''}`;
}

function openFollowup(id) {
  openModal(`<h3>写跟进</h3><div class="form">
    <div class="field"><label><span class="req">*</span>这次聊了什么</label><textarea id="fu-content" placeholder="比如：客户说周末带家人再来看一次，对132户型有兴趣"></textarea></div>
    <div class="field"><label>下一步打算</label><input id="fu-next" placeholder="比如：周三前再打个电话"></div>
    <div class="btn-row"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="doFollowup(${id})">保存</button></div>
  </div>`);
}
async function doFollowup(id) {
  const content = $('#fu-content').value.trim(), next_plan = $('#fu-next').value.trim();
  if (!content) return toast('跟进内容不能为空');
  try { await api(`/api/customers/${id}/followups`, { method: 'POST', body: JSON.stringify({ content, next_plan }) }); closeModal(); toast('已记下'); vCustomer(id); }
  catch (e) { toast(e.message); }
}
window.openFollowup = openFollowup; window.doFollowup = doFollowup;

async function grab(id) {
  try { await api(`/api/customers/${id}/grab`, { method: 'POST' }); toast('抢到了，好好跟'); location.hash = '#/customer/' + id; }
  catch (e) { toast(e.message); }
}
window.grab = grab;

function openTransfer(id, ownerName) {
  api('/api/users').then(d => {
    const opts = d.list.filter(u => u.role === 'agent').map(u => `<option value="${u.id}">${esc(u.name)}（在跟 ${u.active_count} 个）</option>`).join('');
    openModal(`<h3>判客</h3><div class="form">
      <div class="field"><label>当前归属</label><input value="${esc(ownerName || '公池')}" disabled></div>
      <div class="field"><label><span class="req">*</span>转给谁</label><select id="tf-to">${opts}</select></div>
      <div class="field"><label><span class="req">*</span>原因（会留档）</label><input id="tf-reason" placeholder="比如：原顾问离职，客户重新分配"></div>
      <div class="btn-row"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="doTransfer(${id})">确认转交</button></div>
    </div>`);
  }).catch(e => toast(e.message));
}
async function doTransfer(id) {
  const to_user_id = $('#tf-to').value, reason = $('#tf-reason').value.trim();
  if (!reason) return toast('判客原因得写，这是规矩');
  try { await api(`/api/customers/${id}/transfer`, { method: 'POST', body: JSON.stringify({ to_user_id, reason }) }); closeModal(); toast('已转交，记录留档'); vCustomer(id); }
  catch (e) { toast(e.message); }
}
window.openTransfer = openTransfer; window.doTransfer = doTransfer;

function openEdit(id) {
  api('/api/customers/' + id).then(d => {
    const c = d.customer;
    openModal(`<h3>改资料</h3><div class="form">
      <div class="field"><label>姓名</label><input id="ed-name" value="${esc(c.name)}"></div>
      <div class="field"><label>手机号（改了会自动留痕）</label><input id="ed-phone" value="${esc(c.phone)}" maxlength="11"></div>
      <div class="field"><label>意向</label><select id="ed-intent">${['A', 'B', 'C', 'D'].map(i => `<option value="${i}" ${c.intent === i ? 'selected' : ''}>${intentName[i]}</option>`).join('')}</select></div>
      <div class="field"><label>需求</label><input id="ed-demand" value="${esc(c.demand)}"></div>
      <div class="field"><label>预算</label><input id="ed-budget" value="${esc(c.budget)}"></div>
      <div class="field"><label>状态</label><select id="ed-status">
        <option value="active" ${c.status === 'active' ? 'selected' : ''}>跟进中</option>
        <option value="deal" ${c.status === 'deal' ? 'selected' : ''}>已成交</option>
      </select></div>
      <div class="btn-row"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="doEdit(${id})">保存</button></div>
    </div>`);
  });
}
async function doEdit(id) {
  const body = { name: $('#ed-name').value.trim(), phone: $('#ed-phone').value.trim(), intent: $('#ed-intent').value, demand: $('#ed-demand').value.trim(), budget: $('#ed-budget').value.trim(), status: $('#ed-status').value };
  try { await api('/api/customers/' + id, { method: 'PUT', body: JSON.stringify(body) }); closeModal(); toast('改好了'); vCustomer(id); }
  catch (e) { toast(e.message); }
}
window.openEdit = openEdit; window.doEdit = doEdit;

async function delCustomer(id) {
  openModal(`<h3>删除客户？</h3><div class="form">
    <div style="font-size:14px;color:var(--muted);margin-bottom:14px;line-height:1.7">只是软删除，数据还在后台，前台看不见。以后想恢复找经理操作。</div>
    <div class="btn-row"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn warn" onclick="doDel(${id})">确认删除</button></div>
  </div>`);
}
async function doDel(id) {
  try { await api(`/api/customers/${id}/delete`, { method: 'POST' }); closeModal(); toast('已删除'); location.hash = '#/customers'; }
  catch (e) { toast(e.message); }
}
window.delCustomer = delCustomer; window.doDel = doDel;

/* ---------- 公池 ---------- */
async function vPool() {
  shell('pool');
  try {
    const d = await api('/api/customers?status=pool');
    ME._poolCount = d.list.length; shell('pool');
    $('#view').innerHTML = `
      <div class="page-title">公池</div>
      <div class="card pad" style="margin-bottom:12px;font-size:13.5px;color:var(--muted);line-height:1.7">
        超过 <b style="color:var(--warn)">15 天</b>没跟进的客户会自动流到这里，谁都可以抢。抢到就是你的，好好跟，别再让它流回来。
      </div>
      <div id="poollist">${d.list.length
        ? `<div style="font-size:12.5px;color:var(--muted);margin:2px 2px 10px">共 ${d.list.length} 位，先到先得</div>` + d.list.map(c => customerRow(c, true)).join('')
        : '<div class="empty"><div class="big">公池是空的</div><div class="small">说明大家跟得都挺紧，继续保持</div></div>'}</div>`;
  } catch (e) { $('#view').innerHTML = `<div class="empty"><div class="small">${esc(e.message)}</div></div>`; }
}

/* ---------- 我的 / 后台 ---------- */
async function vMine() {
  shell('mine');
  const isMgr = ME.role === 'manager';
  let userRows = '';
  if (isMgr) {
    try {
      const d = await api('/api/users');
      userRows = d.list.map(u => `
        <div class="log-row"><b>${esc(u.name)}</b> <span style="color:var(--muted);font-size:12px">${u.role === 'manager' ? '销售经理' : '置业顾问'} · ${esc(u.phone)}</span>
        <span style="float:right;color:var(--primary);font-weight:700">在跟 ${u.active_count} 个</span></div>`).join('');
    } catch (e) { userRows = `<div class="log-row">${esc(e.message)}</div>`; }
  }
  $('#view').innerHTML = `
    <div class="page-title">我的</div>
    <div class="card pad" style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
      <div class="avatar" style="width:52px;height:52px;border-radius:50%;background:#e8eefb;color:var(--primary);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:20px">${esc(ME.name[0])}</div>
      <div><div style="font-weight:800;font-size:16px">${esc(ME.name)}<span class="role-tag">${isMgr ? '销售经理' : '置业顾问'}</span></div>
      <div style="font-size:13px;color:var(--muted);margin-top:2px">${esc(ME.phone)}</div></div>
    </div>
    ${isMgr ? `
    <div class="section-title">后台管理</div>
    <a class="menu-row" href="#/admin/users"><span>👥</span><span>人员与归属<div class="d">看每个顾问手里有多少客户</div></span><span class="arrow">›</span></a>
    <a class="menu-row" href="#/admin/logs"><span>🧾</span><span>操作日志<div class="d">谁什么时候动了什么，一笔笔都在</div></span><span class="arrow">›</span></a>
    <a class="menu-row" href="#/admin/deleted"><span>🗑</span><span>已删除客户<div class="d">软删除的数据在这里，可恢复</div></span><span class="arrow">›</span></a>
    <a class="menu-row" href="javascript:checkUpdate()"><span>🔄</span><span>检查更新<div class="d">有新版点一下就升好，不用重新下载</div></span><span class="arrow">›</span></a>
    <div class="section-title">数据（最重要的东西）</div>
    <a class="menu-row" href="javascript:downloadFile('/api/export.csv','客户导出.csv')"><span>📥</span><span>导出 Excel<div class="d">全部客户一键导出，拿去就能用</div></span><span class="arrow">›</span></a>
    <a class="menu-row" href="javascript:downloadFile('/api/backup','案场通数据库.db')"><span>💾</span><span>下载数据库文件<div class="d">整个库拷走，这就是最硬的备份</div></span><span class="arrow">›</span></a>
    <div class="card pad" style="margin-top:12px;font-size:13px;color:var(--muted);line-height:1.8">
      每天第一次启动服务会自动备份一份数据库，<br>放在 <b style="color:var(--ink)">backups</b> 文件夹里，最多留 30 份。
    </div>` : `
    <div class="section-title">说明</div>
    <div class="card pad" style="font-size:13.5px;color:var(--muted);line-height:1.8">
      客户资料每天自动备份，不用你操心。<br>换了手机号、要转客户，去找销售经理操作。
    </div>`}
    <button class="btn ghost" style="margin-top:18px" onclick="doLogout()">退出登录</button>`;
  async function doLogout() {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    localStorage.removeItem('act_token'); ME = null; location.hash = '#/login';
  }
  window.doLogout = doLogout;
}

async function vAdminUsers() {
  shell('mine');
  if (ME.role !== 'manager') { location.hash = '#/mine'; return; }
  const d = await api('/api/users');
  $('#view').innerHTML = `
    <div class="page-title"><a href="#/mine" style="text-decoration:none;color:var(--primary);font-size:16px;font-weight:600">‹ 返回</a></div>
    <div class="page-title">人员与归属</div>
    <div class="card">${d.list.map(u => `
      <a class="log-row" style="display:block;text-decoration:none;color:var(--ink)" href="#/customers?owner=${u.id}">
        <b>${esc(u.name)}</b> <span style="color:var(--muted);font-size:12px">${u.role === 'manager' ? '销售经理' : '置业顾问'}</span>
        <span style="float:right;color:var(--primary);font-weight:700">在跟 ${u.active_count} 个 ›</span>
      </a>`).join('')}</div>
    <div style="font-size:12.5px;color:var(--muted);margin:10px 2px">点一个人进去看他名下的客户；判客去客户详情页操作。</div>`;
}

async function vAdminLogs() {
  shell('mine');
  if (ME.role !== 'manager') { location.hash = '#/mine'; return; }
  const d = await api('/api/logs');
  $('#view').innerHTML = `
    <div class="page-title"><a href="#/mine" style="text-decoration:none;color:var(--primary);font-size:16px;font-weight:600">‹ 返回</a></div>
    <div class="page-title">操作日志</div>
    <div class="card">${d.list.length ? d.list.map(l => `
      <div class="log-row"><span class="a">${esc(l.action)}</span>${esc(l.operator_name)} · ${esc(l.detail)}<div class="t">${esc(l.created_at)}</div></div>`).join('')
      : '<div class="empty"><div class="small">还没有操作记录</div></div>'}</div>`;
}

async function vAdminDeleted() {
  shell('mine');
  if (ME.role !== 'manager') { location.hash = '#/mine'; return; }
  const d = await api('/api/customers?status=deleted');
  $('#view').innerHTML = `
    <div class="page-title"><a href="#/mine" style="text-decoration:none;color:var(--primary);font-size:16px;font-weight:600">‹ 返回</a></div>
    <div class="page-title">已删除客户</div>
    ${d.list.length ? d.list.map(c => `
      <div class="row"><div class="avatar">${esc(c.name[0])}</div>
        <div class="info"><div class="name">${esc(c.name)}</div><div class="sub">${esc(c.phone)} · ${esc(c.channel)}</div></div>
        <button class="chip" onclick="restoreCustomer(${c.id})">恢复</button>
      </div>`).join('') : '<div class="empty"><div class="big">没有已删除的客户</div><div class="small">删掉的客户都会先躺在这里</div></div>'}`;
}
async function restoreCustomer(id) {
  try { await api(`/api/customers/${id}/restore`, { method: 'POST' }); toast('已恢复'); vAdminDeleted(); }
  catch (e) { toast(e.message); }
}
window.restoreCustomer = restoreCustomer;

/* ---------- 路由 ---------- */
const routes = {
  '/login': vLogin, '/home': vHome, '/register': vRegister,
  '/customers': vCustomers, '/units': vUnits, '/pool': vPool, '/mine': vMine,
  '/admin/users': vAdminUsers, '/admin/logs': vAdminLogs, '/admin/deleted': vAdminDeleted,
};
async function route() {
  closeModal();
  let h = location.hash.slice(1) || '/home';
  const [path] = h.split('?');
  if (!token() && path !== '/login') { location.hash = '#/login'; return; }
  if (token() && !ME) {
    try { ME = (await api('/api/me')).user; }
    catch (e) { location.hash = '#/login'; return; }
  }
  if (path.startsWith('/customer/')) { await vCustomer(path.split('/')[2]); window.scrollTo(0, 0); return; }
  const fn = routes[path] || vHome;
  try { await fn(); } catch (e) { if (!String(e.message).includes('登录')) toast(e.message); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------- 一键更新 ---------- */
async function checkUpdate() {
  toast('正在检查更新…');
  try {
    const d = await api('/api/update/check');
    if (!d.hasUpdate) { toast('已经是最新版（' + d.current + '）'); return; }
    openModal(`<h3>发现新版本</h3><div class="form">
      <div style="font-size:14px;color:var(--muted);line-height:1.8;margin-bottom:14px">
        当前版本：${esc(d.current)}<br>最新版本：<b style="color:var(--ink)">${esc(d.latest)}</b><br>
        点更新后自动下载、替换、重启，客户数据不受影响。
      </div>
      <div class="btn-row"><button class="btn ghost" onclick="closeModal()">先不用</button><button class="btn primary" onclick="doUpdate()">立即更新</button></div>
    </div>`);
  } catch (e) { toast(e.message); }
}
async function doUpdate() {
  closeModal(); toast('更新包下载中…');
  try {
    const d = await api('/api/update/apply', { method: 'POST' });
    if (d.already) { toast('已经是最新版了'); return; }
    toast('更新完成，正在重启服务…');
    // 等服务回来
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try { await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token() } }); break; }
      catch (e) {}
    }
    toast('更新好了，页面刷新一下');
    setTimeout(() => location.reload(), 1200);
  } catch (e) { toast(e.message); }
}
window.checkUpdate = checkUpdate; window.doUpdate = doUpdate;

/* ---------- 带登录态的文件下载 ---------- */
async function downloadFile(url, filename) {
  try {
    toast('正在准备文件…');
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token() } });
    if (!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { toast(e.message); }
}
window.downloadFile = downloadFile;

/* ---------- PWA 安装提示（安卓 Chrome） ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });

route();

/* ---------- 销控 ---------- */
let xkBuilding = '';
async function vUnits() {
  shell('units');
  const bs = await api('/api/units/buildings').catch(() => ({ list: [] }));
  if (!bs.list.length) {
    $('#view').innerHTML = '<div class="page-title">销控</div><div class="empty"><div class="big">还没有房源数据</div><div class="small">等房源表出来，经理在这里一键导入</div></div>';
    return;
  }
  if (!bs.list.includes(xkBuilding)) xkBuilding = bs.list[0];
  $('#view').innerHTML = `
    <div class="page-title">销控</div>
    <div class="filters" id="xk-bs">${bs.list.map(b => `<button class="chip ${b === xkBuilding ? 'on' : ''}" onclick="setXK('${b}')">${esc(b)}栋</button>`).join('')}</div>
    <div id="xk-body"><div class="empty"><div class="small">正在加载…</div></div></div>
    ${ME.role === 'manager' ? `<button class="btn ghost" style="margin-top:12px" onclick="openImport()">导入房源表（Excel 另存为 CSV 后导入）</button>
    <div style="font-size:12px;color:var(--muted);margin:8px 2px;line-height:1.7">现在是模拟数据。真房源表一到，导进来就全换成真的，10 分钟搞定。</div>` : ''}`;
  loadXK();
}
function setXK(b) { xkBuilding = b; vUnits(); }
window.setXK = setXK;

async function loadXK() {
  const d = await api('/api/units?building=' + encodeURIComponent(xkBuilding));
  const floors = {};
  d.list.forEach(u => { (floors[u.floor] = floors[u.floor] || []).push(u); });
  const fKeys = Object.keys(floors).map(Number).sort((a, b) => b - a);
  const cols = Math.max(...fKeys.map(f => floors[f].length));
  const stName = { available: '可售', sold: '已售', locked: '锁定' };
  $('#xk-body').innerHTML = `
    <div class="card pad" style="margin-bottom:12px;display:flex;gap:16px;align-items:center">
      <div><div style="font-size:20px;font-weight:800;color:var(--ok)">${d.available}</div><div style="font-size:12px;color:var(--muted)">可售</div></div>
      <div><div style="font-size:20px;font-weight:800;color:var(--danger)">${d.sold}</div><div style="font-size:12px;color:var(--muted)">已售</div></div>
      <div><div style="font-size:20px;font-weight:800">${d.total}</div><div style="font-size:12px;color:var(--muted)">总数</div></div>
      <div style="margin-left:auto;font-size:12px;color:var(--muted)">去化 ${d.total ? Math.round(d.sold / d.total * 100) : 0}%</div>
    </div>
    <div class="xk-grid" style="grid-template-columns:34px repeat(${cols},1fr)">
      ${fKeys.map(f => `
        <div class="xk-floor">${f}F</div>
        ${floors[f].map(u => `<button class="xk-cell ${u.status}" onclick="openUnit(${u.id})">${esc(u.room)}</button>`).join('')}
      `).join('')}
    </div>
    <div class="xk-legend">
      <span><i class="dot available"></i>可售</span>
      <span><i class="dot sold"></i>已售</span>
      <span><i class="dot locked"></i>锁定</span>
    </div>`;
}

async function openUnit(id) {
  const b = xkBuilding;
  const d = await api('/api/units?building=' + encodeURIComponent(b));
  const u = d.list.find(x => x.id === id);
  if (!u) return;
  const stName = { available: '可售', sold: '已售', locked: '锁定' };
  let mgrHtml = '';
  if (ME.role === 'manager') {
    mgrHtml = `<div class="field"><label>状态</label><div class="seg" id="xu-seg">
        ${['available', 'sold', 'locked'].map(s => `<button class="${u.status === s ? 'on' : ''}" data-s="${s}" onclick="xuSetSeg('${s}')">${stName[s]}</button>`).join('')}
      </div></div>
      <div class="field" id="xu-cust-wrap" style="display:${u.status === 'sold' ? '' : 'none'}"><label>成交客户（已售时选）</label>
        <input id="xu-cust" list="xu-cust-list" placeholder="输入姓名或手机号搜索" value="${esc(u.customer_name || '')}">
        <datalist id="xu-cust-list"></datalist>
      </div>
      <div class="field"><label>备注</label><input id="xu-note" value="${esc(u.note || '')}" placeholder="比如：工程抵款房"></div>
      <button class="btn primary" onclick="doUnitSave(${u.id})">保存</button>`;
    setTimeout(async () => {
      try {
        const cs = await api('/api/customers?status=active');
        $('#xu-cust-list').innerHTML = cs.list.slice(0, 200).map(c => `<option value="${esc(c.name)} ${esc(c.phone)}">`).join('');
      } catch (e) {}
    }, 0);
  }
  openModal(`<h3>${esc(u.building)}栋 ${esc(u.room)}</h3><div class="form">
    <div class="kv"><div class="k">户型</div><div class="v">${esc(u.house_type || '—')}</div></div>
    <div class="kv"><div class="k">面积</div><div class="v">${u.area ? u.area + '㎡' : '—'}</div></div>
    <div class="kv"><div class="k">状态</div><div class="v">${stName[u.status]}${u.customer_name ? ' · ' + esc(u.customer_name) : ''}</div></div>
    ${u.note ? `<div class="kv"><div class="k">备注</div><div class="v">${esc(u.note)}</div></div>` : ''}
    ${mgrHtml ? '<div style="height:12px"></div>' + mgrHtml : '<div style="font-size:12.5px;color:var(--muted);margin-top:10px">改状态找销售经理操作。</div>'}
  </div>`);
  window._xuStatus = u.status;
}
function xuSetSeg(s) {
  window._xuStatus = s;
  document.querySelectorAll('#xu-seg button').forEach(x => x.classList.toggle('on', x.dataset.s === s));
  const w = $('#xu-cust-wrap'); if (w) w.style.display = s === 'sold' ? '' : 'none';
}
window.xuSetSeg = xuSetSeg;
async function doUnitSave(id) {
  const status = window._xuStatus || 'available';
  let customer_id = null;
  const cv = ($('#xu-cust') || {}).value || '';
  if (status === 'sold' && cv) {
    const m = cv.match(/1\d{10}/);
    if (m) {
      try {
        const cs = await api('/api/customers?q=' + encodeURIComponent(m[0]));
        if (cs.list.length) customer_id = cs.list[0].id;
      } catch (e) {}
    }
    if (!customer_id) return toast('没找到这个客户，先去客户库确认下');
  }
  try {
    await api('/api/units/' + id, { method: 'PUT', body: JSON.stringify({ status, customer_id, note: ($('#xu-note') || {}).value || '' }) });
    closeModal(); toast('已更新'); loadXK();
  } catch (e) { toast(e.message); }
}
window.doUnitSave = doUnitSave;
window.openUnit = openUnit;

function openImport() {
  openModal(`<h3>导入房源表</h3><div class="form">
    <div style="font-size:13.5px;color:var(--muted);line-height:1.8;margin-bottom:12px">
      把 Excel 房源表另存为 <b>CSV</b> 后导入。<br>
      列顺序：<b>楼栋，楼层，房号，户型，面积，状态</b>（状态填 可售/已售/锁定）<br>
      第一行表头会自动跳过；已有的房号按"楼栋+房号"更新，不会重复。
    </div>
    <div class="field"><label>选 CSV 文件</label><input type="file" id="imp-file" accept=".csv"></div>
    <div class="btn-row"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="doImport()">开始导入</button></div>
  </div>`);
}
async function doImport() {
  const f = $('#imp-file').files[0];
  if (!f) return toast('先选个 CSV 文件');
  const text = await f.text();
  try {
    const d = await api('/api/units/import', { method: 'POST', body: JSON.stringify({ csv: text }) });
    closeModal(); toast(`导进来了 ${d.count} 套`); xkBuilding = ''; vUnits();
  } catch (e) { toast(e.message); }
}
window.openImport = openImport; window.doImport = doImport;
