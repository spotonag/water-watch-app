import { parseRuralcoMarket, snapshotHash } from './parser.js';
import { fetchRenderedRuralcoPage } from './rendered-ruralco.js';
import { getSettings, getSnapshot, saveSnapshot, addEvent } from './storage.js';
import { normaliseAustralianMobile } from './phone.js';
import { sendSms } from './sms.js';

function formatMoney(value) {
  if (value == null || Number.isNaN(value)) return 'Not shown';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(value);
}

function formatMl(value) {
  if (value == null || Number.isNaN(value)) return 'ML not shown';
  return `${value} ML`;
}

function itemSummary(item) {
  const price = item.pricePerMl == null ? 'price not shown' : `${formatMoney(item.pricePerMl)}/ML`;
  const volume = formatMl(item.volumeMl);
  return `${volume} @ ${price}`;
}

function indexById(items = []) {
  const map = new Map();
  for (const item of items) {
    map.set(item.id || item.fingerprint, item);
  }
  return map;
}

export function diffSnapshots(previous, current) {
  if (!previous) {
    const initialCount = (current.sellOrders?.length || 0) + (current.tradesInProgress?.length || 0);
    return {
      changed: false,
      firstRun: true,
      message: `Initial snapshot stored. ${initialCount} current Zone 1A allocation records found.`,
      changes: []
    };
  }

  const changes = [];
  const groups = [
    { key: 'sellOrders', label: 'sell order' },
    { key: 'tradesInProgress', label: 'trade in progress' }
  ];

  for (const group of groups) {
    const oldMap = indexById(previous[group.key] || []);
    const newMap = indexById(current[group.key] || []);

    for (const [id, item] of newMap.entries()) {
      const old = oldMap.get(id);
      if (!old) {
        changes.push({ kind: 'new', label: group.label, item, text: `New ${group.label}: ${itemSummary(item)}` });
        continue;
      }
      if (old.pricePerMl !== item.pricePerMl) {
        changes.push({ kind: 'price', label: group.label, item, old, text: `${group.label} price changed: ${formatMoney(old.pricePerMl)}/ML → ${formatMoney(item.pricePerMl)}/ML` });
      }
      if (old.volumeMl !== item.volumeMl) {
        changes.push({ kind: 'volume', label: group.label, item, old, text: `${group.label} volume changed: ${formatMl(old.volumeMl)} → ${formatMl(item.volumeMl)}` });
      }
      if (old.status !== item.status) {
        changes.push({ kind: 'status', label: group.label, item, old, text: `${group.label} status changed: ${old.status || 'Not shown'} → ${item.status || 'Not shown'}` });
      }
      if (old.raw !== item.raw && old.pricePerMl === item.pricePerMl && old.volumeMl === item.volumeMl && old.status === item.status) {
        changes.push({ kind: 'details', label: group.label, item, old, text: `${group.label} details changed: ${itemSummary(item)}` });
      }
    }

    for (const [id, item] of oldMap.entries()) {
      if (!newMap.has(id)) {
        changes.push({ kind: 'removed', label: group.label, item, text: `${group.label} disappeared: ${itemSummary(item)}` });
      }
    }
  }

  return {
    changed: changes.length > 0,
    firstRun: false,
    message: changes.map((c) => c.text).join('\n'),
    changes
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Water Watch private monitoring app; contact owner if needed',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!response.ok) throw new Error(`Ruralco fetch failed: HTTP ${response.status}`);
  return response.text();
}

async function fetchRuralcoMarket(url) {
  const useRendered = String(process.env.USE_RENDERED_FETCH || 'false').toLowerCase() === 'true';
  if (!useRendered) {
    const html = await fetchHtml(url);
    return {
      html,
      plainText: '',
      fetchMode: 'plain',
      finalUrl: url,
      debugSteps: []
    };
  }

  const rendered = await fetchRenderedRuralcoPage(url);
  return {
    html: rendered.html,
    plainText: rendered.bodyText,
    fetchMode: 'rendered',
    finalUrl: rendered.finalUrl,
    debugSteps: rendered.debugSteps
  };
}

function buildSmsBody(diff, current, appUrl) {
  const first = diff.changes[0]?.item;
  const more = diff.changes.length > 1 ? `\n+${diff.changes.length - 1} more change(s)` : '';
  const line = first ? itemSummary(first) : 'Change detected';
  const status = first?.status ? `\nStatus: ${first.status}` : '';
  return [
    'WATER WATCH ALERT',
    '',
    'Ruralco VIC Goulburn Zone 1A',
    'Temporary allocation market',
    '',
    diff.changes[0]?.text || line,
    status.trim() ? status : '',
    more,
    '',
    `Checked: ${new Date(current.checkedAt).toLocaleString('en-AU', { timeZone: process.env.TIMEZONE || 'Australia/Adelaide' })}`,
    appUrl ? `Open: ${appUrl}` : ''
  ].filter(Boolean).join('\n');
}

export async function runCheck({ notify = true } = {}) {
  const settings = await getSettings();
  const url = settings.sourceUrl || process.env.RURALCO_SOURCE_URL || 'https://www.ruralcowater.com.au/home/';
  const marketPage = await fetchRuralcoMarket(url);
  const current = parseRuralcoMarket(marketPage.html, {
    plainText: marketPage.plainText,
    forceZone1A: marketPage.fetchMode === 'rendered',
    fetchMode: marketPage.fetchMode,
    debugSteps: marketPage.debugSteps
  });
  current.hash = snapshotHash(current);
  current.sourceUrl = url;
  current.finalUrl = marketPage.finalUrl;

  const previous = await getSnapshot();
  const diff = diffSnapshots(previous, current);

  await saveSnapshot(current);

  const event = {
    at: new Date().toISOString(),
    changed: diff.changed,
    firstRun: diff.firstRun,
    message: diff.message,
    counts: current.counts,
    sourceUrl: url,
    fetchMode: current.fetchMode,
    debugSteps: current.debugSteps
  };
  await addEvent(event);

  let sms = { sent: false, reason: 'No change' };
  if (notify && diff.changed) {
    let to = settings.smsToNumber || process.env.SMS_TO_NUMBER || '';
    if (to) to = normaliseAustralianMobile(to);
    const body = buildSmsBody(diff, current, process.env.PUBLIC_APP_URL || '');
    sms = await sendSms({ to, body });
  }

  return { current, diff, sms };
}
