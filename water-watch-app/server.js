import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCheck } from './src/checker.js';
import { getSettings, saveSettings, getSnapshot, getEvents } from './src/storage.js';
import { normaliseAustralianMobile } from './src/phone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const CHECK_EVERY_MINUTES = Number(process.env.CHECK_EVERY_MINUTES || 30);
const APP_PIN = process.env.APP_PIN || '1234';

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function assertPin(req, res, next) {
  const pin = req.headers['x-app-pin'] || req.body?.pin || req.query?.pin;
  if (!APP_PIN || pin === APP_PIN) return next();
  res.status(401).json({ error: 'Incorrect PIN' });
}

app.get('/api/status', async (_req, res) => {
  const [settings, snapshot, events] = await Promise.all([getSettings(), getSnapshot(), getEvents()]);
  res.json({
    ok: true,
    settings: {
      smsToNumber: settings.smsToNumber || '',
      sourceUrl: settings.sourceUrl,
      zone: settings.zone,
      market: settings.market,
      checkEveryMinutes: settings.checkEveryMinutes || CHECK_EVERY_MINUTES
    },
    snapshot: snapshot || null,
    events: events.slice(0, 10)
  });
});

app.post('/api/settings', assertPin, async (req, res) => {
  try {
    const smsToNumber = normaliseAustralianMobile(req.body.smsToNumber || '');
    const saved = await saveSettings({ smsToNumber });
    res.json({ ok: true, settings: saved });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/check-now', assertPin, async (_req, res) => {
  try {
    const result = await runCheck({ notify: true });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/healthz', (_req, res) => res.send('ok'));

const cronExpression = `*/${CHECK_EVERY_MINUTES} * * * *`;
cron.schedule(cronExpression, async () => {
  try {
    console.log(`[Water Watch] Running scheduled check every ${CHECK_EVERY_MINUTES} min...`);
    const result = await runCheck({ notify: true });
    console.log(`[Water Watch] changed=${result.diff.changed}; sms=${JSON.stringify(result.sms)}`);
  } catch (error) {
    console.error('[Water Watch] scheduled check failed:', error);
  }
}, { timezone: process.env.TIMEZONE || 'Australia/Adelaide' });

app.listen(PORT, () => {
  console.log(`Water Watch running on http://localhost:${PORT}`);
  console.log(`Ruralco-only check interval: ${CHECK_EVERY_MINUTES} minutes`);
});
