/* MyTruckMovers web app: landing home page, auth, customer + driver apps. Same-origin API. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'KES ' + Number(n).toLocaleString();
const NAIROBI = [-1.2864, 36.8172];

let token = localStorage.getItem('tm_token');
let me = null, driverInfo = null, cfg = null, socket = null, APP = null; // APP: 'user' | 'driver'
const typeLabel = (id) => (cfg.truckTypes.find((t) => t.id === id) || {}).label || id;

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch('/api' + path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}
const SCREENS = ['landing', 'auth', 'userApp', 'driverApp'];
const show = (id) => SCREENS.forEach((x) => $('#' + x).classList.toggle('hidden', x !== id));

/* ------------------------------ formatting ------------------------------ */
const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
function fmtMin(sec) {
  const m = Math.max(1, Math.ceil(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function distM(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const parseDate = (s) => new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/* ------------------------------ map helpers ------------------------------ */
function makeMap(el) {
  const m = L.map(el).setView(NAIROBI, 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  return m;
}
const pinIcon = (name, kind) => L.divIcon({ html: `<div class="mk ${kind}">${ic(name)}</div>`, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });

class Markers {
  constructor(map) { this.map = map; this.m = {}; }
  set(key, lat, lng, name, kind, popup) {
    if (this.m[key]) { this.m[key].setLatLng([lat, lng]); if (popup) this.m[key].setPopupContent(popup); return; }
    this.m[key] = L.marker([lat, lng], { icon: pinIcon(name, kind) }).addTo(this.map);
    if (popup) this.m[key].bindPopup(popup);
  }
  remove(key) { if (this.m[key]) { this.map.removeLayer(this.m[key]); delete this.m[key]; } }
  removePrefix(p) { Object.keys(this.m).filter((k) => k.startsWith(p)).forEach((k) => this.remove(k)); }
}

async function reverse(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    return (await r.json()).display_name || '';
  } catch { return ''; }
}

/* Route drawn on the map + banner with instruction and time remaining */
class Router {
  constructor(map, el, describe) {
    Object.assign(this, { map, el, describe, line: null, route: null, fetchedAt: 0, origin: null, target: null, label: '', pending: false, queued: null, seq: 0 });
  }
  async update(from, to, label) {
    if (!from || !to) return this.clear();
    const same = this.target && this.label === label && this.target.lat === to.lat && this.target.lng === to.lng;
    const moved = !this.origin || distM(this.origin, from) > 75;
    if (same && !moved && Date.now() - this.fetchedAt < 30000) return;
    if (this.pending) { this.queued = [from, to, label]; return; }
    this.pending = true;
    const seq = this.seq;
    try {
      const rt = await api(`/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`);
      if (seq !== this.seq) return; // cleared while loading
      this.route = rt; this.fetchedAt = Date.now(); this.origin = { lat: from.lat, lng: from.lng }; this.label = label;
      this.target = { lat: to.lat, lng: to.lng };
      if (this.line) this.map.removeLayer(this.line);
      this.line = L.polyline(rt.coords, { color: '#ff7a00', weight: 6, opacity: 0.9 }).addTo(this.map);
      if (!same) this.needsFit = true;
      this.tryFit();
      this.render();
    } catch { /* keep the previous route */ } finally {
      this.pending = false;
      if (this.queued) { const q = this.queued; this.queued = null; this.update(...q); }
    }
  }
  tryFit() { // only fit while the map is visible (a hidden map has zero size)
    if (this.needsFit && this.line && this.map.getSize().x > 0) {
      this.map.fitBounds(this.line.getBounds(), { paddingTopLeft: [60, 120], paddingBottomRight: [60, 60], maxZoom: 16 });
      this.needsFit = false;
    }
  }
  remaining() { return this.route ? Math.max(0, this.route.duration - (Date.now() - this.fetchedAt) / 1000) : 0; }
  render() {
    if (!this.route) return this.el.classList.add('hidden');
    const d = this.describe(this.route, this.label);
    const sec = this.remaining();
    this.el.classList.remove('hidden');
    this.el.innerHTML = `<div class="turn">${ic(d.icon)}</div>
      <div class="instr"><b>${esc(d.title)}</b><span>${esc(d.sub)}</span></div>
      <div class="time"><b>${fmtMin(sec)}</b><span>${fmtDist(this.route.distance)} · arrive ${clock(Date.now() + sec * 1000)}${this.route.source === 'estimate' ? ' (est.)' : ''}</span></div>`;
  }
  clear() {
    this.seq++; this.queued = null;
    if (this.line) this.map.removeLayer(this.line);
    Object.assign(this, { line: null, route: null, origin: null, target: null });
    this.el.classList.add('hidden');
  }
}

/* ------------------------- home page + auth screens ------------------------- */
let mode = 'login';
function setMode(m) {
  mode = m;
  $('#authForm').classList.remove('hidden');
  $('#forgotPanel').classList.add('hidden');
  $('#tabLogin').classList.toggle('active', m === 'login');
  $('#tabRegister').classList.toggle('active', m === 'register');
  $('#regFields').classList.toggle('hidden', m === 'login');
  $('#driverFields').classList.toggle('hidden', !(m === 'register' && $('#role').value === 'driver'));
  $('#authSubmit').textContent = m === 'login' ? 'Log in' : 'Create account';
  $('#authError').textContent = '';
  $('#forgotLink').classList.toggle('hidden', m !== 'login');
}
$('#tabLogin').onclick = () => setMode('login');
$('#tabRegister').onclick = () => setMode('register');
$('#role').onchange = () => setMode('register');
$('#backHome').onclick = () => show('landing');
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => {
  const g = b.dataset.go;
  show('auth');
  if (g === 'login') setMode('login');
  else { $('#role').value = g === 'register-driver' ? 'driver' : 'user'; setMode('register'); }
}));

/* forgot / reset password */
function openForgot() {
  $('#authForm').classList.add('hidden');
  $('#forgotPanel').classList.remove('hidden');
  $('#forgotStep1').classList.remove('hidden');
  $('#forgotStep2').classList.add('hidden');
  $('#forgotEmail').value = $('#email').value || '';
  $('#forgotError1').textContent = ''; $('#forgotError2').textContent = '';
}
$('#forgotLink').onclick = openForgot;
$('#forgotBack').onclick = () => setMode('login');
$('#forgotSend').onclick = async () => {
  const email = $('#forgotEmail').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('#forgotError1').textContent = 'Enter a valid email'; return; }
  $('#forgotSend').disabled = true;
  try {
    const r = await api('/auth/forgot-password', { method: 'POST', body: { email } });
    toast(r.message || "If that email is registered, we've sent a reset code.");
    $('#forgotStep1').classList.add('hidden');
    $('#forgotStep2').classList.remove('hidden');
  } catch (e) { $('#forgotError1').textContent = e.message; }
  $('#forgotSend').disabled = false;
};
$('#resetSubmit').onclick = async () => {
  const email = $('#forgotEmail').value.trim(), code = $('#resetCode').value.trim(), newPassword = $('#resetPassword').value;
  $('#forgotError2').textContent = '';
  if (!/^\d{6}$/.test(code)) { $('#forgotError2').textContent = 'Enter the 6-digit code from your email'; return; }
  if (newPassword.length < 6) { $('#forgotError2').textContent = 'Password must be at least 6 characters'; return; }
  $('#resetSubmit').disabled = true;
  try {
    await api('/auth/reset-password', { method: 'POST', body: { email, code, newPassword } });
    toast('Password reset. You can log in now.');
    setMode('login');
    $('#email').value = email;
    $('#password').value = '';
  } catch (e) { $('#forgotError2').textContent = e.message; }
  $('#resetSubmit').disabled = false;
};

/* change password (used on both the customer and driver Home pages) */
function bindChangePassword(prefix) {
  const toggle = $(`#${prefix}PwToggle`), form = $(`#${prefix}PwForm`);
  toggle.onclick = () => form.classList.toggle('hidden');
  $(`#${prefix}PwSubmit`).onclick = async () => {
    const currentPassword = $(`#${prefix}PwCurrent`).value, newPassword = $(`#${prefix}PwNew`).value;
    const errEl = $(`#${prefix}PwError`);
    errEl.textContent = '';
    if (newPassword.length < 6) { errEl.textContent = 'New password must be at least 6 characters'; return; }
    try {
      await api('/account/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      toast('Password updated.');
      $(`#${prefix}PwCurrent`).value = ''; $(`#${prefix}PwNew`).value = '';
      form.classList.add('hidden');
    } catch (e) { errEl.textContent = e.message; }
  };
}

$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#authError').textContent = '';
  $('#authSubmit').disabled = true;
  try {
    let data;
    if (mode === 'login') {
      data = await api('/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
    } else {
      const role = $('#role').value;
      const f = new FormData();
      f.append('role', role);
      ['name', 'phone', 'email', 'password'].forEach((k) => f.append(k, $('#' + k).value));
      if (role === 'driver') {
        f.append('truckType', $('#truckType').value);
        f.append('truckReg', $('#truckReg').value);
        ['idPdf', 'passportPdf', 'truckPhoto'].forEach((k) => { if ($('#' + k).files[0]) f.append(k, $('#' + k).files[0]); });
      }
      data = await api('/register', { method: 'POST', form: f });
    }
    token = data.token;
    localStorage.setItem('tm_token', token);
    boot();
  } catch (err) {
    $('#authError').textContent = err.message;
  } finally {
    $('#authSubmit').disabled = false;
  }
};
document.querySelectorAll('.logout').forEach((b) => (b.onclick = () => { localStorage.removeItem('tm_token'); location.reload(); }));

/* in-app views: Home | Map | History */
const VIEW_IDS = { Home: 'Home', Map: 'MapView', History: 'History' };
function setView(name) {
  const prefix = APP;
  Object.entries(VIEW_IDS).forEach(([n, id]) => $('#' + prefix + id).classList.toggle('hidden', n !== name));
  document.querySelectorAll(`#${prefix}App .navtab`).forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'Map') setTimeout(() => { const o = APP === 'user' ? U : D; o.map.invalidateSize(); o.router.tryFit(); }, 50);
  if (name === 'Home' || name === 'History') loadHistory();
}
function bindViewGo(root) { root.querySelectorAll('[data-view-go]').forEach((b) => (b.onclick = () => setView(b.dataset.viewGo))); }

let tripList = [];
async function loadHistory() {
  try { tripList = await api('/requests/history'); } catch { return; }
  const done = tripList.filter((h) => h.status === 'completed');
  const sum = done.reduce((t, h) => t + h.price, 0);
  const el = $(`#${APP}HistoryList`);
  el.innerHTML = tripList.length ? '' : '<p class="muted">Nothing here yet.</p>';
  tripList.forEach((h) => {
    const div = document.createElement('div');
    div.className = 'item';
    const who = APP === 'driver' && h.user ? ` · ${esc(h.user.name)}` : APP === 'user' && h.driver ? ` · ${esc(h.driver.name)}` : '';
    const pay = cfg.mpesaEnabled && h.payment_status ? `<span class="pay-status ${h.payment_status}">${ic(PAY_ICON[h.payment_status])} ${PAY_LABEL[h.payment_status]}</span>` : '';
    div.innerHTML = `<div class="row"><b>${money(h.price)}</b><span class="badge ${h.status}">${h.status.replace('_', ' ')}</span></div>
      <div>${esc(typeLabel(h.truck_type))}${who}</div><div class="muted">${esc(h.pickup_addr || 'Pinned location')} to ${esc(h.dest_addr || 'Pinned location')}</div>
      <div class="row"><span class="muted">${parseDate(h.created_at)}</span>${pay}</div>`;
    el.appendChild(div);
  });
  if (APP === 'user') { $('#uStatDone').textContent = done.length; $('#uStatSpent').textContent = money(sum); }
  else { $('#dStatDone').textContent = done.length; $('#dStatEarn').textContent = money(sum); }
}

/* -------------------------------- boot -------------------------------- */
async function boot() {
  cfg = cfg || (await api('/config'));
  const opts = cfg.truckTypes.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  $('#truckType').innerHTML = opts;
  $('#reqType').innerHTML = opts;
  if (!token) return show('landing');
  try {
    const d = await api('/me');
    me = d.user; driverInfo = d.driver;
  } catch { localStorage.removeItem('tm_token'); token = null; return show('landing'); }
  APP = me.role;
  socket = io({ auth: { token } });
  show(APP + 'App');
  document.querySelectorAll(`#${APP}App .navtab`).forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  APP === 'driver' ? initDriver() : initUser();
  bindViewGo(document);
  loadHistory();
}

/* ============================== CUSTOMER ============================== */
const U = { map: null, mk: null, router: null, pickup: null, dest: null, mode: 'dest', req: null, offers: [], truck: null, trucksNear: 0 };
const isOpen = (r) => r && ['pending', 'accepted', 'picked_up'].includes(r.status);
const STATUS_TEXT = {
  pending: 'Looking for a driver.',
  accepted: 'A driver accepted your request and is on the way to your pickup point.',
  picked_up: 'Your items are on the truck and heading to the destination.',
  completed: 'Delivered. Thank you for using MyTruckMovers!',
  cancelled: 'This request was cancelled.',
  expired: 'No driver accepted your request. You can try again.',
};

async function initUser() {
  $('#userGreeting').textContent = me.name;
  U.map = makeMap('userMap');
  U.mk = new Markers(U.map);
  U.router = new Router(U.map, $('#userNav'), (rt, label) => ({
    icon: label === 'preview' ? 'route' : 'truck',
    title: label === 'pickup' ? 'Your truck is heading to the pickup point' : label === 'dest' ? 'Your items are heading to the destination' : 'Estimated trip time',
    sub: label === 'preview' ? 'Driving time from pickup to destination' : 'Live from the truck location',
  }));
  U.map.on('click', (e) => { if (!isOpen(U.req)) setPoint(U.mode, e.latlng.lat, e.latlng.lng); });

  $('#pickPickup').onclick = () => setPinMode('pickup');
  $('#pickDest').onclick = () => setPinMode('dest');
  $('#reqType').onchange = () => { refreshQuote(); loadTrucks(); };
  $('#searchBtn').onclick = searchPlace;
  $('#searchBox').onkeydown = (e) => e.key === 'Enter' && searchPlace();
  $('#sendRequest').onclick = sendRequest;
  $('#cancelReq').onclick = cancelRequest;
  $('#newReq').onclick = () => { U.req = null; U.dest = null; U.truck = null; U.mk.remove('dest'); U.mk.remove('assigned'); $('#destText').textContent = 'Destination: not set'; $('#priceBox').classList.add('hidden'); renderUser(); };

  socket.on('request:updated', ({ request, offers }) => {
    const before = U.req && U.req.status;
    U.req = request; U.offers = offers || [];
    if (before !== request.status) {
      if (request.status === 'accepted') toast(`${request.driver ? request.driver.name : 'A driver'} accepted your request`);
      if (request.status === 'picked_up') toast('Your items have been picked up');
      if (request.status === 'completed') toast('Delivered!');
      if (request.status === 'expired') toast('No driver accepted your request', true);
      if (!isOpen(request)) loadHistory();
    }
    renderUser();
  });
  socket.on('offer:new', () => toast('A driver from farther away applied. Review it in your request.'));
  socket.on('offer:location', (d) => U.mk.set('offer:' + d.driverId, d.lat, d.lng, 'truck', 'truck', 'Applicant truck'));
  socket.on('driver:location', (d) => {
    if (U.req && U.req.id === d.requestId) {
      U.truck = { lat: d.lat, lng: d.lng };
      U.mk.set('assigned', d.lat, d.lng, 'truck', 'mine', 'Your truck');
      refreshUserRoute();
    }
  });
  socket.on('payment:updated', (d) => {
    if (U.req && U.req.id === d.requestId) {
      U.req.payment_status = d.status;
      if (d.receipt) U.req.mpesa_receipt = d.receipt;
      if (d.status === 'paid') toast('Payment received. Thank you!');
      renderPayBox(U.req);
    }
  });

  bindChangePassword('user');

  const cur = await api('/requests/active');
  U.req = cur.request; U.offers = cur.offers || [];
  renderUser();

  navigator.geolocation && navigator.geolocation.getCurrentPosition((p) => {
    U.map.setView([p.coords.latitude, p.coords.longitude], 14);
    if (!U.pickup && !isOpen(U.req)) setPoint('pickup', p.coords.latitude, p.coords.longitude);
  }, () => toast('Location is off. Tap the map to set your pickup point.'));
  setInterval(loadTrucks, 10000);
  loadTrucks();
  setInterval(tickUser, 1000);
}

function setPinMode(m) {
  U.mode = m;
  $('#pickPickup').classList.toggle('active', m === 'pickup');
  $('#pickDest').classList.toggle('active', m === 'dest');
}

async function setPoint(kind, lat, lng, addr) {
  U[kind] = { lat, lng, addr: addr || '' };
  U.mk.set(kind, lat, lng, kind === 'pickup' ? 'map-pin' : 'flag', kind, kind === 'pickup' ? 'Pickup' : 'Destination');
  const label = kind === 'pickup' ? 'Pickup' : 'Destination';
  const el = $(kind === 'pickup' ? '#pickupText' : '#destText');
  el.textContent = `${label}: ${addr || lat.toFixed(5) + ', ' + lng.toFixed(5)}`;
  if (!addr) {
    reverse(lat, lng).then((a) => { if (a && U[kind] && U[kind].lat === lat) { U[kind].addr = a; el.textContent = `${label}: ${a}`; } });
  }
  refreshQuote();
  refreshUserRoute();
  if (kind === 'pickup') loadTrucks();
}

async function searchPlace() {
  const q = $('#searchBox').value.trim();
  if (!q) return;
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`)).json();
    if (!r.length) return toast('Place not found', true);
    const { lat, lon, display_name } = r[0];
    U.map.setView([+lat, +lon], 15);
    setPoint('dest', +lat, +lon, display_name);
  } catch { toast('Search failed', true); }
}

async function refreshQuote() {
  const box = $('#priceBox');
  if (!U.pickup || !U.dest) return box.classList.add('hidden');
  try {
    const q = await api('/quote', { method: 'POST', body: { truckType: $('#reqType').value, pickup: U.pickup, dest: U.dest } });
    box.innerHTML = `${money(q.price)}<small>${q.distanceKm} km trip · ${esc(typeLabel($('#reqType').value))}</small>`;
    box.classList.remove('hidden');
  } catch { box.classList.add('hidden'); }
}

// What route (if any) to show: trip preview before requesting, truck route once a driver is assigned
function refreshUserRoute() {
  const r = U.req;
  if (r && r.status === 'accepted' && U.truck) return U.router.update(U.truck, { lat: r.pickup_lat, lng: r.pickup_lng }, 'pickup');
  if (r && r.status === 'picked_up' && U.truck) return U.router.update(U.truck, { lat: r.dest_lat, lng: r.dest_lng }, 'dest');
  if (!r && U.pickup && U.dest) return U.router.update(U.pickup, U.dest, 'preview');
  U.router.clear();
}

async function loadTrucks() {
  const c = U.pickup || (U.map && { lat: U.map.getCenter().lat, lng: U.map.getCenter().lng });
  if (!c) return;
  try {
    const trucks = await api(`/trucks/nearby?lat=${c.lat}&lng=${c.lng}`);
    U.trucksNear = trucks.length;
    $('#uStatTrucks').textContent = trucks.length;
    const seen = new Set();
    if (!U.req || U.req.status === 'pending') {
      trucks.forEach((t) => {
        seen.add('truck:' + t.id);
        U.mk.set('truck:' + t.id, t.lat, t.lng, 'truck', 'truck', `${esc(typeLabel(t.truck_type))}<br>${t.availability === 'empty' ? 'Empty' : 'Dropping off nearby'}`);
      });
    }
    Object.keys(U.mk.m).filter((k) => k.startsWith('truck:') && !seen.has(k)).forEach((k) => U.mk.remove(k));
  } catch { /* ignore */ }
}

async function sendRequest() {
  try {
    const r = await api('/requests', { method: 'POST', body: { truckType: $('#reqType').value, item: $('#reqItem').value, pickup: U.pickup, dest: U.dest } });
    U.req = r.request; U.offers = [];
    renderUser();
    toast('Request sent. Nearby drivers have been notified.');
  } catch (e) { toast(e.message, true); }
}

async function cancelRequest() {
  if (!confirm('Cancel this request?')) return;
  try { await api(`/requests/${U.req.id}/cancel`, { method: 'POST' }); } catch (e) { toast(e.message, true); }
}

function renderUser() {
  const r = U.req;
  $('#userHello').textContent = `Hello, ${me.name.split(' ')[0]}`;
  $('#requestForm').classList.toggle('hidden', !!r);
  $('#activeCard').classList.toggle('hidden', !r);
  renderUserHome();
  if (!r) { U.mk.remove('assigned'); U.mk.removePrefix('offer:'); refreshUserRoute(); return; }

  $('#statusBadge').className = 'badge ' + r.status;
  $('#statusBadge').textContent = r.status.replace('_', ' ');
  $('#reqSummary').innerHTML = `${esc(typeLabel(r.truck_type))} · <b>${money(r.price)}</b><br>${esc(r.item || 'No description')}<br>
    From: ${esc(r.pickup_addr || 'Pinned location')}<br>To: ${esc(r.dest_addr || 'Pinned location')}`;
  U.mk.set('pickup', r.pickup_lat, r.pickup_lng, 'map-pin', 'pickup', 'Pickup');
  U.mk.set('dest', r.dest_lat, r.dest_lng, 'flag', 'dest', 'Destination');

  $('#cancelReq').classList.toggle('hidden', !isOpen(r));
  $('#newReq').classList.toggle('hidden', isOpen(r));

  // applications from far-away drivers (name and phone stay hidden until you accept)
  const offersEl = $('#offers');
  offersEl.innerHTML = '';
  if (r.status === 'pending') {
    U.offers.forEach((o) => {
      const div = document.createElement('div');
      div.className = 'offer';
      div.innerHTML = `<div class="row"><span>${ic('truck')} ${esc(typeLabel(o.truck_type))}<br><small>${esc(o.truck_reg)} · ${o.distance_km ?? '?'} km from pickup</small></span>
        <button class="btn small primary">Accept</button></div>`;
      div.querySelector('button').onclick = async () => {
        try { await api(`/requests/${r.id}/offers/${o.offer_id}/accept`, { method: 'POST' }); } catch (e) { toast(e.message, true); }
      };
      offersEl.appendChild(div);
      if (o.lat != null) U.mk.set('offer:' + o.driver_id, o.lat, o.lng, 'truck', 'truck', 'Applicant truck');
    });
  } else U.mk.removePrefix('offer:');

  // accepted driver: contact + live truck
  const box = $('#driverBox');
  if (r.driver && ['accepted', 'picked_up', 'completed'].includes(r.status)) {
    box.classList.remove('hidden');
    box.innerHTML = `<b>${esc(r.driver.name)}</b><br><a href="tel:${esc(r.driver.phone)}">${ic('phone')} ${esc(r.driver.phone)}</a><br>
      ${esc(typeLabel(r.driver.truck_type))} · ${esc(r.driver.truck_reg)}`;
    if (r.driver.lat != null && r.status !== 'completed') {
      U.truck = U.truck || { lat: r.driver.lat, lng: r.driver.lng };
      U.mk.set('assigned', U.truck.lat, U.truck.lng, 'truck', 'mine', 'Your truck');
    }
    U.mk.removePrefix('truck:');
  } else { box.classList.add('hidden'); U.mk.remove('assigned'); }
  renderPayBox(r);
  refreshUserRoute();
  tickUser();
}

const PAY_LABEL = { unpaid: 'Not paid', pending: 'Payment pending', paid: 'Paid', failed: 'Payment failed' };
const PAY_ICON = { unpaid: 'credit-card', pending: 'refresh-cw', paid: 'check', failed: 'alert-circle' };
let payPoll = null;

function renderPayBox(r) {
  const el = $('#payBox');
  if (!cfg.mpesaEnabled) return el.classList.add('hidden');
  el.classList.remove('hidden');
  const status = r.payment_status || 'unpaid';
  const badge = `<span class="pay-status ${status}">${ic(PAY_ICON[status])} ${PAY_LABEL[status]}</span>`;

  if (status === 'paid') {
    clearInterval(payPoll); payPoll = null;
    el.innerHTML = `<div class="row">${badge}<span class="muted">${money(r.price)}</span></div>${r.mpesa_receipt ? `<div class="muted">Receipt: ${esc(r.mpesa_receipt)}</div>` : ''}`;
    return;
  }
  if (status === 'pending') {
    el.innerHTML = `<div class="row">${badge}<span class="muted">${money(r.price)}</span></div>
      <p class="hint">Enter your M-Pesa PIN on your phone to finish paying.</p>
      <button class="btn ghost" id="payCheckBtn">${ic('refresh-cw')} I've paid, check now</button>`;
    $('#payCheckBtn').onclick = () => checkPayment(r.id);
    if (!payPoll) payPoll = setInterval(() => checkPayment(r.id, true), 5000);
    return;
  }
  clearInterval(payPoll); payPoll = null;
  el.innerHTML = `<div class="row">${badge}<span class="muted">${money(r.price)}</span></div>
    <label class="muted" style="font-weight:600">M-Pesa phone number</label>
    <input id="payPhone" type="tel" value="${esc(me.phone || '')}" placeholder="07XXXXXXXX">
    <button class="btn primary" id="payNowBtn">${ic('smartphone')} Pay with M-Pesa</button>`;
  $('#payNowBtn').onclick = () => sendPayment(r.id);
}

async function sendPayment(id) {
  const btn = $('#payNowBtn');
  btn.disabled = true;
  try {
    const r = await api(`/requests/${id}/pay`, { method: 'POST', body: { phone: $('#payPhone').value } });
    toast(r.message || 'Check your phone to complete payment.');
  } catch (e) { toast(e.message, true); btn.disabled = false; }
}

async function checkPayment(id, silent) {
  try {
    const r = await api(`/requests/${id}/pay/check`, { method: 'POST' });
    if (r.status !== 'pending') {
      clearInterval(payPoll); payPoll = null;
      if (U.req && U.req.id === id) U.req.payment_status = r.status;
      if (r.status === 'paid') toast('Payment received. Thank you!');
      if (r.status === 'failed' && !silent) toast('Payment did not go through. You can try again.', true);
      renderPayBox(U.req && U.req.id === id ? U.req : { ...U.req, payment_status: r.status });
    }
  } catch (e) { if (!silent) toast(e.message, true); }
}

function renderUserHome() {
  const r = U.req, card = $('#userActiveCard');
  if (isOpen(r)) {
    card.innerHTML = `<div class="row-h"><h2>Current request</h2><span class="badge ${r.status}">${r.status.replace('_', ' ')}</span></div>
      <p>${esc(STATUS_TEXT[r.status])}</p><div class="eta" id="uHomeEta"></div>
      <button class="btn primary" data-view-go="Map">${ic('map')} Track on map</button>`;
  } else {
    card.innerHTML = `<div class="cta">${ic('package')}<div><h2>Where are we moving today?</h2><p class="muted">Pick a truck size, pin the destination and see the price up front.</p></div></div>
      <button class="btn primary" data-view-go="Map">${ic('plus')} Request a truck</button>`;
  }
  bindViewGo(card);
}

function tickUser() {
  const r = U.req;
  if (!r) return U.router && U.router.render();
  let text = STATUS_TEXT[r.status] || '';
  if (r.status === 'pending') {
    const left = Math.max(0, Math.round((r.expires_at - Date.now()) / 1000));
    text = `Looking for a driver. ${r.retries ? `(retry ${r.retries}) ` : ''}Notifying more drivers in ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}.`;
  }
  $('#statusText').textContent = text;
  U.router.render();
  const eta = $('#uHomeEta');
  if (eta) eta.textContent = U.router.route && ['accepted', 'picked_up'].includes(r.status)
    ? `${fmtMin(U.router.remaining())} ${r.status === 'accepted' ? 'until the truck reaches you' : 'to the destination'}` : '';
}

/* =============================== DRIVER =============================== */
const D = { map: null, mk: null, router: null, list: [], job: null, loc: null, avail: 'offline', watch: null, manual: false, lastSent: 0 };

async function initDriver() {
  $('#driverGreeting').textContent = `${me.name} · ${driverInfo.truck_reg} · ${typeLabel(driverInfo.truck_type)}`;
  $('#driverHello').textContent = `Hello, ${me.name.split(' ')[0]}`;
  D.map = makeMap('driverMap');
  D.mk = new Markers(D.map);
  D.router = new Router(D.map, $('#driverNav'), (rt, label) => {
    const st = rt.steps[1] || rt.steps[0];
    return { icon: st.icon, title: st.text, sub: `${st.inMeters ? 'In ' + fmtDist(st.inMeters) + ' · ' : ''}${label === 'pickup' ? 'To pickup' : 'To destination'}` };
  });
  D.map.on('click', (e) => { if (D.manual) { D.manual = false; setLoc(e.latlng.lat, e.latlng.lng); toast('Location set'); } });
  $('#manualLoc').onclick = () => { D.manual = true; toast('Tap the map to set where your truck is'); };
  D.avail = driverInfo.availability === 'busy' ? 'empty' : driverInfo.availability;
  document.querySelectorAll('.avail-btn').forEach((b) => (b.onclick = () => setAvailability(b.dataset.v)));
  syncAvail();
  $('#pickedUp').onclick = () => jobStep('pickup');
  $('#delivered').onclick = () => jobStep('complete');
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  bindChangePassword('driver');

  socket.on('request:new', ({ request, notify }) => {
    D.list = [request, ...D.list.filter((x) => x.id !== request.id)];
    renderOpen();
    if (notify && !D.job) {
      toast(`New request near you: ${money(request.price)}`);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('MyTruckMovers', { body: `New request near you: ${money(request.price)}` });
    }
  });
  socket.on('request:removed', ({ id }) => { D.list = D.list.filter((x) => x.id !== id); renderOpen(); });
  socket.on('request:updated', ({ request }) => {
    if (['accepted', 'picked_up'].includes(request.status)) D.job = request;
    else {
      if (D.job && D.job.id === request.id) {
        toast(request.status === 'cancelled' ? 'The customer cancelled this job.' : 'Job complete. Well done!', request.status === 'cancelled');
        D.avail = 'empty';
        D.mk.removePrefix('job:');
        loadHistory();
      }
      D.job = null;
      loadOpen();
    }
    renderJob();
  });

  const cur = await api('/requests/active');
  D.job = cur.request;
  renderJob();
  await loadOpen();
  if (D.avail !== 'offline') startTracking();
  setInterval(loadOpen, 20000);
  setInterval(tickDriver, 1000);
}

function syncAvail() {
  document.querySelectorAll('.avail-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === D.avail);
    b.disabled = !!D.job;
  });
}
async function setAvailability(v) {
  try {
    await api('/driver/availability', { method: 'POST', body: { availability: v } });
    D.avail = v;
    v !== 'offline' ? startTracking() : stopTracking();
    renderOpen();
  } catch (err) { toast(err.message, true); }
  syncAvail();
}

function startTracking() {
  if (!navigator.geolocation || D.watch != null) return;
  D.watch = navigator.geolocation.watchPosition(
    (p) => setLoc(p.coords.latitude, p.coords.longitude),
    () => toast('GPS unavailable. Use "Set my location on the map".', true),
    { enableHighAccuracy: true, maximumAge: 5000 });
}
function stopTracking() { if (D.watch != null) navigator.geolocation.clearWatch(D.watch); D.watch = null; }

function setLoc(lat, lng) {
  const first = !D.loc;
  D.loc = { lat, lng };
  D.mk.set('me', lat, lng, 'truck', 'mine', 'You');
  $('#locText').textContent = `Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  if (Date.now() - D.lastSent > 2000) { D.lastSent = Date.now(); socket.emit('driver:location', { lat, lng }); }
  if (first) { D.map.setView([lat, lng], 13); setTimeout(loadOpen, 800); }
  refreshDriverRoute();
}

// Navigate to the pickup first, then to the destination once the item is on board
function refreshDriverRoute() {
  const j = D.job;
  if (!j || !D.loc) return D.router.clear();
  if (j.status === 'accepted') D.router.update(D.loc, { lat: j.pickup_lat, lng: j.pickup_lng }, 'pickup');
  else D.router.update(D.loc, { lat: j.dest_lat, lng: j.dest_lng }, 'dest');
}

async function loadOpen() {
  try { D.list = await api('/driver/requests'); renderOpen(); } catch { /* ignore */ }
}

function renderOpen() {
  $('#openWrap').classList.toggle('hidden', !!D.job);
  $('#dStatOpen').textContent = D.list.length;
  D.mk.removePrefix('req:');
  const el = $('#openList');
  el.innerHTML = D.list.length ? '' : '<p class="hint">No open requests for your truck type right now.</p>';
  D.list.sort((a, b) => (a.away_km ?? 1e9) - (b.away_km ?? 1e9)).forEach((r) => {
    if (!D.job) D.mk.set('req:' + r.id, r.pickup_lat, r.pickup_lng, 'package', 'pkg', `${money(r.price)} · ${esc(r.item || '')}`);
    const div = document.createElement('div');
    div.className = 'job' + (r.applied ? ' applied' : '');
    const label = r.applied ? 'Applied, waiting for customer' : r.nearby ? 'Accept job' : 'Apply for job (far away)';
    div.innerHTML = `<div class="row"><b>${money(r.price)}</b><span>${r.away_km ?? '?'} km away</span></div>
      <div>${esc(r.item || 'No description')}</div>
      <small>From: ${esc(r.pickup_addr || 'Pinned location')}<br>To: ${esc(r.dest_addr || 'Pinned location')}<br>Trip: ${r.distance_km} km</small>
      <button class="btn primary" ${r.applied || D.avail === 'offline' ? 'disabled' : ''}>${label}</button>`;
    div.querySelector('button').onclick = () => acceptJob(r);
    div.onclick = (e) => { if (e.target.tagName !== 'BUTTON') D.map.setView([r.pickup_lat, r.pickup_lng], 14); };
    el.appendChild(div);
  });
}

async function acceptJob(r) {
  try {
    const res = await api(`/requests/${r.id}/accept`, { method: 'POST' });
    if (res.mode === 'accepted') {
      toast('Job accepted. Customer details are now visible.');
      const cur = await api('/requests/active');
      D.job = cur.request;
      renderJob();
      setView('Map');
    } else {
      toast('Application sent. The customer must approve it.');
      loadOpen();
    }
  } catch (e) { toast(e.message, true); loadOpen(); }
}

async function jobStep(step) {
  try { await api(`/requests/${D.job.id}/${step}`, { method: 'POST' }); } catch (e) { toast(e.message, true); }
}

function renderJob() {
  const j = D.job;
  syncAvail();
  $('#jobCard').classList.toggle('hidden', !j);
  $('#openWrap').classList.toggle('hidden', !!j);
  const hc = $('#driverJobCard');
  if (!j) {
    hc.innerHTML = `<div class="cta">${ic('navigation')}<div><h2>No active job</h2><p class="muted">Go online and accept a request to start navigating.</p></div></div>
      <button class="btn primary" data-view-go="Map">${ic('map')} See open requests</button>`;
    bindViewGo(hc);
    D.router.clear();
    return renderOpen();
  }
  $('#jobBadge').className = 'badge ' + j.status;
  $('#jobBadge').textContent = j.status.replace('_', ' ');
  $('#jobBody').innerHTML = `<div class="line"><b>${money(j.price)}</b> · ${j.distance_km} km</div>
    <div class="line">${esc(j.item || 'No description')}</div>
    <div class="line">Pickup: ${esc(j.pickup_addr || 'Pinned location')}</div>
    <div class="line">Destination: ${esc(j.dest_addr || 'Pinned location')}</div>
    <div class="line">Customer: <b>${esc(j.user.name)}</b> · <a href="tel:${esc(j.user.phone)}">${ic('phone')} ${esc(j.user.phone)}</a></div>`;
  $('#pickedUp').classList.toggle('hidden', j.status !== 'accepted');
  $('#delivered').classList.toggle('hidden', j.status !== 'picked_up');
  const tLat = j.status === 'accepted' ? j.pickup_lat : j.dest_lat, tLng = j.status === 'accepted' ? j.pickup_lng : j.dest_lng;
  $('#openMaps').href = `https://www.google.com/maps/dir/?api=1&destination=${tLat},${tLng}&travelmode=driving`;
  D.mk.removePrefix('req:');
  D.mk.set('job:pickup', j.pickup_lat, j.pickup_lng, 'map-pin', 'pickup', 'Pickup');
  D.mk.set('job:dest', j.dest_lat, j.dest_lng, 'flag', 'dest', 'Destination');
  hc.innerHTML = `<div class="row-h"><h2>Current job</h2><span class="badge ${j.status}">${j.status.replace('_', ' ')}</span></div>
    <p>${j.status === 'accepted' ? 'Head to the pickup point.' : 'Items on board. Head to the destination.'}</p><div class="eta" id="dHomeEta"></div>
    <button class="btn primary" data-view-go="Map">${ic('navigation')} Continue navigation</button>`;
  bindViewGo(hc);
  D.router.clear(); // force a fresh route for the new leg
  refreshDriverRoute();
}

function tickDriver() {
  D.router.render();
  const eta = $('#dHomeEta');
  if (eta && D.job) eta.textContent = D.router.route ? `${fmtMin(D.router.remaining())} to ${D.job.status === 'accepted' ? 'pickup' : 'destination'}` : '';
}

boot();
