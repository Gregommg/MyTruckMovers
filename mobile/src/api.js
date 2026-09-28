import { SERVER_URL } from './config';

let token = null;
export const setToken = (t) => { token = t; };

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form; // let fetch set the multipart boundary
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(SERVER_URL + '/api' + path, { method, headers, body: payload });
  } catch {
    throw new Error('Cannot reach the server. Check SERVER_URL in src/config.js');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
