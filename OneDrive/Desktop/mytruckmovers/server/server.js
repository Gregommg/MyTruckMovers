require('dotenv').config();
require('express-async-errors');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');
const db = require('./db');
const { TRUCK_TYPES, haversine, quote } = require('./pricing');
const { getRoute } = require('./route');
const mpesa = require('./mpesa');
const { sendMail } = require('./mailer');
const crypto2 = require('crypto');

const PORT = +process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const NEARBY_KM = +process.env.NEARBY_KM || 10;
const RETRY_MS = (+process.env.RETRY_MINUTES || 10) * 60 * 1000;
const MAX_RETRIES = +process.env.MAX_RETRIES || 5;
const REQUIRE_APPROVAL = process.env.REQUIRE_APPROVAL === 'true';
// Private (never served statically). Configurable so it can point at a mounted
// persistent volume in production.
const UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

/* ------------------------------ helpers ------------------------------ */
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isPt = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });
const getReq = (id) => db.prepare('SELECT * FROM requests WHERE id=?').get(id);
const getDriver = (id) => db.prepare('SELECT * FROM drivers WHERE user_id=?').get(id);
const ACTIVE = "('pending','accepted','picked_up')";

async function driverInfo(id) {
  return db.prepare(`SELECT u.id, u.name, u.phone, d.truck_reg, d.truck_type, d.lat, d.lng
    FROM users u JOIN drivers d ON d.user_id=u.id WHERE u.id=?`).get(id);
}

// What each side may see. Name + phone are revealed only after acceptance.
async function view(r, role) {
  const out = { ...r };
  delete out.mpesa_checkout_id; delete out.mpesa_merchant_id; // internal correlation ids only
  const revealed = ['accepted', 'picked_up', 'completed'].includes(r.status);
  if (role === 'user') {
    delete out.driver_id;
    if (revealed && r.driver_id) out.driver = await driverInfo(r.driver_id);
  } else {
    delete out.user_id;
    if (revealed) out.user = await db.prepare('SELECT name, phone FROM users WHERE id=?').get(r.user_id);
  }
  return out;
}

async function offersFor(r) {
  return (await db.prepare(`SELECT o.id AS offer_id, o.driver_id, d.truck_type, d.truck_reg, d.lat, d.lng
    FROM offers o JOIN drivers d ON d.user_id=o.driver_id
    WHERE o.request_id=? AND o.status='pending'`).all(r.id)).map((o) => ({
    ...o,
    distance_km: o.lat == null ? null : Math.round(haversine(o.lat, o.lng, r.pickup_lat, r.pickup_lng) * 10) / 10,
  }));
}

async function pushRequest(id) {
  const r = await getReq(id);
  if (!r) return;
  io.to('u:' + r.user_id).emit('request:updated', {
    request: await view(r, 'user'), offers: r.status === 'pending' ? await offersFor(r) : [],
  });
  if (r.driver_id) io.to('u:' + r.driver_id).emit('request:updated', { request: await view(r, 'driver') });
}

// Notify every online driver with a matching truck type. Only nearby ones get notify:true.
async function broadcastNew(r) {
  const radius = NEARBY_KM * (1 + r.retries); // widen the net on each retry
  const drivers = await db.prepare(`SELECT user_id, lat, lng FROM drivers
    WHERE verified=1 AND availability IN ('empty','dropping_off') AND truck_type=?`).all(r.truck_type);
  for (const d of drivers) {
    const km = d.lat == null ? null : haversine(d.lat, d.lng, r.pickup_lat, r.pickup_lng);
    io.to('u:' + d.user_id).emit('request:new', {
      request: driverRequestView(r, km),
      notify: km != null && km <= radius,
    });
  }
}

function driverRequestView(r, km) {
  return {
    id: r.id, truck_type: r.truck_type, item: r.item, price: r.price, distance_km: r.distance_km,
    pickup_lat: r.pickup_lat, pickup_lng: r.pickup_lng, pickup_addr: r.pickup_addr,
    dest_lat: r.dest_lat, dest_lng: r.dest_lng, dest_addr: r.dest_addr, status: r.status,
    away_km: km == null ? null : Math.round(km * 10) / 10,
    nearby: km != null && km <= NEARBY_KM, applied: false,
  };
}

// Atomically hand a pending request to a driver
const assign = (reqId, driverId) => db.transaction(async (tx) => {
  const ok = await tx.prepare("UPDATE requests SET driver_id=?, status='accepted' WHERE id=? AND status='pending'").run(driverId, reqId);
  if (!ok.changes) return false;
  await tx.prepare("UPDATE drivers SET availability='busy' WHERE user_id=?").run(driverId);
  await tx.prepare("UPDATE offers SET status=CASE WHEN driver_id=? THEN 'accepted' ELSE 'rejected' END WHERE request_id=?").run(driverId, reqId);
  return true;
});

/* -------------------------------- auth -------------------------------- */
function auth(role) {
  return async (req, res, next) => {
    try {
      const token = (req.get('authorization') || '').replace('Bearer ', '');
      const { id } = jwt.verify(token, SECRET);
      const user = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!user) return bad(res, 'Account not found', 401);
      if (role && user.role !== role) return bad(res, `Only ${role}s can do this`, 403);
      req.user = user;
      next();
    } catch {
      bad(res, 'Please log in again', 401);
    }
  };
}
const sign = (u) => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '30d' });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname || '').toLowerCase()),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.fieldname === 'truckPhoto'
      ? file.mimetype.startsWith('image/')
      : file.mimetype === 'application/pdf';
    ok ? cb(null, true) : cb(new Error(`Wrong file type for ${file.fieldname} (${file.fieldname === 'truckPhoto' ? 'image' : 'PDF'} required)`));
  },
});
const docs = upload.fields([
  { name: 'idPdf', maxCount: 1 }, { name: 'passportPdf', maxCount: 1 }, { name: 'truckPhoto', maxCount: 1 },
]);
const cleanup = (files) => Object.values(files || {}).flat().forEach((f) => fs.unlink(f.path, () => {}));

app.post('/api/register',
  (req, res, next) => docs(req, res, (err) => (err ? bad(res, err.message) : next())),
  async (req, res) => {
    const { name, email, phone, password, role, truckReg, truckType } = req.body;
    const fail = (m) => { cleanup(req.files); return bad(res, m); };
    if (!name || name.trim().length < 2) return fail('Enter your full name');
    if (!/^\S+@\S+\.\S+$/.test(email || '')) return fail('Enter a valid email');
    if (!/^\+?[0-9]{9,15}$/.test((phone || '').replace(/[\s-]/g, ''))) return fail('Enter a valid phone number');
    if (!password || password.length < 6) return fail('Password must be at least 6 characters');
    if (!['user', 'driver'].includes(role)) return fail('Choose a role');
    if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) return fail('Email already registered');

    let f = {};
    if (role === 'driver') {
      f = Object.fromEntries(Object.entries(req.files || {}).map(([k, v]) => [k, v[0].filename]));
      if (!truckReg || truckReg.trim().length < 3) return fail('Truck registration number is required');
      if (!TRUCK_TYPES.find((t) => t.id === truckType)) return fail('Choose your truck type');
      if (!f.idPdf) return fail('ID (PDF) is required');
      if (!f.passportPdf) return fail('Passport photo (PDF) is required');
      if (!f.truckPhoto) return fail('Clear front photo of the truck with plate number is required');
    } else cleanup(req.files);

    const hash = bcrypt.hashSync(password, 10);
    const id = await db.transaction(async (tx) => {
      const { lastInsertRowid: id } = await tx.prepare('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)')
        .run(name.trim(), email.toLowerCase(), phone.replace(/[\s-]/g, ''), hash, role);
      if (role === 'driver') {
        await tx.prepare('INSERT INTO drivers(user_id,truck_reg,truck_type,id_pdf,passport_pdf,truck_photo,verified) VALUES(?,?,?,?,?,?,?)')
          .run(id, truckReg.trim().toUpperCase(), truckType, f.idPdf, f.passportPdf, f.truckPhoto, REQUIRE_APPROVAL ? 0 : 1);
      }
      return id;
    });
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
    res.json({ token: sign(user), user: publicUser(user) });
  });

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const u = await db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return bad(res, 'Wrong email or password', 401);
  res.json({ token: sign(u), user: publicUser(u) });
});

app.get('/api/me', auth(), async (req, res) => {
  const out = { user: publicUser(req.user) };
  if (req.user.role === 'driver') {
    const d = await getDriver(req.user.id);
    out.driver = { truck_reg: d.truck_reg, truck_type: d.truck_type, availability: d.availability, verified: !!d.verified };
  }
  res.json(out);
});

app.get('/api/config', (req, res) => res.json({ truckTypes: TRUCK_TYPES, nearbyKm: NEARBY_KM, retryMinutes: RETRY_MS / 60000, mpesaEnabled: mpesa.configured() }));

app.post('/api/account/change-password', auth(), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!bcrypt.compareSync(currentPassword || '', req.user.password_hash)) return bad(res, 'Current password is incorrect', 401);
  if (!newPassword || newPassword.length < 6) return bad(res, 'New password must be at least 6 characters');
  await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

// Forgot password: emails a 6-digit code (15 min). Response is always generic so an
// attacker can't use it to discover which emails are registered.
const forgotThrottle = new Map();
app.post('/api/auth/forgot-password', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const generic = { ok: true, message: "If that email is registered, we've sent a reset code." };
  const u = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u) {
    const last = forgotThrottle.get(email) || 0;
    if (Date.now() - last < 60000) return res.json(generic);
    forgotThrottle.set(email, Date.now());
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const hash = crypto2.createHash('sha256').update(code).digest('hex');
    await db.prepare('UPDATE users SET reset_code_hash=?, reset_expires=? WHERE id=?').run(hash, Date.now() + 15 * 60 * 1000, u.id);
    sendMail({ to: u.email, subject: 'Your MyTruckMovers password reset code',
      text: `Your password reset code is ${code}. It expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.` }).catch(() => {});
  }
  res.json(generic);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return bad(res, 'Password must be at least 6 characters');
  const u = await db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase().trim());
  if (!u || !u.reset_code_hash || !u.reset_expires || Date.now() > u.reset_expires) return bad(res, 'That code is invalid or has expired', 400);
  const hash = crypto2.createHash('sha256').update(String(code || '')).digest('hex');
  if (hash !== u.reset_code_hash) return bad(res, 'That code is invalid or has expired', 400);
  await db.prepare('UPDATE users SET password_hash=?, reset_code_hash=NULL, reset_expires=NULL WHERE id=?').run(bcrypt.hashSync(newPassword, 10), u.id);
  res.json({ ok: true });
});

app.post('/api/quote', auth(), (req, res) => {
  const { truckType, pickup, dest } = req.body;
  if (!TRUCK_TYPES.find((t) => t.id === truckType) || !isPt(pickup) || !isPt(dest)) return bad(res, 'Invalid quote request');
  res.json(quote(truckType, pickup.lat, pickup.lng, dest.lat, dest.lng));
});

// Driving route + time remaining between two points (used by both apps)
app.get('/api/route', auth(), async (req, res) => {
  const [aLat, aLng] = String(req.query.from || '').split(',').map(Number);
  const [bLat, bLng] = String(req.query.to || '').split(',').map(Number);
  const a = { lat: aLat, lng: aLng }, b = { lat: bLat, lng: bLng };
  if (!isPt(a) || !isPt(b)) return bad(res, 'from and to must be "lat,lng"');
  res.json(await getRoute(a, b));
});

/* ------------------------------ customers ------------------------------ */
// Trucks around (no personal info)
app.get('/api/trucks/nearby', auth(), async (req, res) => {
  const lat = +req.query.lat, lng = +req.query.lng, type = req.query.type;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad(res, 'lat/lng required');
  const rows = await db.prepare(`SELECT user_id AS id, truck_type, availability, lat, lng FROM drivers
    WHERE verified=1 AND availability IN ('empty','dropping_off') AND lat IS NOT NULL`).all();
  res.json(rows.filter((d) => (!type || d.truck_type === type) && haversine(lat, lng, d.lat, d.lng) <= 30));
});

app.post('/api/requests', auth('user'), async (req, res) => {
  const { truckType, item, pickup, dest } = req.body;
  if (!TRUCK_TYPES.find((t) => t.id === truckType)) return bad(res, 'Choose a truck type');
  if (!isPt(pickup)) return bad(res, 'Set the pickup location');
  if (!isPt(dest)) return bad(res, 'Pin the destination on the map');
  if (await db.prepare(`SELECT 1 FROM requests WHERE user_id=? AND status IN ${ACTIVE}`).get(req.user.id))
    return bad(res, 'You already have an active request', 409);
  const q = quote(truckType, pickup.lat, pickup.lng, dest.lat, dest.lng);
  const { lastInsertRowid } = await db.prepare(`INSERT INTO requests
    (user_id,truck_type,item,pickup_lat,pickup_lng,pickup_addr,dest_lat,dest_lng,dest_addr,distance_km,price,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, truckType, (item || '').slice(0, 300),
    pickup.lat, pickup.lng, (pickup.addr || '').slice(0, 200), dest.lat, dest.lng, (dest.addr || '').slice(0, 200),
    q.distanceKm, q.price, Date.now() + RETRY_MS);
  const r = await getReq(lastInsertRowid);
  await broadcastNew(r);
  res.json({ request: await view(r, 'user'), offers: [] });
});

// Latest request for the user (any status) / the driver's current job
app.get('/api/requests/active', auth(), async (req, res) => {
  if (req.user.role === 'user') {
    const r = await db.prepare('SELECT * FROM requests WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (!r) return res.json({ request: null });
    return res.json({ request: await view(r, 'user'), offers: r.status === 'pending' ? await offersFor(r) : [] });
  }
  const r = await db.prepare("SELECT * FROM requests WHERE driver_id=? AND status IN ('accepted','picked_up') ORDER BY id DESC LIMIT 1").get(req.user.id);
  res.json({ request: r ? await view(r, 'driver') : null });
});

// Trip history: customer's requests or driver's jobs
app.get('/api/requests/history', auth(), async (req, res) => {
  const isUser = req.user.role === 'user';
  const rows = await db.prepare(`SELECT * FROM requests WHERE ${isUser ? 'user_id' : 'driver_id'}=? ORDER BY id DESC LIMIT 50`).all(req.user.id);
  res.json(await Promise.all(rows.map((r) => view(r, req.user.role))));
});

/* ------------------------------ payments (M-Pesa) ------------------------------ */
// Customer pays for a request. Works while it's open, and after it's completed.
app.post('/api/requests/:id/pay', auth('user'), async (req, res) => {
  const r = await getReq(req.params.id);
  if (!r || r.user_id !== req.user.id) return bad(res, 'Request not found', 404);
  if (r.payment_status === 'paid') return bad(res, 'This trip is already paid for', 409);
  if (!mpesa.configured()) return bad(res, 'M-Pesa payment is not set up on this server yet', 503);
  try {
    const phone = req.body.phone || req.user.phone;
    const out = await mpesa.stkPush({ phone, amount: r.price, accountRef: `TM${r.id}`, desc: 'MyTruckMovers trip' });
    await db.prepare(`UPDATE requests SET payment_status='pending', payment_method='mpesa',
      mpesa_checkout_id=?, mpesa_merchant_id=?, mpesa_phone=? WHERE id=?`).run(out.checkoutRequestId, out.merchantRequestId, out.phone, r.id);
    io.to('u:' + r.user_id).emit('payment:updated', { requestId: r.id, status: 'pending' });
    res.json({ ok: true, message: out.customerMessage || 'Enter your M-Pesa PIN on your phone to complete payment.' });
  } catch (e) { bad(res, e.message); }
});

// Fallback for when the STK callback is delayed or was missed (common on sandbox/NAT setups).
app.post('/api/requests/:id/pay/check', auth('user'), async (req, res) => {
  const r = await getReq(req.params.id);
  if (!r || r.user_id !== req.user.id) return bad(res, 'Request not found', 404);
  if (!r.mpesa_checkout_id || r.payment_status !== 'pending') return res.json({ status: r.payment_status });
  try {
    const j = await mpesa.stkQuery(r.mpesa_checkout_id);
    if (j.ResultCode === '0' || j.ResultCode === 0) {
      await db.prepare("UPDATE requests SET payment_status='paid', paid_at=datetime('now') WHERE id=?").run(r.id);
    } else if (j.ResultCode != null) {
      await db.prepare("UPDATE requests SET payment_status='failed' WHERE id=?").run(r.id);
    } // else: still pending, leave as-is
    const fresh = await getReq(r.id);
    io.to('u:' + r.user_id).emit('payment:updated', { requestId: r.id, status: fresh.payment_status, receipt: fresh.mpesa_receipt });
    res.json({ status: fresh.payment_status });
  } catch (e) { bad(res, e.message); }
});

app.get('/api/requests/:id/payment', auth('user'), async (req, res) => {
  const r = await getReq(req.params.id);
  if (!r || r.user_id !== req.user.id) return bad(res, 'Request not found', 404);
  res.json({ status: r.payment_status, receipt: r.mpesa_receipt, paidAt: r.paid_at });
});

// Safaricom's webhook. The random path segment stands in for a shared secret since
// Daraja can't send custom auth headers; keep MPESA_CALLBACK_SECRET private.
app.post('/api/payments/callback/:secret', async (req, res) => {
  if (req.params.secret !== (process.env.MPESA_CALLBACK_SECRET || '')) return res.status(404).json({});
  const cb = req.body && req.body.Body && req.body.Body.stkCallback;
  if (!cb) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const r = await db.prepare('SELECT * FROM requests WHERE mpesa_checkout_id=?').get(cb.CheckoutRequestID);
  if (r) {
    if (cb.ResultCode === 0) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
      const get = (name) => { const it = items.find((i) => i.Name === name); return it ? it.Value : null; };
      await db.prepare("UPDATE requests SET payment_status='paid', mpesa_receipt=?, paid_at=datetime('now') WHERE id=?")
        .run(get('MpesaReceiptNumber'), r.id);
    } else {
      await db.prepare("UPDATE requests SET payment_status='failed' WHERE id=?").run(r.id);
    }
    const fresh = await getReq(r.id);
    io.to('u:' + r.user_id).emit('payment:updated', { requestId: r.id, status: fresh.payment_status, receipt: fresh.mpesa_receipt });
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.post('/api/requests/:id/offers/:offerId/accept', auth('user'), async (req, res) => {
  const r = await getReq(req.params.id);
  if (!r || r.user_id !== req.user.id) return bad(res, 'Request not found', 404);
  if (r.status !== 'pending') return bad(res, 'This request is no longer open', 409);
  const offer = await db.prepare("SELECT * FROM offers WHERE id=? AND request_id=? AND status='pending'").get(req.params.offerId, r.id);
  if (!offer) return bad(res, 'Offer not found', 404);
  const d = await getDriver(offer.driver_id);
  if (!d || !['empty', 'dropping_off'].includes(d.availability)) return bad(res, 'That driver is no longer available', 409);
  if (!await assign(r.id, offer.driver_id)) return bad(res, 'This request is no longer open', 409);
  io.to('drivers').emit('request:removed', { id: r.id });
  await pushRequest(r.id);
  res.json({ ok: true });
});

// The customer may cancel at any time; drivers may not.
app.post('/api/requests/:id/cancel', auth(), async (req, res) => {
  if (req.user.role === 'driver')
    return bad(res, 'Drivers cannot cancel an accepted job. Only the customer can cancel it.', 403);
  const r = await getReq(req.params.id);
  if (!r || r.user_id !== req.user.id) return bad(res, 'Request not found', 404);
  if (!['pending', 'accepted', 'picked_up'].includes(r.status)) return bad(res, 'Request already closed', 409);
  await db.prepare("UPDATE requests SET status='cancelled' WHERE id=?").run(r.id);
  await db.prepare("UPDATE offers SET status='rejected' WHERE request_id=? AND status='pending'").run(r.id);
  if (r.driver_id) await db.prepare("UPDATE drivers SET availability='empty' WHERE user_id=?").run(r.driver_id);
  io.to('drivers').emit('request:removed', { id: r.id });
  await pushRequest(r.id);
  res.json({ ok: true });
});

/* ------------------------------- drivers ------------------------------- */
app.post('/api/driver/availability', auth('driver'), async (req, res) => {
  const { availability } = req.body;
  const d = await getDriver(req.user.id);
  if (!['offline', 'empty', 'dropping_off'].includes(availability)) return bad(res, 'Invalid status');
  if (!d.verified) return bad(res, 'Your documents are still being verified', 403);
  if (d.availability === 'busy') return bad(res, 'Finish your current job first', 409);
  await db.prepare('UPDATE drivers SET availability=? WHERE user_id=?').run(availability, req.user.id);
  res.json({ availability });
});

async function saveLocation(driverId, lat, lng) {
  if (!isPt({ lat, lng })) return;
  await db.prepare("UPDATE drivers SET lat=?, lng=?, loc_at=datetime('now') WHERE user_id=?").run(lat, lng, driverId);
  // live location -> customer whose job this is, or customers considering this driver's application
  const job = await db.prepare("SELECT id, user_id FROM requests WHERE driver_id=? AND status IN ('accepted','picked_up')").get(driverId);
  if (job) io.to('u:' + job.user_id).emit('driver:location', { requestId: job.id, lat, lng });
  (await db.prepare(`SELECT r.user_id, r.id FROM offers o JOIN requests r ON r.id=o.request_id
    WHERE o.driver_id=? AND o.status='pending' AND r.status='pending'`).all(driverId)
  ).forEach((x) => io.to('u:' + x.user_id).emit('offer:location', { requestId: x.id, driverId, lat, lng }));
}
app.post('/api/driver/location', auth('driver'), async (req, res) => { await saveLocation(req.user.id, +req.body.lat, +req.body.lng); res.json({ ok: true }); });

// Open requests for this driver's truck type, all distances (far ones can be applied for)
app.get('/api/driver/requests', auth('driver'), async (req, res) => {
  const d = await getDriver(req.user.id);
  const rows = await db.prepare("SELECT * FROM requests WHERE status='pending' AND truck_type=? ORDER BY id DESC").all(d.truck_type);
  res.json(await Promise.all(rows.map(async (r) => {
    const km = d.lat == null ? null : haversine(d.lat, d.lng, r.pickup_lat, r.pickup_lng);
    const v = driverRequestView(r, km);
    v.applied = !!(await db.prepare('SELECT 1 FROM offers WHERE request_id=? AND driver_id=?').get(r.id, req.user.id));
    return v;
  })));
});

// Nearby -> accepted immediately. Far away -> becomes an application the customer must approve.
app.post('/api/requests/:id/accept', auth('driver'), async (req, res) => {
  const d = await getDriver(req.user.id);
  const r = await getReq(req.params.id);
  if (!r || r.status !== 'pending') return bad(res, 'This request is no longer open', 409);
  if (!['empty', 'dropping_off'].includes(d.availability)) return bad(res, 'Set yourself as Empty or Dropping off first', 409);
  if (d.truck_type !== r.truck_type) return bad(res, 'This request needs a different truck type', 403);
  if (d.lat == null) return bad(res, 'Turn on location so the customer can see where you are', 400);
  const km = haversine(d.lat, d.lng, r.pickup_lat, r.pickup_lng);
  if (km <= NEARBY_KM) {
    if (!await assign(r.id, req.user.id)) return bad(res, 'Another driver got this job first', 409);
    io.to('drivers').emit('request:removed', { id: r.id });
    await pushRequest(r.id);
    return res.json({ mode: 'accepted' });
  }
  await db.prepare('INSERT OR IGNORE INTO offers(request_id,driver_id) VALUES(?,?)').run(r.id, req.user.id);
  await pushRequest(r.id); // customer sees the new application + live location
  io.to('u:' + r.user_id).emit('offer:new', { requestId: r.id });
  res.json({ mode: 'applied' });
});

function step(from, to, after) {
  return async (req, res) => {
    const r = await getReq(req.params.id);
    if (!r || r.driver_id !== req.user.id) return bad(res, 'Job not found', 404);
    if (r.status !== from) return bad(res, `Job is ${r.status}`, 409);
    await db.prepare('UPDATE requests SET status=? WHERE id=?').run(to, r.id);
    if (after) await after(r);
    await pushRequest(r.id);
    res.json({ ok: true });
  };
}
app.post('/api/requests/:id/pickup', auth('driver'), step('accepted', 'picked_up'));
app.post('/api/requests/:id/complete', auth('driver'),
  step('picked_up', 'completed', (r) => db.prepare("UPDATE drivers SET availability='empty' WHERE user_id=?").run(r.driver_id)));

/* -------------------------------- admin -------------------------------- */
const admin = (req, res, next) =>
  process.env.ADMIN_KEY && req.get('x-admin-key') === process.env.ADMIN_KEY ? next() : bad(res, 'Unauthorized', 401);
app.get('/api/admin/drivers', admin, async (req, res) => res.json(await db.prepare(
  `SELECT u.id,u.name,u.email,u.phone,d.truck_reg,d.truck_type,d.verified,d.id_pdf,d.passport_pdf,d.truck_photo
   FROM users u JOIN drivers d ON d.user_id=u.id ORDER BY u.id DESC`).all()));
app.post('/api/admin/drivers/:id/approve', admin, async (req, res) => {
  await db.prepare('UPDATE drivers SET verified=1 WHERE user_id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/files/:name', admin, (req, res) => res.sendFile(path.join(UPLOADS, path.basename(req.params.name))));

/* ------------------------------- realtime ------------------------------- */
io.use(async (socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth.token, SECRET);
    socket.user = await db.prepare('SELECT id, role FROM users WHERE id=?').get(id);
    socket.user ? next() : next(new Error('unauthorized'));
  } catch { next(new Error('unauthorized')); }
});
io.on('connection', (socket) => {
  socket.join('u:' + socket.user.id);
  if (socket.user.role === 'driver') {
    socket.join('drivers');
    socket.on('driver:location', ({ lat, lng }) => saveLocation(socket.user.id, +lat, +lng).catch(console.error));
  }
});

/* -------------------------- retry unaccepted requests -------------------------- */
setInterval(async () => {
  try {
    const now = Date.now();
    const expired = await db.prepare("SELECT * FROM requests WHERE status='pending' AND expires_at<=?").all(now);
    for (const r of expired) {
      if (r.retries >= MAX_RETRIES) {
        await db.prepare("UPDATE requests SET status='expired' WHERE id=?").run(r.id);
        await db.prepare("UPDATE offers SET status='rejected' WHERE request_id=? AND status='pending'").run(r.id);
        io.to('drivers').emit('request:removed', { id: r.id });
      } else {
        await db.prepare('UPDATE requests SET retries=retries+1, expires_at=? WHERE id=?').run(now + RETRY_MS, r.id);
        await broadcastNew(await getReq(r.id));
      }
      await pushRequest(r.id);
    }
  } catch (error) {
    console.error('Request retry failed:', error);
  }
}, 15 * 1000);

app.use((err, req, res, next) => { console.error(err); bad(res, 'Server error', 500); });
db.init().then(() => {
  server.listen(PORT, () => console.log(`MyTruckMovers running on http://localhost:${PORT}`));
}).catch((error) => {
  console.error('Could not connect to PostgreSQL or initialize the schema:', error);
  process.exit(1);
});
