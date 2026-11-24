// White-label VPN backend: auth (email+OTP, Google), store entitlements,
// ResellPortal provisioning, tickets, admin API.
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';

const E = process.env;
for (const k of ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'OTP_PEPPER'])
  if (!E[k] || E[k].length < 32) throw new Error(`${k} must be set (32+ chars)`);

const db = new Database(E.DB_PATH || 'app.db');
db.pragma('journal_mode = WAL');
db.exec(`
create table if not exists users(id integer primary key, email text unique, pw text, via text,
  rp_client_id integer, rp_service_id integer, sub_status text default 'none',
  expires_at integer default 0, created_at integer);
create table if not exists otps(email text primary key, code_hash text, pw text, exp integer, tries integer default 0);
create table if not exists tickets(id integer primary key, user_id integer, email text, cat text,
  subject text, msg text, emailed integer default 0, created_at integer);
create table if not exists settings(k text primary key, v text);
create table if not exists admin(id integer primary key check(id=1), user text, pw text, must_change integer);
`);

// ---------- settings (branding + support) ----------
const DEFAULTS = {
  brand: 'Network Geeks', accent: '#0f766e', logo: '', trial_days: '7', price: '1.99',
  whatsapp: '+19715247533', support_email: 'conrad.pm1994@gmail.com',
};
const getS = () => ({ ...DEFAULTS, ...Object.fromEntries(db.prepare('select k,v from settings').all().map(r => [r.k, r.v])) });
const setS = (k, v) => db.prepare('insert into settings(k,v) values(?,?) on conflict(k) do update set v=excluded.v').run(k, String(v));

// ---------- default admin (forced change on first login) ----------
if (!db.prepare('select 1 from admin').get())
  db.prepare('insert into admin(id,user,pw,must_change) values(1,?,?,1)')
    .run(E.ADMIN_USER || 'admin', bcrypt.hashSync(E.ADMIN_PASS || 'ChangeMe!2026', 12));

// ---------- helpers ----------
const mail = nodemailer.createTransport({
  host: E.SMTP_HOST, port: +(E.SMTP_PORT || 587), secure: E.SMTP_PORT === '465',
  auth: { user: E.SMTP_USER, pass: E.SMTP_PASS },
});
const send = (to, subject, text, replyTo) =>
  mail.sendMail({ from: E.MAIL_FROM || E.SMTP_USER, to, subject, text, replyTo });

const sign = (u) => jwt.sign({ uid: u.id }, E.JWT_SECRET, { expiresIn: '30d' });
const emailOk = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const hashOtp = (email, code) => crypto.createHmac('sha256', E.OTP_PEPPER).update(email + ':' + code).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const entitled = (u) => ['trial', 'active'].includes(u.sub_status) && u.expires_at > Date.now();
const publicUser = (u) => ({ id: u.id, email: u.email, status: entitled(u) ? u.sub_status : (u.sub_status === 'none' ? 'none' : 'expired'), expiresAt: u.expires_at });

// ---------- ResellPortal adapter (the only place that talks to it) ----------
// Auth headers: X-API-Key and X-API-Secret (confirmed by the account owner).
// ASSUMPTION: request/response field names below are not confirmed. Check the
// docs or a real test response, then adjust here only.
const RP_BASE = (E.RP_BASE || 'https://panel.resellportal.com') + '/wp-json/resellportal/v1';
async function rp(path, { method = 'GET', body } = {}) {
  const r = await fetch(RP_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      [E.RP_KEY_HEADER || 'X-API-Key']: E.RP_KEY,
      [E.RP_SECRET_HEADER || 'X-API-Secret']: E.RP_SECRET,
      ...(E.RP_TEST_MODE === '1' ? { 'X-RP-Test-Mode': '1' } : {}),
    },
    body: body && JSON.stringify(body),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw Object.assign(new Error('ResellPortal ' + r.status), { detail: j });
  return j;
}
async function provision(u) {
  if (u.rp_service_id) return;
  let cid = u.rp_client_id;
  if (!cid) {
    const c = await rp('/clients', { method: 'POST', body: { email: u.email, name: u.email.split('@')[0] } });
    cid = c.id ?? c.client?.id ?? c.client_id;
    db.prepare('update users set rp_client_id=? where id=?').run(cid, u.id);
  }
  // Costs the reseller wallet (about $1.75/month) - only call after the store confirms the trial.
  const o = await rp('/orders', { method: 'POST', body: { client_id: cid, product_key: 'vpn', billing_cycle: 'monthly', skip_client_email: true } });
  const sid = o.service_id ?? o.service?.id ?? o.order?.service_id;
  if (!sid) { console.error('Unexpected order response', o); throw new Error('no service id'); }
  db.prepare('update users set rp_service_id=? where id=?').run(sid, u.id);
}
async function deprovision(u) {
  if (u.rp_service_id) await rp('/services/' + u.rp_service_id, { method: 'DELETE' });
  db.prepare('update users set rp_service_id=null where id=?').run(u.id);
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
// Allowed app origins, comma-separated (web build URL, capacitor://localhost, https://localhost)
app.use(cors({ origin: (E.CORS_ORIGINS || '').split(',').filter(Boolean) }));
app.use(express.json({ limit: '1mb' }));
const lim = (n, m = 15) => rateLimit({ windowMs: m * 60e3, limit: n, standardHeaders: true, legacyHeaders: false });
const wrap = (f) => (q, s, n) => Promise.resolve(f(q, s, n)).catch((e) => { console.error(e.detail || e); s.status(500).json({ error: 'Something went wrong. Try again.' }); });

const auth = (req, res, next) => {
  try {
    const p = jwt.verify((req.get('authorization') || '').replace(/^Bearer /, ''), E.JWT_SECRET);
    req.user = db.prepare('select * from users where id=?').get(p.uid);
    return req.user ? next() : res.status(401).json({ error: 'Sign in again.' });
  } catch { return res.status(401).json({ error: 'Sign in again.' }); }
};

app.get('/config', (_q, s) => { // public: branding + support for the app
  const c = getS();
  s.json({ brand: c.brand, accent: c.accent, logo: c.logo, trialDays: +c.trial_days, price: +c.price, whatsapp: c.whatsapp, supportEmail: c.support_email });
});

// ----- email sign-up with OTP -----
app.post('/auth/email/start', lim(10), wrap(async (q, s) => {
  const { email, password } = q.body || {};
  if (!emailOk(email) || typeof password !== 'string' || password.length < 8 || password.length > 128)
    return s.status(400).json({ error: 'Enter a valid email and a password of 8+ characters.' });
  const e = email.toLowerCase();
  if (db.prepare('select 1 from users where email=?').get(e)) return s.json({ ok: true }); // no account enumeration
  const prev = db.prepare('select exp from otps where email=?').get(e);
  if (prev && prev.exp - 9 * 60e3 > Date.now()) return s.json({ ok: true }); // 1 code per minute
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare('insert into otps(email,code_hash,pw,exp,tries) values(?,?,?,?,0) on conflict(email) do update set code_hash=excluded.code_hash,pw=excluded.pw,exp=excluded.exp,tries=0')
    .run(e, hashOtp(e, code), bcrypt.hashSync(password, 12), Date.now() + 10 * 60e3);
  await send(e, `${getS().brand} verification code`, `Your code is ${code}. It expires in 10 minutes.`);
  s.json({ ok: true });
}));

app.post('/auth/email/verify', lim(20), wrap(async (q, s) => {
  const { email, code } = q.body || {};
  const e = String(email || '').toLowerCase();
  const o = db.prepare('select * from otps where email=?').get(e);
  if (!o || o.exp < Date.now() || o.tries >= 5) return s.status(400).json({ error: 'Code expired. Request a new one.' });
  if (!safeEq(o.code_hash, hashOtp(e, String(code || '')))) {
    db.prepare('update otps set tries=tries+1 where email=?').run(e);
    return s.status(400).json({ error: 'That code is wrong.' });
  }
  db.prepare('delete from otps where email=?').run(e);
  const r = db.prepare('insert into users(email,pw,via,created_at) values(?,?,?,?)').run(e, o.pw, 'email', Date.now());
  const u = db.prepare('select * from users where id=?').get(r.lastInsertRowid);
  s.json({ token: sign(u), user: publicUser(u) });
}));

app.post('/auth/login', lim(20), wrap(async (q, s) => {
  const { email, password } = q.body || {};
  const u = db.prepare('select * from users where email=?').get(String(email || '').toLowerCase());
  if (!u || !u.pw || !bcrypt.compareSync(String(password || ''), u.pw)) return s.status(401).json({ error: 'Wrong email or password.' });
  s.json({ token: sign(u), user: publicUser(u) });
}));

// ----- Google sign-in (app sends the Google ID token) -----
const g = new OAuth2Client();
app.post('/auth/google', lim(20), wrap(async (q, s) => {
  const ticket = await g.verifyIdToken({ idToken: String(q.body?.idToken || ''), audience: (E.GOOGLE_CLIENT_IDS || '').split(',') });
  const p = ticket.getPayload();
  if (!p.email || !p.email_verified) return s.status(400).json({ error: 'Google email is not verified.' });
  const e = p.email.toLowerCase();
  let u = db.prepare('select * from users where email=?').get(e);
  if (!u) {
    const r = db.prepare('insert into users(email,via,created_at) values(?,?,?)').run(e, 'google', Date.now());
    u = db.prepare('select * from users where id=?').get(r.lastInsertRowid);
  }
  s.json({ token: sign(u), user: publicUser(u) });
}));

app.get('/me', auth, (q, s) => s.json(publicUser(q.user)));

app.delete('/me', auth, wrap(async (q, s) => { // required by App Store rules
  await deprovision(q.user);
  db.prepare('delete from users where id=?').run(q.user.id);
  s.json({ ok: true });
}));

// ----- store billing webhook (RevenueCat). app_user_id must equal our user id. -----
app.post('/billing/webhook', wrap(async (q, s) => {
  if (!E.RC_WEBHOOK_AUTH || !safeEq(q.get('authorization') || '', E.RC_WEBHOOK_AUTH)) return s.sendStatus(401);
  const ev = q.body?.event || {};
  const u = db.prepare('select * from users where id=?').get(+ev.app_user_id);
  if (!u) return s.sendStatus(200);
  const exp = +ev.expiration_at_ms || 0;
  if (['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'].includes(ev.type)) {
    db.prepare('update users set sub_status=?, expires_at=? where id=?').run(ev.period_type === 'TRIAL' ? 'trial' : 'active', exp, u.id);
    await provision(db.prepare('select * from users where id=?').get(u.id)); // non-2xx makes RevenueCat retry
  } else if (ev.type === 'EXPIRATION') {
    db.prepare("update users set sub_status='expired', expires_at=? where id=?").run(exp, u.id);
    await deprovision(u);
  } // CANCELLATION and BILLING_ISSUE: access continues until expires_at
  s.sendStatus(200);
}));

// ----- VPN data (only for entitled users) -----
app.get('/vpn/servers', auth, wrap(async (q, s) => {
  if (!entitled(q.user)) return s.status(402).json({ error: 'Subscription required.' });
  s.json(await rp('/vpn/servers'));
}));
app.get('/vpn/config', auth, lim(60), wrap(async (q, s) => {
  if (!entitled(q.user) || !q.user.rp_service_id) return s.status(402).json({ error: 'Subscription required.' });
  const qs = new URLSearchParams({ service_id: q.user.rp_service_id }); // ASSUMPTION: confirm param names
  for (const k of ['server', 'protocol', 'port_id']) if (q.query[k]) qs.set(k, String(q.query[k]));
  s.json(await rp('/vpn/config?' + qs));
}));

// ----- tickets: stored, then forwarded to your email -----
app.post('/tickets', auth, lim(10, 60), wrap(async (q, s) => {
  const { cat = 'Other', subject, message } = q.body || {};
  if (!subject || !message || subject.length > 150 || message.length > 5000) return s.status(400).json({ error: 'Add a subject and a message.' });
  const r = db.prepare('insert into tickets(user_id,email,cat,subject,msg,created_at) values(?,?,?,?,?,?)')
    .run(q.user.id, q.user.email, String(cat).slice(0, 40), subject, message, Date.now());
  try {
    await send(E.TICKET_EMAIL || getS().support_email, `[Ticket #${r.lastInsertRowid}] ${subject}`,
      `From: ${q.user.email}\nTopic: ${cat}\nStatus: ${q.user.sub_status}\n\n${message}`, q.user.email);
    db.prepare('update tickets set emailed=1 where id=?').run(r.lastInsertRowid);
  } catch (e) { console.error('ticket mail failed', e.message); } // stays queued; admin can retry
  s.status(202).json({ id: r.lastInsertRowid });
}));

// ---------- admin API ----------
const admLogin = lim(10);
app.post('/admin/login', admLogin, wrap(async (q, s) => {
  const a = db.prepare('select * from admin').get();
  const ok = q.body?.user === a.user && bcrypt.compareSync(String(q.body?.password || ''), a.pw);
  if (!ok) return s.status(401).json({ error: 'Wrong username or password.' });
  s.json({ token: jwt.sign({ adm: 1 }, E.ADMIN_JWT_SECRET, { expiresIn: '8h' }), mustChange: !!a.must_change });
}));
const adm = (allowMust) => (q, s, n) => {
  try {
    jwt.verify((q.get('authorization') || '').replace(/^Bearer /, ''), E.ADMIN_JWT_SECRET);
    if (!allowMust && db.prepare('select must_change from admin').get().must_change) return s.status(403).json({ error: 'Change the default credentials first.' });
    n();
  } catch { s.status(401).json({ error: 'Admin sign-in required.' }); }
};
app.put('/admin/credentials', adm(true), wrap(async (q, s) => {
  const { user, password } = q.body || {};
  if (!user || user.length > 60 || typeof password !== 'string' || password.length < 10 || password === 'ChangeMe!2026')
    return s.status(400).json({ error: 'Use a username and a new password of 10+ characters.' });
  db.prepare('update admin set user=?, pw=?, must_change=0 where id=1').run(user, bcrypt.hashSync(password, 12));
  s.json({ ok: true });
}));
app.get('/admin/settings', adm(false), (_q, s) => s.json(getS()));
app.put('/admin/settings', adm(false), (q, s) => {
  const b = q.body || {}, allowed = ['brand', 'accent', 'logo', 'trial_days', 'price', 'whatsapp', 'support_email'];
  if (b.accent && !/^#[0-9a-f]{6}$/i.test(b.accent)) return s.status(400).json({ error: 'Accent must be a hex color.' });
  if (b.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo) || (b.logo || '').length > 700000) return s.status(400).json({ error: 'Logo must be a PNG, JPEG or WebP under 500 KB.' });
  for (const k of allowed) if (k in b) setS(k, String(b[k]).slice(0, 700000));
  s.json(getS());
});
app.get('/admin/users', adm(false), (_q, s) => s.json(db.prepare('select id,email,via,sub_status,expires_at,created_at from users order by id desc limit 500').all()));
app.get('/admin/tickets', adm(false), (_q, s) => s.json(db.prepare('select * from tickets order by id desc limit 500').all()));
app.post('/admin/tickets/:id/resend', adm(false), wrap(async (q, s) => {
  const t = db.prepare('select * from tickets where id=?').get(+q.params.id);
  if (!t) return s.sendStatus(404);
  await send(E.TICKET_EMAIL || getS().support_email, `[Ticket #${t.id}] ${t.subject}`, `From: ${t.email}\nTopic: ${t.cat}\n\n${t.msg}`, t.email);
  db.prepare('update tickets set emailed=1 where id=?').run(t.id);
  s.json({ ok: true });
}));

app.listen(+(E.PORT || 3000), () => console.log('API listening'));
