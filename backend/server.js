
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(__dirname + '/trusttab.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    radius_m   REAL NOT NULL DEFAULT 50,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    temp_id       TEXT PRIMARY KEY,
    shop_id       TEXT NOT NULL,
    customer_id   TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    issued_at     INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active', -- active | expired | left
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );
`);

// A temp ID is only ever valid for one shop, for a short window. 18 hours 
// comfortably covers a shopping visit without leaving stale sessions around.
const TEMP_ID_TTL_MS = 18 * 60 * 60 * 1000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // mean Earth radius, meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function purgeExpired() {
  db.prepare(
    `UPDATE checkins SET status = 'expired'
     WHERE status = 'active' AND expires_at < ?`
  ).run(Date.now());
}

// Shop management (Owner App's setup)

app.post('/api/shops', (req, res) => {
  const { name, lat, lng, radius_m } = req.body;
  if (!name || lat == null || lng == null) {
    return res.status(400).json({ error: 'name, lat, lng are required' });
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO shops (id, name, lat, lng, radius_m, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, lat, lng, radius_m || 50, Date.now());
  res.status(201).json({ id, name, lat, lng, radius_m: radius_m || 50 });
});

app.get('/api/shops', (_req, res) => {
  res.json(db.prepare(`SELECT * FROM shops ORDER BY created_at DESC`).all());
});

// ---------------------------------------------------------------------
// The core step: proximity check-in
// Customer app calls this periodically (e.g. every 15-30s while the
// app is in the foreground, or on a geofence-enter OS callback).
// ---------------------------------------------------------------------

app.post('/api/checkin', (req, res) => {
  purgeExpired();
  const { customerId, customerName, lat, lng } = req.body;
  if (!customerId || !customerName || lat == null || lng == null) {
    return res
      .status(400)
      .json({ error: 'customerId, customerName, lat, lng are required' });
  }

  const shops = db.prepare(`SELECT * FROM shops`).all();
  let nearest = null;
  let nearestDist = Infinity;

  for (const shop of shops) {
    const dist = haversineMeters(lat, lng, shop.lat, shop.lng);
    if (dist <= shop.radius_m && dist < nearestDist) {
      nearest = shop;
      nearestDist = dist;
    }
  }

  if (!nearest) {
    return res.json({ inRange: false, message: 'No participating shop nearby' });
  }

  // If this customer already has an active temp ID for this shop, reuse it
  // instead of minting a new one every time the phone re-pings location.
  const existing = db
    .prepare(
      `SELECT * FROM checkins
       WHERE shop_id = ? AND customer_id = ? AND status = 'active' AND expires_at > ?`
    )
    .get(nearest.id, customerId, Date.now());

  if (existing) {
    return res.json({
      inRange: true,
      tempId: existing.temp_id,
      shopId: nearest.id,
      shopName: nearest.name,
      distanceMeters: Math.round(nearestDist),
      expiresAt: existing.expires_at,
      reused: true,
    });
  }

  const tempId = randomUUID();
  const now = Date.now();
  const expiresAt = now + TEMP_ID_TTL_MS;

  db.prepare(
    `INSERT INTO checkins
       (temp_id, shop_id, customer_id, customer_name, issued_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`
  ).run(tempId, nearest.id, customerId, customerName, now, expiresAt);

  res.status(201).json({
    inRange: true,
    tempId,
    shopId: nearest.id,
    shopName: nearest.name,
    distanceMeters: Math.round(nearestDist),
    expiresAt,
    reused: false,
  });
});

// ---------------------------------------------------------------------
// Owner-side: "who is currently checked in at my shop right now?"
// The Owner App polls (or subscribes to) this to populate the picker
// used when assigning a bill to a customer.
// ---------------------------------------------------------------------

app.get('/api/shops/:shopId/active', (req, res) => {
  purgeExpired();
  const rows = db
    .prepare(
      `SELECT temp_id, customer_name, issued_at, expires_at
       FROM checkins WHERE shop_id = ? AND status = 'active'
       ORDER BY issued_at DESC`
    )
    .all(req.params.shopId);
  res.json(rows);
});

// Simulates the customer leaving the geofence (or the OS geofence-exit
// callback firing) — ends the session early instead of waiting for TTL.
app.post('/api/checkin/:tempId/leave', (req, res) => {
  const result = db
    .prepare(`UPDATE checkins SET status = 'left' WHERE temp_id = ? AND status = 'active'`)
    .run(req.params.tempId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'active temp ID not found' });
  }
  res.json({ message: 'left' });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`TrustTab proximity service listening on http://localhost:${PORT}`)
);
