#!/usr/bin/env node
/**
 * 案场通 · 案场客户管理系统（第一阶段演示版）
 * PWA 前端 + Node.js + SQLite，零第三方依赖。
 * 运行: node server.js        打开: http://localhost:3000
 * 数据文件: data/anchangtong.db（整个文件拷走就是备份）
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'data', 'anchangtong.db');
const BACKUP_DIR = path.join(ROOT, 'backups');
const POOL_DAYS = 15; // 15 天未跟进流入公池

// ---------- 一键更新 ----------
const BUNDLED_VERSION = '20261013.2'; // 发版时同步改 version.json
const UPDATE_BASE = process.env.ACT_UPDATE_BASE || 'https://cdn.jsdelivr.net/gh/leeugm-create/anchangtong@main';
const UPDATE_FILES = ['server.js', 'public/index.html', 'public/styles.css', 'public/app.js',
  'public/manifest.json', 'public/sw.js', 'public/icon.svg', 'public/icon-192.png', 'public/icon-512.png'];
const VERSION_FILE = path.join(ROOT, 'data', 'version.txt');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 本地版本号（没有就按内置版本写）
function localVersion() {
  try { return fs.readFileSync(VERSION_FILE, 'utf8').trim() || BUNDLED_VERSION; }
  catch (e) { fs.writeFileSync(VERSION_FILE, BUNDLED_VERSION); return BUNDLED_VERSION; }
}
localVersion();

// ---------- 启动时自动备份（保留最近 30 份） ----------
if (fs.existsSync(DB_PATH)) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `anchangtong-${stamp}.db`));
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  console.log('[案场通] 启动自动备份完成');
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

// ---------- 建表 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',  -- manager=销售经理 agent=置业顾问
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  channel TEXT NOT NULL,            -- 自然到访/中介带访/老带新/网络咨询/电话咨询
  intent TEXT NOT NULL DEFAULT 'C', -- A/B/C/D
  demand TEXT DEFAULT '',
  budget TEXT DEFAULT '',
  note TEXT DEFAULT '',
  source_type TEXT NOT NULL DEFAULT '来访', -- 来访/来电
  owner_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- active=跟进中 deal=已成交 deleted=已删除
  last_follow_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  next_plan TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  from_user_id INTEGER,
  to_user_id INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  operator_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS phone_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  old_phone TEXT NOT NULL,
  new_phone TEXT NOT NULL,
  operator_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS op_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER,
  operator_name TEXT DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_followups_customer ON followups(customer_id);
CREATE TABLE IF NOT EXISTS visit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  note TEXT DEFAULT '',
  visited_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_visits_customer ON visit_records(customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visit_records(visited_at);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building TEXT NOT NULL,     -- 楼栋，如 1#
  floor INTEGER NOT NULL,     -- 楼层
  room TEXT NOT NULL,         -- 房号，如 101
  house_type TEXT DEFAULT '', -- 户型，如 118㎡三房
  area REAL DEFAULT 0,        -- 面积
  status TEXT NOT NULL DEFAULT 'available', -- available=可售 sold=已售 locked=锁定
  customer_id INTEGER,        -- 已售关联客户
  note TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_no ON units(building, room);
`);

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
// 老库升级：客户加年龄
try { db.exec('ALTER TABLE customers ADD COLUMN age INTEGER'); } catch (e) { /* 列已存在 */ }
const now = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; };
const poolCutoff = () => { const d = new Date(Date.now() - POOL_DAYS * 864e5); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; };

function logOp(operatorId, operatorName, action, detail) {
  db.prepare('INSERT INTO op_logs (operator_id, operator_name, action, detail) VALUES (?,?,?,?)')
    .run(operatorId, operatorName || '', action, detail || '');
}

// 拉取更新文件（跟随跳转，30秒超时）
function fetchUrl(url, binary) {
  const lib = url.startsWith('https:') ? require('node:https') : require('node:http');
  return new Promise((resolve, reject) => {
    const get = (u, n) => {
      if (n > 5) return reject(new Error('跳转太多了'));
      lib.get(u, { timeout: 30000, headers: { 'User-Agent': 'anchangtong-updater' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return get(new URL(res.headers.location, u).toString(), n + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject).on('timeout', function () { this.destroy(new Error('下载超时')); });
    };
    get(url, 0);
  });
}

// ---------- 演示种子数据（首次运行自动写入） ----------
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  const mk = (name, phone, role) => db.prepare('INSERT INTO users (name, phone, password_hash, role) VALUES (?,?,?,?)')
    .run(name, phone, sha256('123456'), role).lastInsertRowid;
  const mgr = mk('张伟', '13800000001', 'manager');
  const a1 = mk('李娜', '13800000002', 'agent');
  const a2 = mk('王强', '13800000003', 'agent');

  const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 10:30:00`; };
  const seeds = [
    // name, phone, channel, intent, demand, budget, note, source, owner, createdDaysAgo, lastFollowDaysAgo
    ['陈建国', '13980001111', '自然到访', 'A', '118㎡三房，楼层想高一点', '80万左右', '看了118样板间，嫌阳台小，下次带看139', '来访', a1, 3, 1],
    ['刘美玲', '13980002222', '中介带访', 'B', '132㎡四房', '100万以内', '中介小刘带的，夫妻俩一起来，女方做主', '来访', a2, 6, 4],
    ['赵大海', '13980003333', '老带新', 'A', '169㎡大平层', '150万左右', '老业主赵姐介绍的弟弟，诚意很足', '来访', a1, 10, 8],
    ['孙丽', '13980004444', '网络咨询', 'C', '94㎡小三房', '60万左右', '抖音留资，首付预算紧，先线上聊', '来电', a2, 2, 2],
    ['周文斌', '13980005555', '自然到访', 'B', '118㎡或132㎡', '90万以内', '对比过江山云璟，觉得我们得房率高', '来访', a1, 20, 18],
    ['吴小芳', '13980006666', '电话咨询', 'D', '先了解', '没说', '随口问问价格，意向弱', '来电', a2, 25, 22],
    ['郑国强', '13980007777', '自然到访', 'B', '139㎡四房', '110万左右', '要看江景楼层，等高楼层放出来', '来访', a1, 30, 17],
    ['冯雪', '13980008888', '中介带访', 'C', '118㎡三房', '85万左右', '中介老王带的，看完说回去商量', '来访', a2, 16, 16],
    ['褚亮', '13980009999', '老带新', 'A', '132㎡四房', '100万左右', '朋友已认筹，跟着一起看，当天差点下定', '来访', a1, 1, 0],
    ['卫红', '13980001010', '自然到访', 'C', '94㎡', '60万以内', '给儿子看婚房，儿子在外地没来', '来访', a2, 12, 11],
    ['蒋涛', '13980002020', '网络咨询', 'B', '118㎡三房', '80万左右', '贝壳上看到的，约了周末来看', '来电', a1, 4, 3],
    ['沈佳', '13980003030', '电话咨询', 'B', '132㎡四房', '100万以内', '问了学校划片，孩子明年上小学', '来电', a2, 9, 7],
  ];
  const insC = db.prepare(`INSERT INTO customers (name,phone,channel,intent,demand,budget,note,source_type,owner_id,age,created_at,last_follow_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insF = db.prepare(`INSERT INTO followups (customer_id,user_id,content,next_plan,created_at) VALUES (?,?,?,?,?)`);
  const insV = db.prepare(`INSERT INTO visit_records (customer_id,user_id,note,visited_at) VALUES (?,?,?,?)`);
  const ages = [38, 32, 45, 29, 41, 36, 52, 30, 34, 48, 33, 28];
  let si = 0;
  for (const s of seeds) {
    const id = insC.run(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], ages[si % ages.length], daysAgo(s[9]), daysAgo(s[10])).lastInsertRowid;
    si++;
    // 首访记一条到访；来得早的再补一条
    if (s[7] === '来访') insV.run(id, s[8], '首访', daysAgo(s[9]));
    if (s[9] >= 15) insV.run(id, s[8], '再次到访', daysAgo(Math.max(1, s[10] - 2)));
    if (s[10] <= 12) {
      insF.run(id, s[8], `首访接待：${s[6]}`, '三天内再约一次', daysAgo(s[9]));
      if (s[10] >= 3) insF.run(id, s[8], '电话回访：客户还在对比，说下周给准信', '下周三前再跟一次', daysAgo(s[10]));
    }
  }
  // 一条判客记录 + 一条改号记录，演示留痕
  db.prepare('INSERT INTO transfers (customer_id, from_user_id, to_user_id, reason, operator_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(10, a2, a1, '王强手里A类客户多，卫红转给李娜均衡一下', mgr, daysAgo(1));
  db.prepare('UPDATE customers SET owner_id=? WHERE id=10').run(a1);
  db.prepare('INSERT INTO phone_changes (customer_id, old_phone, new_phone, operator_id, created_at) VALUES (?,?,?,?,?)')
    .run(6, '13980006660', '13980006666', mgr, daysAgo(5));
  // 模拟房源（销控演示用，真表到了走导入替换）
  const types = [['118㎡三房', 118], ['132㎡四房', 132], ['139㎡四房', 139], ['169㎡大平层', 169]];
  const insU = db.prepare('INSERT INTO units (building, floor, room, house_type, area, status) VALUES (?,?,?,?,?,?)');
  let seedRnd = 42;
  const rnd = () => (seedRnd = (seedRnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const b of ['1#', '2#']) {
    for (let f = 1; f <= 10; f++) {
      for (let r = 1; r <= 4; r++) {
        const t = types[(r - 1) % 4];
        const room = `${f}${String(r).padStart(2, '0')}`;
        const status = rnd() < 0.25 ? 'sold' : 'available';
        insU.run(b, f, room, t[0], t[1], status);
      }
    }
  }
  logOp(mgr, '张伟', '初始化', '演示数据已写入');
  console.log('[案场通] 演示数据已写入（登录账号见 README）');
}

// ---------- 工具 ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 2e6) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
  });
}
function getUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  return db.prepare('SELECT id, name, phone, role FROM users WHERE id=? AND active=1').get(s.user_id) || null;
}
const customerRow = r => r ? {
  id: r.id, name: r.name, phone: r.phone, age: r.age || null, channel: r.channel, intent: r.intent,
  demand: r.demand, budget: r.budget, note: r.note, source_type: r.source_type,
  owner_id: r.owner_id, owner_name: r.owner_name, status: r.status,
  in_pool: r.status === 'active' && r.last_follow_at < poolCutoff(),
  last_follow_at: r.last_follow_at, created_at: r.created_at, updated_at: r.updated_at
} : null;
const CUST_SELECT = `c.*, u.name AS owner_name FROM customers c LEFT JOIN users u ON u.id=c.owner_id`;

// ---------- 路由 ----------
async function router(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // 静态文件
  if (!p.startsWith('/api/')) {
    let fp = path.join(ROOT, 'public', p === '/' ? 'index.html' : decodeURIComponent(p.slice(1)));
    if (!fp.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'forbidden' });
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (!fs.existsSync(fp)) fp = path.join(ROOT, 'public', 'index.html'); // SPA 回退
    const ext = path.extname(fp).toLowerCase();
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
    fs.createReadStream(fp).pipe(res);
    return;
  }

  const seg = p.slice(5).split('/').filter(Boolean); // /api/ 之后
  const method = req.method;
  const user = getUser(req);

  // ---- 登录（无需 token） ----
  if (seg[0] === 'login' && method === 'POST') {
    const { phone, password } = await readBody(req);
    const u = db.prepare('SELECT * FROM users WHERE phone=? AND active=1').get(String(phone || '').trim());
    if (!u || u.password_hash !== sha256(password || '')) return send(res, 401, { error: '手机号或密码不对' });
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.id);
    logOp(u.id, u.name, '登录', '');
    return send(res, 200, { token, user: { id: u.id, name: u.name, phone: u.phone, role: u.role } });
  }
  if (seg[0] === 'logout' && method === 'POST') {
    const h = req.headers['authorization'] || '';
    if (h.startsWith('Bearer ')) db.prepare('DELETE FROM sessions WHERE token=?').run(h.slice(7));
    return send(res, 200, { ok: true });
  }
  if (!user) return send(res, 401, { error: '请先登录' });
  const isMgr = user.role === 'manager';

  // ---- 我的信息 ----
  if (seg[0] === 'me') return send(res, 200, { user, version: BUNDLED_VERSION });

  // ---- 工作台统计 ----
  if (seg[0] === 'stats') {
    const today = now().slice(0, 10);
    const scope = isMgr ? '' : 'AND owner_id=' + user.id;
    const q = (sql, ...a) => db.prepare(sql).get(...a);
    const todayVisit = q(`SELECT COUNT(*) c FROM customers WHERE status!='deleted' AND source_type='来访' AND substr(created_at,1,10)=? ${scope}`, today).c;
    const weekNew = q(`SELECT COUNT(*) c FROM customers WHERE status!='deleted' AND created_at >= datetime('now','localtime','-7 days') ${scope}`).c;
    const mine = q(`SELECT COUNT(*) c FROM customers WHERE status='active' ${scope}`).c;
    const pool = q(`SELECT COUNT(*) c FROM customers WHERE status='active' AND last_follow_at < ? ${scope}`, poolCutoff()).c;
    const deals = q(`SELECT COUNT(*) c FROM customers WHERE status='deal' ${scope}`).c;
    return send(res, 200, { todayVisit, weekNew, mine, pool, deals });
  }

  // ---- 客户列表 ----
  if (seg[0] === 'customers' && seg.length === 1 && method === 'GET') {
    const { q: kw = '', channel = '', intent = '', status = '', owner = '', from = '', to = '', pool = '' } = Object.fromEntries(url.searchParams);
    const cond = [`c.status != 'deleted'`];
    const args = [];
    if (!isMgr) { cond.push('c.owner_id = ?'); args.push(user.id); }
    if (kw) { cond.push('(c.name LIKE ? OR c.phone LIKE ?)'); args.push(`%${kw}%`, `%${kw}%`); }
    if (channel) { cond.push('c.channel = ?'); args.push(channel); }
    if (intent) { cond.push('c.intent = ?'); args.push(intent); }
    if (owner && isMgr) { cond.push('c.owner_id = ?'); args.push(owner); }
    if (from) { cond.push(`substr(c.created_at,1,10) >= ?`); args.push(from); }
    if (to) { cond.push(`substr(c.created_at,1,10) <= ?`); args.push(to); }
    if (status === 'pool') { cond.push(`c.status='active' AND c.last_follow_at < ?`); args.push(poolCutoff()); }
    else if (status === 'active' || status === 'deal') { cond.push('c.status = ?'); args.push(status); }
    else if (status === 'deleted' && isMgr) { cond[0] = `c.status = 'deleted'`; }
    const rows = db.prepare(`SELECT ${CUST_SELECT} WHERE ${cond.join(' AND ')} ORDER BY c.updated_at DESC LIMIT 500`).all(...args);
    return send(res, 200, { list: rows.map(customerRow), poolDays: POOL_DAYS });
  }

  // ---- 新建客户（来访/来电登记） ----
  if (seg[0] === 'customers' && seg.length === 1 && method === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim(), phone = String(b.phone || '').trim();
    if (!name || !/^1\d{10}$/.test(phone)) return send(res, 400, { error: '姓名和 11 位手机号都要填对' });
    const dup = db.prepare(`SELECT ${CUST_SELECT} WHERE c.phone=? AND c.status!='deleted'`).get(phone);
    if (dup) return send(res, 409, { error: '这个手机号已经登记过了', customer: customerRow(dup) });
    const age = b.age ? Math.max(0, Math.min(120, Number(b.age) || 0)) : null;
    const r = db.prepare(`INSERT INTO customers (name,phone,channel,intent,demand,budget,note,source_type,owner_id,age)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(name, phone, b.channel || '自然到访', b.intent || 'C',
      String(b.demand || ''), String(b.budget || ''), String(b.note || ''), b.source_type || '来访', user.id, age);
    const newId = r.lastInsertRowid;
    if ((b.source_type || '来访') === '来访') {
      db.prepare('INSERT INTO visit_records (customer_id, user_id, note) VALUES (?,?,?)').run(newId, user.id, '首访登记');
    }
    logOp(user.id, user.name, b.source_type === '来电' ? '来电登记' : '来访登记', `${name} ${phone}`);
    return send(res, 200, { id: newId });
  }

  const cid = seg[1] ? Number(seg[1]) : null;

  // ---- 客户详情 ----
  if (seg[0] === 'customers' && seg.length === 2 && method === 'GET' && cid) {
    const r = db.prepare(`SELECT ${CUST_SELECT} WHERE c.id=?`).get(cid);
    if (!r || r.status === 'deleted' || (!isMgr && r.owner_id !== user.id)) return send(res, 404, { error: '找不到这个客户' });
    const c = customerRow(r);
    c.followups = db.prepare(`SELECT f.*, u.name AS user_name FROM followups f LEFT JOIN users u ON u.id=f.user_id WHERE f.customer_id=? ORDER BY f.created_at DESC`).all(cid);
    c.visits = db.prepare(`SELECT v.*, u.name AS user_name FROM visit_records v LEFT JOIN users u ON u.id=v.user_id WHERE v.customer_id=? ORDER BY v.visited_at DESC`).all(cid);
    c.transfers = db.prepare(`SELECT t.*, a.name AS from_name, b.name AS to_name, o.name AS op_name FROM transfers t LEFT JOIN users a ON a.id=t.from_user_id LEFT JOIN users b ON b.id=t.to_user_id LEFT JOIN users o ON o.id=t.operator_id WHERE t.customer_id=? ORDER BY t.created_at DESC`).all(cid);
    c.phone_changes = db.prepare(`SELECT p.*, o.name AS op_name FROM phone_changes p LEFT JOIN users o ON o.id=p.operator_id WHERE p.customer_id=? ORDER BY p.created_at DESC`).all(cid);
    return send(res, 200, { customer: c });
  }

  // ---- 写跟进 ----
  if (seg[0] === 'customers' && seg.length === 3 && seg[2] === 'followups' && method === 'POST' && cid) {
    const r = db.prepare('SELECT * FROM customers WHERE id=?').get(cid);
    if (!r || r.status !== 'active' || (!isMgr && r.owner_id !== user.id)) return send(res, 404, { error: '找不到这个客户' });
    const b = await readBody(req);
    const content = String(b.content || '').trim();
    if (!content) return send(res, 400, { error: '跟进内容不能为空' });
    db.prepare('INSERT INTO followups (customer_id, user_id, content, next_plan) VALUES (?,?,?,?)')
      .run(cid, user.id, content, String(b.next_plan || ''));
    db.prepare(`UPDATE customers SET last_follow_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(cid);
    logOp(user.id, user.name, '写跟进', `${r.name}：${content.slice(0, 30)}`);
    return send(res, 200, { ok: true });
  }

  // ---- 抢客（从公池） ----
  if (seg[0] === 'customers' && seg.length === 3 && seg[2] === 'grab' && method === 'POST' && cid) {
    const r = db.prepare('SELECT * FROM customers WHERE id=?').get(cid);
    if (!r || r.status !== 'active' || !(r.last_follow_at < poolCutoff())) return send(res, 400, { error: '这个客户不在公池里' });
    db.prepare('UPDATE customers SET owner_id=?, last_follow_at=datetime(\'now\',\'localtime\'), updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(user.id, cid);
    db.prepare('INSERT INTO transfers (customer_id, from_user_id, to_user_id, reason, operator_id) VALUES (?,?,?,?,?)')
      .run(cid, r.owner_id, user.id, '公池抢客', user.id);
    logOp(user.id, user.name, '公池抢客', `${r.name} ${r.phone}`);
    return send(res, 200, { ok: true });
  }

  // ---- 经理：编辑客户（含改号码留痕） ----
  if (seg[0] === 'customers' && seg.length === 2 && method === 'PUT' && cid && isMgr) {
    const r = db.prepare('SELECT * FROM customers WHERE id=?').get(cid);
    if (!r) return send(res, 404, { error: '找不到这个客户' });
    const b = await readBody(req);
    if (b.phone && b.phone !== r.phone) {
      if (!/^1\d{10}$/.test(b.phone)) return send(res, 400, { error: '新手机号格式不对' });
      db.prepare('INSERT INTO phone_changes (customer_id, old_phone, new_phone, operator_id) VALUES (?,?,?,?)')
        .run(cid, r.phone, b.phone, user.id);
      logOp(user.id, user.name, '改号码', `${r.name}：${r.phone} → ${b.phone}`);
    }
    db.prepare(`UPDATE customers SET name=?, phone=?, age=?, channel=?, intent=?, demand=?, budget=?, note=?, status=?,
      updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.name || r.name, b.phone || r.phone, b.age !== undefined ? b.age : r.age, b.channel || r.channel, b.intent || r.intent,
        b.demand ?? r.demand, b.budget ?? r.budget, b.note ?? r.note, b.status || r.status, cid);
    logOp(user.id, user.name, '编辑客户', `${r.name} 资料已更新`);
    return send(res, 200, { ok: true });
  }

  // ---- 经理：判客（改归属） ----
  if (seg[0] === 'customers' && seg.length === 3 && seg[2] === 'transfer' && method === 'POST' && cid && isMgr) {
    const r = db.prepare('SELECT * FROM customers WHERE id=?').get(cid);
    const b = await readBody(req);
    const to = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(Number(b.to_user_id));
    if (!r || !to) return send(res, 400, { error: '客户或目标顾问不对' });
    db.prepare('UPDATE customers SET owner_id=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(to.id, cid);
    db.prepare('INSERT INTO transfers (customer_id, from_user_id, to_user_id, reason, operator_id) VALUES (?,?,?,?,?)')
      .run(cid, r.owner_id, to.id, String(b.reason || ''), user.id);
    const fromName = db.prepare('SELECT name FROM users WHERE id=?').get(r.owner_id)?.name || '公池';
    logOp(user.id, user.name, '判客', `${r.name}：${fromName} → ${to.name}（${b.reason || '无原因'}）`);
    return send(res, 200, { ok: true });
  }

  // ---- 经理：软删除 / 恢复 ----
  if (seg[0] === 'customers' && seg.length === 3 && seg[2] === 'delete' && method === 'POST' && cid && isMgr) {
    const r = db.prepare('SELECT * FROM customers WHERE id=?').get(cid);
    if (!r) return send(res, 404, { error: '找不到这个客户' });
    db.prepare(`UPDATE customers SET status='deleted', updated_at=datetime('now','localtime') WHERE id=?`).run(cid);
    logOp(user.id, user.name, '删除客户', `${r.name} ${r.phone}（软删除，可恢复）`);
    return send(res, 200, { ok: true });
  }
  if (seg[0] === 'customers' && seg.length === 3 && seg[2] === 'restore' && method === 'POST' && cid && isMgr) {
    db.prepare(`UPDATE customers SET status='active', updated_at=datetime('now','localtime') WHERE id=?`).run(cid);
    logOp(user.id, user.name, '恢复客户', `ID ${cid}`);
    return send(res, 200, { ok: true });
  }

  // ---- 记到访（老客户又来了） ----
  if (seg[0] === 'customers' && seg.length === 3 && seg[2] === 'visits' && method === 'POST' && cid) {
    const r = db.prepare('SELECT * FROM customers WHERE id=?').get(cid);
    if (!r || r.status === 'deleted' || (!isMgr && r.owner_id !== user.id)) return send(res, 404, { error: '找不到这个客户' });
    const b = await readBody(req);
    const cnt = db.prepare('SELECT COUNT(*) c FROM visit_records WHERE customer_id=?').get(cid).c;
    db.prepare('INSERT INTO visit_records (customer_id, user_id, note) VALUES (?,?,?)').run(cid, user.id, String(b.note || ''));
    db.prepare(`UPDATE customers SET last_follow_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(cid);
    logOp(user.id, user.name, '记到访', `${r.name} 第${cnt + 1}次到访`);
    return send(res, 200, { ok: true, visit_no: cnt + 1 });
  }

  // ---- 报表：今日/周/月/年 ----
  if (seg[0] === 'report' && method === 'GET') {
    const range = ['today', 'week', 'month', 'year'].includes(url.searchParams.get('range')) ? url.searchParams.get('range') : 'today';
    const ref = url.searchParams.get('date') || now().slice(0, 10);
    const pad = n => String(n).padStart(2, '0');
    const fmtD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const refD = new Date(ref + 'T12:00:00');
    let from, to = fmtD(refD), group = 'day';
    if (range === 'today') from = to;
    else if (range === 'week') from = fmtD(new Date(refD.getTime() - 6 * 864e5));
    else if (range === 'month') from = fmtD(new Date(refD.getTime() - 29 * 864e5));
    else { group = 'month'; const m = new Date(refD.getFullYear(), refD.getMonth() - 11, 1); from = fmtD(m); }
    const dateCond = alias => `substr(${alias},1,10) BETWEEN '${from}' AND '${to}'`;
    const scopeC = isMgr ? '' : `AND c.owner_id=${user.id}`;
    const scopeV = isMgr ? '' : `AND (vr.user_id=${user.id} OR c.owner_id=${user.id})`;

    const visits = db.prepare(`
      SELECT vr.id, vr.visited_at, vr.note, c.id AS customer_id, c.name, c.age, c.phone, c.channel, c.intent,
             u.name AS agent_name,
             (SELECT COUNT(*) FROM visit_records v2 WHERE v2.customer_id=vr.customer_id AND v2.visited_at <= vr.visited_at) AS visit_no
      FROM visit_records vr JOIN customers c ON c.id=vr.customer_id LEFT JOIN users u ON u.id=vr.user_id
      WHERE c.status != 'deleted' AND ${dateCond('vr.visited_at')} ${scopeV}
      ORDER BY vr.visited_at DESC LIMIT 200`).all();
    const calls = db.prepare(`
      SELECT c.id, c.name, c.age, c.phone, c.channel, c.intent, c.created_at, u.name AS agent_name
      FROM customers c LEFT JOIN users u ON u.id=c.owner_id
      WHERE c.status != 'deleted' AND c.source_type='来电' AND ${dateCond('c.created_at')} ${scopeC}
      ORDER BY c.created_at DESC LIMIT 200`).all();
    const news = db.prepare(`
      SELECT c.id, c.name, c.phone, c.channel, c.source_type, c.created_at, u.name AS agent_name
      FROM customers c LEFT JOIN users u ON u.id=c.owner_id
      WHERE c.status != 'deleted' AND ${dateCond('c.created_at')} ${scopeC}
      ORDER BY c.created_at DESC LIMIT 200`).all();
    const deals = db.prepare(`
      SELECT c.id, c.name, c.phone, c.updated_at, u.name AS agent_name
      FROM customers c LEFT JOIN users u ON u.id=c.owner_id
      WHERE c.status='deal' AND ${dateCond('c.updated_at')} ${scopeC}
      ORDER BY c.updated_at DESC LIMIT 200`).all();

    // 趋势桶
    const buckets = [];
    if (group === 'day') {
      for (let t = new Date(from + 'T12:00:00'); fmtD(t) <= to; t = new Date(t.getTime() + 864e5)) {
        const k = fmtD(t);
        buckets.push({ label: k.slice(5), key: k, visits: 0, calls: 0 });
      }
      const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
      visits.forEach(v => { const i = idx[v.visited_at.slice(0, 10)]; if (i != null) buckets[i].visits++; });
      calls.forEach(c => { const i = idx[c.created_at.slice(0, 10)]; if (i != null) buckets[i].calls++; });
    } else {
      const start = new Date(from + 'T12:00:00');
      for (let i = 0; i < 12; i++) {
        const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const k = `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
        buckets.push({ label: k.slice(5) + '月', key: k, visits: 0, calls: 0 });
      }
      const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
      visits.forEach(v => { const i = idx[v.visited_at.slice(0, 7)]; if (i != null) buckets[i].visits++; });
      calls.forEach(c => { const i = idx[c.created_at.slice(0, 7)]; if (i != null) buckets[i].calls++; });
    }
    // 顾问排行
    const ag = {};
    const bump = (name, k) => { if (!name) return; ag[name] = ag[name] || { name, visits: 0, calls: 0, news: 0, deals: 0 }; ag[name][k]++; };
    visits.forEach(v => bump(v.agent_name, 'visits'));
    calls.forEach(c => bump(c.agent_name, 'calls'));
    news.forEach(c => bump(c.agent_name, 'news'));
    deals.forEach(c => bump(c.agent_name, 'deals'));
    const agents = Object.values(ag).sort((a, b) => (b.visits + b.calls) - (a.visits + a.calls));

    return send(res, 200, {
      range, from, to,
      summary: { visits: visits.length > 0 ? db.prepare(`SELECT COUNT(*) c FROM visit_records vr JOIN customers c ON c.id=vr.customer_id WHERE c.status!='deleted' AND ${dateCond('vr.visited_at')} ${scopeV}`).get().c : 0, calls: calls.length, newCustomers: news.length, deals: deals.length },
      trend: buckets, agents,
      visitDetails: visits.slice(0, 100), callDetails: calls.slice(0, 100),
    });
  }
  if (seg[0] === 'users' && method === 'GET' && isMgr) {
    const list = db.prepare(`SELECT u.id, u.name, u.phone, u.role,
      (SELECT COUNT(*) FROM customers c WHERE c.owner_id=u.id AND c.status='active') AS active_count
      FROM users u WHERE u.active=1 ORDER BY u.role DESC, u.id`).all();
    return send(res, 200, { list });
  }

  // ---- 经理：操作日志 ----
  if (seg[0] === 'logs' && method === 'GET' && isMgr) {
    const list = db.prepare('SELECT * FROM op_logs ORDER BY id DESC LIMIT 200').all();
    return send(res, 200, { list });
  }

  // ---- 经理：导出 Excel(CSV) ----
  if (seg[0] === 'export.csv' && method === 'GET' && isMgr) {
    const rows = db.prepare(`SELECT ${CUST_SELECT} WHERE c.status!='deleted' ORDER BY c.created_at DESC`).all();
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['\uFEFF客户姓名,手机号,渠道,意向,需求,预算,来源,归属顾问,状态,最后跟进,登记时间,备注'];
    for (const r of rows) {
      const st = r.status === 'deal' ? '已成交' : (r.last_follow_at < poolCutoff() ? '公池' : '跟进中');
      lines.push([r.name, r.phone, r.channel, r.intent, r.demand, r.budget, r.source_type, r.owner_name, st, r.last_follow_at, r.created_at, r.note].map(esc).join(','));
    }
    const body = lines.join('\r\n');
    logOp(user.id, user.name, '导出客户', `共 ${rows.length} 条`);
    const fname = encodeURIComponent(`客户导出-${now().slice(0, 10)}.csv`);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="export.csv"; filename*=UTF-8''${fname}`, 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }

  // ---- 经理：下载数据库文件（整库带走） ----
  if (seg[0] === 'backup' && method === 'GET' && isMgr) {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    logOp(user.id, user.name, '下载数据库', '整库 .db 文件已下载');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="anchangtong-${now().slice(0, 10)}.db"` });
    return fs.createReadStream(DB_PATH).pipe(res);
  }

  // ---- 销控：楼栋列表 ----
  if (seg[0] === 'units' && seg[1] === 'buildings' && method === 'GET') {
    const list = db.prepare('SELECT DISTINCT building FROM units ORDER BY building').all().map(r => r.building);
    return send(res, 200, { list });
  }

  // ---- 销控：房源列表（按楼栋） ----
  if (seg[0] === 'units' && seg.length === 1 && method === 'GET') {
    const building = url.searchParams.get('building') || '';
    const cond = building ? 'WHERE building=?' : '';
    const args = building ? [building] : [];
    const list = db.prepare(`SELECT u.*, c.name AS customer_name FROM units u LEFT JOIN customers c ON c.id=u.customer_id ${cond} ORDER BY u.floor DESC, u.room`).all(...args);
    const total = list.length;
    const sold = list.filter(u => u.status === 'sold').length;
    return send(res, 200, { list, total, sold, available: total - sold });
  }

  // ---- 销控：改状态（经理） ----
  if (seg[0] === 'units' && seg.length === 2 && method === 'PUT' && cid && isMgr) {
    const u = db.prepare('SELECT * FROM units WHERE id=?').get(cid);
    if (!u) return send(res, 404, { error: '找不到这套房' });
    const b = await readBody(req);
    const status = ['available', 'sold', 'locked'].includes(b.status) ? b.status : u.status;
    const customerId = b.customer_id ? Number(b.customer_id) : null;
    db.prepare(`UPDATE units SET status=?, customer_id=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(status, customerId, String(b.note || ''), cid);
    const stName = { available: '可售', sold: '已售', locked: '锁定' }[status];
    if (status === 'sold' && customerId) {
      db.prepare(`UPDATE customers SET status='deal', updated_at=datetime('now','localtime') WHERE id=?`).run(customerId);
    }
    const custName = customerId ? (db.prepare('SELECT name FROM customers WHERE id=?').get(customerId)?.name || '') : '';
    logOp(user.id, user.name, '销控改状态', `${u.building}${u.room} → ${stName}${custName ? '（' + custName + '）' : ''}`);
    return send(res, 200, { ok: true });
  }

  // ---- 销控：房源导入（经理，CSV 文本） ----
  // 列：楼栋,楼层,房号,户型,面积,状态（可售/已售/锁定）
  if (seg[0] === 'units' && seg[1] === 'import' && method === 'POST' && isMgr) {
    const b = await readBody(req);
    const text = String(b.csv || '').trim();
    if (!text) return send(res, 400, { error: '没有读到表格内容' });
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const stMap = { '可售': 'available', '已售': 'sold', '锁定': 'locked', 'available': 'available', 'sold': 'sold', 'locked': 'locked' };
    let n = 0;
    const upsert = db.prepare(`INSERT INTO units (building, floor, room, house_type, area, status)
      VALUES (?,?,?,?,?,?) ON CONFLICT(building, room) DO UPDATE SET house_type=excluded.house_type, area=excluded.area, status=excluded.status, updated_at=datetime('now','localtime')`);
    for (const line of lines) {
      if (/楼栋|building/i.test(line) && n === 0 && /房号/.test(line)) continue; // 跳过表头
      const cols = line.split(/[,，\t]/).map(c => c.trim());
      if (cols.length < 3) continue;
      const [building, floor, room, houseType = '', area = 0, st = '可售'] = cols;
      if (!building || !room) continue;
      upsert.run(building, Number(floor) || 0, room, houseType, Number(area) || 0, stMap[st] || 'available');
      n++;
    }
    logOp(user.id, user.name, '房源导入', `导入 ${n} 套`);
    return send(res, 200, { ok: true, count: n });
  }

  // ---- 一键更新：检查（经理） ----
  if (seg[0] === 'update' && seg[1] === 'check' && method === 'GET' && isMgr) {
    try {
      const remote = JSON.parse(await fetchUrl(UPDATE_BASE + '/version.json'));
      return send(res, 200, { current: localVersion(), latest: remote.version || '0', hasUpdate: (remote.version || '0') !== localVersion() });
    } catch (e) { return send(res, 502, { error: '连不上更新服务器，稍后再试' }); }
  }

  // ---- 一键更新：下载并应用（经理） ----
  if (seg[0] === 'update' && seg[1] === 'apply' && method === 'POST' && isMgr) {
    let remote;
    try { remote = JSON.parse(await fetchUrl(UPDATE_BASE + '/version.json')); }
    catch (e) { return send(res, 502, { error: '连不上更新服务器，稍后再试' }); }
    if ((remote.version || '0') === localVersion()) return send(res, 200, { ok: true, already: true });
    const files = Array.isArray(remote.files) && remote.files.length ? remote.files : UPDATE_FILES;
    try {
      // 先全部下载到内存，齐了再写盘
      const payload = [];
      for (const f of files) {
        if (f.includes('..') || path.isAbsolute(f)) throw new Error('非法文件路径');
        const data = await fetchUrl(UPDATE_BASE + '/' + f, true);
        if (!data.length) throw new Error('文件为空：' + f);
        payload.push([f, data]);
      }
      for (const [f, data] of payload) {
        const fp = path.join(ROOT, f);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, data);
      }
      fs.writeFileSync(VERSION_FILE, remote.version);
      logOp(user.id, user.name, '一键更新', `版本 ${localVersion()} → ${remote.version}`);
      send(res, 200, { ok: true, version: remote.version });
      setTimeout(() => process.exit(99), 800); // 99 = 告诉启动脚本重启
    } catch (e) { return send(res, 502, { error: '更新包下载失败，没动你现在的文件：' + e.message }); }
    return;
  }

  return send(res, 404, { error: '没有这个接口' });
}

const server = http.createServer((req, res) => {
  router(req, res).catch(e => {
    console.error(e);
    try { send(res, 500, { error: '服务器开小差了，请稍后再试' }); } catch (_) {}
  });
});
server.listen(PORT, () => {
  console.log(`[案场通] 已启动 → http://localhost:${PORT}`);
  console.log(`[案场通] 数据文件 → ${DB_PATH}`);
});
