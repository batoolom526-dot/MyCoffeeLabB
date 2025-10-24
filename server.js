const express = require("express");
const path = require("path");
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

// serve all static files from the same directory as this script
app.use(express.static(__dirname));

// open (or create) sqlite database
const DB_PATH = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_PATH);

// create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    event TEXT,
    itemId TEXT,
    price REAL,
    note TEXT,
    ts TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    name TEXT,
    email TEXT,
    phone TEXT,
    created_at TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    rating INTEGER,
    comment TEXT,
    favoriteItem TEXT,
    ts TEXT
  )`);
});

// Ensure migration: add favoriteItem column if it doesn't exist
db.serialize(() => {
  db.all(`PRAGMA table_info(reviews)`, [], (err, cols) => {
    if (err) return;
    const hasFav = cols && cols.some(c => c.name === 'favoriteItem');
    if (!hasFav) {
      db.run(`ALTER TABLE reviews ADD COLUMN favoriteItem TEXT`, [], (e) => { /* ignore errors */ });
    }
  });
});

// basic routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Track events (from frontend)
app.post('/api/track', (req, res) => {
  const { userId, event, itemId, price, note, timestamp } = req.body;
  const ts = timestamp || new Date().toISOString();
  db.run(`INSERT INTO events (userId,event,itemId,price,note,ts) VALUES (?, ?, ?, ?, ?, ?)`, [userId||null, event, itemId||null, price||0, note||'', ts], function(err) {
    if (err) return res.status(500).json({ error: 'db_error' });
    res.json({ ok: true, id: this.lastID });
  });
});

// Identify / upsert contact
app.post('/api/identify', (req, res) => {
  const { userId, name, email, phone } = req.body;
  if (!email) return res.status(400).json({ error: 'email_required' });
  const created = new Date().toISOString();
  db.run(`INSERT INTO contacts (userId,name,email,phone,created_at) VALUES (?, ?, ?, ?, ?)`, [userId||null, name||'', email, phone||'', created], function(err) {
    if (err) return res.status(500).json({ error: 'db_error' });
    res.json({ ok: true, id: this.lastID });
  });
});

// Simple analytics: top items and co-occurrence pairs
app.get('/api/stats', async (req, res) => {
  try {
    // top items by add_to_cart
    db.all(`SELECT itemId, COUNT(*) as cnt FROM events WHERE event IN ('add_to_cart','checkout') AND itemId IS NOT NULL GROUP BY itemId ORDER BY cnt DESC LIMIT 10`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'db_error' });
      const topItems = rows.map(r => ({ itemId: r.itemId, count: r.cnt }));

      // compute co-occurrence by user
      db.all(`SELECT userId, GROUP_CONCAT(itemId) as items FROM events WHERE event IN ('add_to_cart','checkout') AND itemId IS NOT NULL GROUP BY userId`, [], (err2, userRows) => {
        if (err2) return res.status(500).json({ error: 'db_error' });
        const pairCounts = {};
        userRows.forEach(ur => {
          if (!ur.items) return;
          const items = Array.from(new Set(ur.items.split(',').filter(Boolean)));
          for (let i = 0; i < items.length; i++) {
            for (let j = i+1; j < items.length; j++) {
              const a = items[i], b = items[j];
              const key = a < b ? `${a}||${b}` : `${b}||${a}`;
              pairCounts[key] = (pairCounts[key] || 0) + 1;
            }
          }
        });
        const pairs = Object.entries(pairCounts).map(([k,v]) => {
          const [a,b] = k.split('||'); return { a, b, count: v };
        }).sort((x,y) => y.count - x.count).slice(0,10);

        res.json({ topItems, pairs });
      });
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

// Reviews endpoints
app.post('/api/reviews', (req, res) => {
  const { name, email, rating, comment } = req.body;
  const favoriteItem = req.body.favoriteItem || null;
  const ts = new Date().toISOString();
  db.run(`INSERT INTO reviews (name,email,rating,comment,favoriteItem,ts) VALUES (?, ?, ?, ?, ?, ?)`, [name||'Guest', email||'', rating||5, comment||'', favoriteItem, ts], function(err) {
    if (err) return res.status(500).json({ error: 'db_error' });
    res.json({ ok: true, id: this.lastID });
  });
});

app.get('/api/reviews', (req, res) => {
  db.all(`SELECT id,name,email,rating,comment,favoriteItem,ts FROM reviews ORDER BY id ASC LIMIT 100`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'db_error' });
    res.json(rows);
  });
});

// Send email offers. Configure SMTP via env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
app.post('/api/send-offer', async (req, res) => {
  const { subject, html, toAll } = req.body;
  if (!subject || !html) return res.status(400).json({ error: 'subject_and_html_required' });

  // prepare transporter
  const host = process.env.SMTP_HOST;
  if (!host) return res.status(400).json({ error: 'smtp_not_configured' });
  const transporter = nodemailer.createTransport({
    host: host,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  // determine recipients
  let recipients = [];
  if (toAll) {
    const rows = await new Promise((resolve, reject) => db.all(`SELECT email FROM contacts WHERE email IS NOT NULL AND email <> ''`, [], (e,r)=> e?reject(e):resolve(r)));
    recipients = rows.map(r=>r.email).filter(Boolean);
  } else if (req.body.to) {
    recipients = Array.isArray(req.body.to) ? req.body.to : [req.body.to];
  } else {
    return res.status(400).json({ error: 'no_recipients' });
  }

  // send in small batches to avoid throttling
  try {
    for (let i = 0; i < recipients.length; i++) {
      const to = recipients[i];
      await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
    }
    res.json({ ok: true, sent: recipients.length });
  } catch (e) {
    console.error('send-offer error', e);
    res.status(500).json({ error: 'send_error', detail: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
