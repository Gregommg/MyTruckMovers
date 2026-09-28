# MyTruckMovers

Request a truck, get matched with a nearby driver, track it live, and pay by M-Pesa.

```
trackmovers/
├── server/    Node.js + Express + Socket.IO + SQLite (API, realtime, M-Pesa, email; serves the web app)
├── web/       Web app: home page, customer + driver apps (HTML, external style.css, app.js, icons.js, Leaflet maps)
├── mobile/    Mobile app (React Native / Expo, Android + iOS, icons from @expo/vector-icons)
├── assets/    Source logo/icon artwork (see "Logo and app icon" below)
├── Dockerfile, docker-compose.yml, Procfile   Deployment files (see "Deploying")
```

## 1. Run the server + web app

Requires Node.js 18+.

```bash
cd server
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm start
```

At minimum, set `JWT_SECRET` and `ADMIN_KEY` in `.env` to your own random values. M-Pesa and email are optional — see below — the app runs fine without them (payments and emailed reset codes are simply disabled/logged).

Open http://localhost:4000. Register one **Customer** and one **Driver** (use two browsers or a private window).

Testing tips on a laptop (no GPS):
- Driver: choose *Online – truck is empty*, then press **Set my location on the map** and tap the map.
- Customer: tap the map to pin pickup/destination (or search a place), see the price, send the request.
- Put the driver within 10 km of the pickup to accept directly; put them farther away to test **Apply for job**.

## 2. Run the mobile app

```bash
cd mobile
npm install
# edit src/config.js  -> set SERVER_URL to http://<your-computer-LAN-IP>:4000
npx expo start
```

Scan the QR code with **Expo Go**. Phone and computer must be on the same Wi-Fi.
If Expo Go says the SDK version doesn't match: `npx expo install expo@latest && npx expo install --fix`.

Maps: Expo Go works out of the box. For a standalone Android build, add a Google Maps API key in `app.json`.

## Screens

- **Home page** (before login): what MyTruckMovers is, how it works, Log in / Get started.
- **Home** (after login): greeting, your current request or job with the time remaining, stats, shortcuts, and **Change password**. Drivers set Offline / Empty / Dropping off soon here.
- **Request** (customer) / **Jobs** (driver): the map. Customers pin pickup and destination, see the price and a driving-time preview, then follow the truck and pay. Drivers see open requests and navigate.
- **Trips / History**: past and current requests or jobs, each with its payment status.

## Navigation map

- The route is drawn on the map with the **time remaining**, distance and arrival time, updated live as the truck moves.
- **Driver:** navigates to the pickup first, then to the destination once *Item picked up* is pressed. A banner shows the next turn and its distance, and **Open in Google Maps** hands over to full voice navigation.
- **Customer:** sees the same route from the truck to the pickup point, then to the destination, with the time remaining. Before sending a request, the map shows the trip route and estimated drive time.
- Routes come from `GET /api/route`, which uses OSRM (free, no key). The public demo server is for testing; set `ROUTING_URL` to your own OSRM server or a compatible provider for production. If routing is unreachable the apps fall back to a straight-line estimate (marked "est.").

## Paying with M-Pesa (STK Push)

The customer taps **Pay with M-Pesa** on their active request (or a past trip), enters their phone number, and gets an STK push prompt to enter their M-Pesa PIN. Payment status (unpaid / pending / paid / failed) updates live for the customer via Socket.IO, with a manual "check now" fallback in case the callback is delayed.

1. Create an app at [developer.safaricom.co.ke](https://developer.safaricom.co.ke) and note its **Consumer Key** and **Consumer Secret**.
2. For **Lipa na M-Pesa Online (STK Push)** you also need a **Shortcode** and **Passkey** — Safaricom provides sandbox test values in your app's dashboard; for production, apply for a paybill/till and get its passkey from Safaricom.
3. Set in `server/.env`:
   ```
   MPESA_ENV=sandbox              # or production
   MPESA_SHORTCODE_TYPE=paybill   # or till
   MPESA_SHORTCODE=174379
   MPESA_PASSKEY=...
   MPESA_CONSUMER_KEY=...
   MPESA_CONSUMER_SECRET=...
   MPESA_CALLBACK_URL=https://yourdomain.com/api/payments/callback/<MPESA_CALLBACK_SECRET>
   MPESA_CALLBACK_SECRET=some-long-random-string
   ```
4. `MPESA_CALLBACK_URL` **must be a public HTTPS URL** Safaricom's servers can reach — this won't work on `localhost`. For local testing, tunnel it first (e.g. `ngrok http 4000`) and use the ngrok HTTPS URL. In production, use your deployed domain.
5. Restart the server. The Pay button appears automatically once `MPESA_CONSUMER_KEY` etc. are set (the apps check `GET /api/config` → `mpesaEnabled`); leave them blank to hide it.

Sandbox test phone number: `254708374149` (any PIN is accepted; Safaricom's simulator confirms the payment automatically).

## Forgot / change password

- **Change password** (logged in): Home page → *Change password*. Calls `POST /api/account/change-password` with the current and new password.
- **Forgot password** (logged out): *Forgot password?* on the login screen → enter your email → a 6-digit code is emailed → enter the code and a new password. Codes expire after 15 minutes and can only be used once.
- Emailing needs SMTP. Set in `server/.env`:
  ```
  SMTP_HOST=smtp.yourprovider.com
  SMTP_PORT=587
  SMTP_USER=...
  SMTP_PASS=...
  MAIL_FROM=MyTruckMovers <no-reply@yourdomain.com>
  ```
  Any standard SMTP provider works (Gmail with an app password, SendGrid, Mailgun, Amazon SES, etc.).
- **Without SMTP configured**, the app still works end-to-end for development: instead of emailing, the reset code is printed to the server console (`[mail] ... would send to ...`) so you can copy it into the app manually. Nothing is ever exposed to the browser/app directly.

## Logo and app icon

The truck-with-wordmark logo is generated by `assets/gen_logo.py` (Python + Pillow) — plain code drawing shapes and text, no external image service involved. Pre-rendered copies are already in place:
- `web/assets/` — favicons (`icon-32.png`, `icon-192.png`, `icon-180.png` for iOS) and `logo.png` used in the nav bars and auth screen.
- `mobile/assets/` — `icon.png` (app icon), `adaptive-icon.png` (Android adaptive-icon foreground, transparent), `splash.png` (launch screen), `favicon.png` (Expo web build).
- `assets/` at the project root — the full-size originals, in case you want to re-export at other sizes or edit the wordmark.

To change the wordmark or colors, edit `assets/gen_logo.py` and re-run it (`pip install pillow && python3 assets/gen_logo.py`), then copy the files it writes into `web/assets/` and `mobile/assets/` again (see the filenames at the top of `main()` in that script).

## How it works

| Requirement | Implementation |
|---|---|
| Register/login with phone, email, name, role | `POST /api/register`, `/api/login` (JWT, bcrypt) |
| Change / forgot password | `POST /api/account/change-password`, `/api/auth/forgot-password`, `/api/auth/reset-password` (email, or console-logged in dev) |
| Driver extra info | ID (PDF), passport photo (PDF), truck registration no., front truck photo (image). Stored privately, never served publicly |
| Truck size selection | 4 types in `server/pricing.js` (pickup, small, medium, large). Drivers only see requests for their truck type |
| Price before sending | `POST /api/quote`; the server recomputes it when the request is created (base + per-km, KES) |
| Destination pin | Tap the map (or search a place on web) |
| See trucks around | `GET /api/trucks/nearby`: online trucks that are *empty* or *dropping off soon*, no personal info |
| Nearby drivers notified | Realtime push to drivers within `NEARBY_KM` (default 10 km) |
| Far drivers | See requests on the map and **apply**; no notification; the customer must accept the application and can see the applicant's live location |
| Name + phone hidden until accepted | Server only includes them after acceptance |
| Live tracking | Driver GPS to Socket.IO to the customer map, with route and ETA. Status flow: accepted, picked up, completed |
| 10-minute retry | Server checks every 15 s; after `RETRY_MINUTES` it re-broadcasts with a wider radius, up to `MAX_RETRIES`, then marks the request expired |
| Driver can't cancel | `POST /requests/:id/cancel` returns 403 for drivers; only the customer can cancel |
| Pay by M-Pesa | STK Push via `POST /requests/:id/pay`; Safaricom's webhook lands on `POST /api/payments/callback/:secret`; a fallback `POST /requests/:id/pay/check` actively queries Daraja if the webhook is delayed |

## Configuration (`server/.env`)

Core: `PORT`, `JWT_SECRET`, `NEARBY_KM`, `RETRY_MINUTES`, `MAX_RETRIES`, `ADMIN_KEY`, `REQUIRE_APPROVAL`, `ROUTING_URL`.
Storage: `DB_PATH`, `UPLOADS_DIR` (see "Deploying" — point these at a persistent volume in production).
M-Pesa: `MPESA_ENV`, `MPESA_SHORTCODE_TYPE`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_CALLBACK_URL`, `MPESA_CALLBACK_SECRET`.
Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

### Approving drivers (optional)
Set `REQUIRE_APPROVAL=true`. New drivers can't go online until approved:

```bash
curl -H "x-admin-key: YOUR_ADMIN_KEY" http://localhost:4000/api/admin/drivers
curl -X POST -H "x-admin-key: YOUR_ADMIN_KEY" http://localhost:4000/api/admin/drivers/2/approve
# view a document:
curl -H "x-admin-key: YOUR_ADMIN_KEY" http://localhost:4000/api/admin/files/<filename> -o doc.pdf
```

## Deploying

The server is a single Node.js process that also serves the web app — one container, no separate frontend build. A `Dockerfile`, `docker-compose.yml`, `.dockerignore` and `Procfile` are included at the project root.

**The database (SQLite) and driver-document uploads must persist across restarts/redeploys.** They're stored at `DB_PATH` / `UPLOADS_DIR` (default `server/data/trackmovers.db` and `server/data/uploads`) — mount a persistent volume/disk at that path on whichever platform you use, or the data is lost on the next deploy.

A health check is available at `GET /api/health` for any platform that wants one.

### Docker (any host, or docker-compose)
```bash
docker compose up --build -d
```
Edit the `environment:` block in `docker-compose.yml` first (or use `env_file: .env`). This works identically on a plain VPS with Docker installed.

### Render / Railway / Fly.io
All three build directly from the included `Dockerfile` — connect the repo (or `docker deploy` for Fly), set the environment variables from `.env.example` in the platform's dashboard, and attach a persistent disk/volume mounted at `/app/server/data` (matching `DB_PATH`/`UPLOADS_DIR` in the Dockerfile). Expose port `4000`.

### Heroku (or any buildpack-based platform)
The included `Procfile` (`web: node server/server.js`) is enough — push the repo, set the config vars, and add Node.js as the buildpack. Note: Heroku's filesystem is ephemeral, so set `DB_PATH`/`UPLOADS_DIR` to a mounted add-on volume, or migrate to a hosted Postgres if you outgrow SQLite.

### A plain VPS (no Docker)
```bash
cd server && npm ci --omit=dev
# use pm2, systemd, or similar to keep it running:
npx pm2 start server.js --name mytruckmovers
```
Put Nginx or Caddy in front for HTTPS (required for GPS in the browser and for the M-Pesa callback URL).

### Before going live
- Deploy behind **HTTPS** — required for GPS in the browser/app and for the M-Pesa callback URL to be reachable.
- Use long, random `JWT_SECRET`, `ADMIN_KEY` and `MPESA_CALLBACK_SECRET` values — never reuse the placeholders in `.env.example`.
- Switch `MPESA_ENV=production` and use your live shortcode/passkey once you're ready to take real payments.
- Mobile location updates work while the app is open. Background tracking needs `expo-task-manager` and a dev build.
- Web maps use free OpenStreetMap tiles and Nominatim search; for heavy traffic use a paid provider.
