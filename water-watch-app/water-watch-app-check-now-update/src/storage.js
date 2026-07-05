import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');
const LOG_FILE = path.join(DATA_DIR, 'events.json');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readJson(file, fallback) {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(file, data) {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export async function getSettings() {
  const fallback = {
    smsToNumber: process.env.SMS_TO_NUMBER || '',
    appPinSet: Boolean(process.env.APP_PIN),
    sourceUrl: process.env.RURALCO_SOURCE_URL || 'https://www.ruralcowater.com.au/home/',
    zone: 'VIC Goulburn Zone 1A',
    market: 'Temporary Allocation',
    checkEveryMinutes: Number(process.env.CHECK_EVERY_MINUTES || 30)
  };
  return readJson(SETTINGS_FILE, fallback);
}

export async function saveSettings(settings) {
  const current = await getSettings();
  const next = { ...current, ...settings, updatedAt: new Date().toISOString() };
  await writeJson(SETTINGS_FILE, next);
  return next;
}

export async function getSnapshot() {
  return readJson(SNAPSHOT_FILE, null);
}

export async function saveSnapshot(snapshot) {
  await writeJson(SNAPSHOT_FILE, snapshot);
}

export async function getEvents() {
  return readJson(LOG_FILE, []);
}

export async function addEvent(event) {
  const events = await getEvents();
  const next = [event, ...events].slice(0, 100);
  await writeJson(LOG_FILE, next);
  return next;
}
