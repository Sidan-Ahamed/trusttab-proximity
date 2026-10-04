# TrustTab — Proximity / Geofencing Module (Prototype)

This is a working implementation of the **first** piece of TrustTab: turning
"a customer's phone is physically near a participating shop" into a
short-lived, shop-scoped **temporary ID** that the owner side can later
attach a bill to. It deliberately does *not* include billing, image
recognition, or payment yet — those are separate modules to build next.

Everything in `backend/` has been run and tested (shop registration,
in-range check-in, out-of-range rejection, temp-ID reuse, and the
leave/expiry path all verified against a live server before packaging).

## What's in here

```
trusttab-proximity/
├── backend/                 Node.js/Express service — the real logic
│   ├── server.js             Geofence math + temp-ID issuance/expiry
│   ├── seed.js                Quick way to create a demo shop
│   └── package.json
├── web-demo/                 Runnable in any browser, no build step
│   ├── customer.html          Simulates the customer's check-in screen
│   └── owner.html             Simulates the shop owner's dashboard
├── mobile-starter/
│   └── ProximityService.js   React Native / Expo starter for the REAL app
└── README.md                 You are here
```

## Quick start (test it in your browser in 2 minutes)

```bash
cd backend
npm install
npm start          # -> "TrustTab proximity service listening on http://localhost:4000"
```

In a **second terminal**, create a demo shop (edit the lat/lng in `seed.js`
to your actual current location first — use Google Maps, long-press a spot,
the coordinates appear at the bottom):

```bash
cd backend
npm run seed
```

Now open `web-demo/owner.html` in your browser (double-click it, or `open
owner.html` / `start owner.html`) — select the shop you just created, and
you'll see a live "0 customers checked in" dashboard that polls every 4
seconds.

Open `web-demo/customer.html` in another tab. The lat/lng fields default to
VIT Vellore's coordinates — replace them with numbers **inside** your
shop's radius (or click "use my device's location" if you're testing from
your actual phone/laptop near that spot) and hit **Check in**. You should
see a temporary ID appear on the customer side, and — within 4 seconds —
that same customer show up on the owner dashboard with a countdown. Try
coordinates far away and confirm you get "No participating shop nearby"
instead.

> Browsers only grant real GPS access on `https://` or `localhost` origins,
> not plain `file://` pages — that's why manual lat/lng fields are the
> primary way to test here rather than relying on "use my location". If you
> want real GPS in the browser, serve the folder locally first: `npx serve
> web-demo` (or Python's `python3 -m http.server`), then open it via
> `http://localhost:...` instead of double-clicking the file.

## How the core logic works

The whole module is really one function: **Haversine distance** between the
customer's GPS coordinates and each registered shop's coordinates. If that
distance is within the shop's configured radius, the customer is "in
range" and gets a temporary ID (or has their existing one returned, so
repeated location pings don't spam new IDs). The ID is stored with an
expiry (30 minutes by default) and a status (`active` / `expired` /
`left`), so the owner-side query is always just "give me active rows for
this shop" — one indexed SQL query, nothing exotic.

This is intentionally the simplest version of "proximity" — plain GPS +
geofencing math — because it's the part you can build, run, and demo today
with zero hardware. See **Upgrading to BLE beacons** below for the
finer-grained version.

## Full technical stack

| Layer | What to use | Why |
|---|---|---|
| Backend runtime | **Node.js + Express** | What's built here — minimal boilerplate, huge ecosystem, easy to deploy |
| Database (prototype) | **SQLite** (`better-sqlite3`) | Zero setup, a single file, plenty fast for a prototype/demo/pilot |
| Database (production) | **PostgreSQL** (or Firebase Firestore) | Handles concurrent writes from many shops; Postgres if you want SQL, Firestore if you want built-in real-time sync with less backend code |
| Customer + Owner apps | **React Native (via Expo)** | One codebase for Android + iOS; `expo-location` gives you geofencing without hand-writing native code |
| Geofencing (phase 1, this module) | **GPS + `expo-location`'s `startGeofencingAsync`** | No extra hardware; ~5-20m accuracy outdoors |
| Proximity (phase 2, upgrade) | **BLE beacons** (`react-native-ble-plx` or `react-native-beacons-manager`) + a physical iBeacon (Estimote/Kontakt.io, or a ~$10 ESP32 flashed as an iBeacon) | Shop-floor-level precision; needed once you have multiple adjacent small shops where GPS alone can't tell them apart |
| Real-time push (owner sees "Paid" instantly) | **Firebase Cloud Messaging**, or a WebSocket (`socket.io`) if you stay off Firebase | Needed for the *next* module (payment confirmation), not this one — mentioned here so your stack choice today doesn't box you in later |
| Auth / customer profile | **Firebase Auth** or a simple JWT + `bcrypt` setup | Firebase Auth is the faster path for a student project — handles phone-number OTP login, which fits an Indian user base well |
| Hosting | **Render / Railway / a free-tier AWS EC2** for the backend; **Expo Application Services (EAS)** for building the mobile app itself | All have generous free tiers suitable for a pilot |
| Payments (later module) | **UPI**, via Razorpay's or Cashfree's UPI API | Both have India-specific docs and sandbox test modes |

## What to actually learn, in order

1. **JavaScript fundamentals** (if not already comfortable) — `async/await`,
   promises, `fetch`. Everything here uses plain modern JS, nothing exotic.
2. **Node.js + Express** — how a route handler, a request body, and a JSON
   response fit together. `server.js` in this repo is a complete, working
   reference to learn from directly.
3. **SQL basics** — enough to read the three queries in `server.js`
   (`INSERT`, `SELECT ... WHERE`, `UPDATE ... WHERE`). You don't need to be
   an expert; this prototype only ever uses those three query shapes.
4. **React Native basics** — components, state (`useState`), and how a
   mobile screen differs from a web page. The official React Native
   "Learn the Basics" tutorial plus the Expo docs will get you there in a
   weekend.
5. **`expo-location`'s geofencing API specifically** — read
   `mobile-starter/ProximityService.js` alongside the [Expo Location
   docs](https://docs.expo.dev/versions/latest/sdk/location/); the
   concepts (foreground vs. background permission, `startGeofencingAsync`,
   the `TaskManager` background task) are the main new ideas here.
6. **Once this module is solid**, move to the next one and learn only what
   it needs: a lightweight object-detection model (e.g. a MobileNet/YOLO
   variant via TensorFlow Lite or a cloud vision API) for the bulk-photo
   billing step, and the UPI payment API for the payment-gate step.

You do not need to learn BLE/beacon programming, Firebase, or payment APIs
to finish *this* module — they're listed above so you can see where the
stack is heading, not because they block you today.

## Novelty check (as of this conversation)

A fresh search specifically for "proximity/geofencing + temporary customer
ID + payment gating before handout" turned up a crowded space of
**commercial geofencing platforms** (Radar, Bluedot, Woosmap, Glympse) —
but every one of them is built for **marketing triggers, curbside pickup
ETAs, or self-checkout unlocking**, not for issuing a photo-linked
temporary identity that a shop owner manually or semi-automatically bills
and then gates physical handout behind. Historical precedent exists in a
narrower form — Apple's now-discontinued EasyPay let customers self-scan
and pay via geofenced app inside an Apple Store — but that's self-scan
barcode checkout with no owner-side billing, no temp ID, and no handout
gate. Indian kirana-digitization players (ShopKirana, NeoMart, KhataBook)
solve supply-chain, delivery, or ledger-keeping problems, not in-person
walkout prevention. The specific combination TrustTab proposes — proximity
check-in → owner-assigned bill → payment-confirmed handout with photo
verification — still appears to be an open gap, though the adjacent
commercial geofencing-SDK space (Radar in particular) is worth knowing
about, since it's a viable *build-vs-buy* option for the geofencing layer
itself if you'd rather not maintain your own beacon/GPS code long-term.

## Next modules to build (not included here)

1. **Billing service** — bulk-photo image recognition (start with a
   pretrained MobileNet/YOLO model fine-tuned on your pilot shop's actual
   product photos) + a manual-entry fallback UI.
2. **Payment + handout gate** — UPI integration, and the real-time push
   (Firestore listener or WebSocket) that flips the owner's screen to
   "Paid" the instant payment clears.
3. **Customer profile + photo verification screen** — the piece that shows
   the owner a photo + contact details once payment is confirmed.

Each of these can be built and tested independently against this module's
`/api/checkin` output (a `tempId` + `shopId`), the same way this module was
built and tested independently of them.
