// M-Pesa Daraja integration (STK Push / "Lipa na M-Pesa Online").
// Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
const BASE = process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
const SHORTCODE = process.env.MPESA_SHORTCODE || '';
const PASSKEY = process.env.MPESA_PASSKEY || '';
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || '';
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL || '';
const TXN_TYPE = process.env.MPESA_SHORTCODE_TYPE === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline';

const configured = () => !!(SHORTCODE && PASSKEY && CONSUMER_KEY && CONSUMER_SECRET && CALLBACK_URL);

// Kenya has no DST, so a fixed +3h offset from UTC always matches Daraja's expected local timestamp.
function timestamp() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// Accepts 07xxxxxxxx, +2547xxxxxxxx, 2547xxxxxxxx -> returns 2547xxxxxxxx (what Daraja expects)
function normalizePhone(raw) {
  const d = String(raw || '').replace(/[^\d]/g, '');
  if (d.startsWith('254') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 10) return '254' + d.slice(1);
  if (d.startsWith('7') && d.length === 9) return '254' + d;
  if (d.startsWith('1') && d.length === 9) return '254' + d; // newer 01xxxxxxxx Safaricom numbers
  return null;
}

let token = null, tokenAt = 0;
async function getToken() {
  if (token && Date.now() - tokenAt < 55 * 60 * 1000) return token;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: 'Basic ' + auth } });
  const j = await res.json();
  if (!j.access_token) throw new Error(j.errorMessage || 'M-Pesa authentication failed. Check MPESA_CONSUMER_KEY/SECRET.');
  token = j.access_token; tokenAt = Date.now();
  return token;
}

async function stkPush({ phone, amount, accountRef, desc }) {
  if (!configured()) throw new Error('M-Pesa is not configured on this server. Set the MPESA_* variables.');
  const msisdn = normalizePhone(phone);
  if (!msisdn) throw new Error('Enter a valid M-Pesa phone number (e.g. 07XXXXXXXX)');
  const t = await getToken();
  const ts = timestamp();
  const password = Buffer.from(SHORTCODE + PASSKEY + ts).toString('base64');
  const body = {
    BusinessShortCode: SHORTCODE, Password: password, Timestamp: ts,
    TransactionType: TXN_TYPE, Amount: Math.max(1, Math.round(amount)),
    PartyA: msisdn, PartyB: SHORTCODE, PhoneNumber: msisdn,
    CallBackURL: CALLBACK_URL, AccountReference: String(accountRef).slice(0, 12), TransactionDesc: String(desc).slice(0, 100),
  };
  const res = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.ResponseCode !== '0') throw new Error(j.errorMessage || j.ResponseDescription || j.CustomerMessage || 'M-Pesa did not accept the request');
  return { checkoutRequestId: j.CheckoutRequestID, merchantRequestId: j.MerchantRequestID, customerMessage: j.CustomerMessage, phone: msisdn };
}

// Active poll, used as a fallback when the async callback hasn't arrived yet.
async function stkQuery(checkoutRequestId) {
  const t = await getToken();
  const ts = timestamp();
  const password = Buffer.from(SHORTCODE + PASSKEY + ts).toString('base64');
  const res = await fetch(`${BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ BusinessShortCode: SHORTCODE, Password: password, Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  return res.json(); // ResultCode '0' = paid, '1032' = cancelled by user, others = failed/still pending
}

module.exports = { configured, normalizePhone, stkPush, stkQuery };
