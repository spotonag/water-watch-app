import * as cheerio from 'cheerio';
import crypto from 'node:crypto';

const ZONE_PATTERNS = [
  /VIC\s+Goulburn[_\s-]*Zone\s*1A/i,
  /1A\s*VIC\s+Goulburn\s+Zone\s*1A/i,
  /Vic\s+Goulburn[_\s-]*Zone\s*1A/i,
  /Goulburn\s+Zone\s*1A/i,
  /\bZone\s*1A\b/i,
  /^\s*1A\b/i
];

const OTHER_ZONE_PATTERN = /\b(?:Zone\s*)?(?:1B|2|3|4A|4B|5A|5B|6|7|10|11|12|13|14)\b/i;

function normalizeWhitespace(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactId(item) {
  const base = [item.id, item.status, item.volumeMl, item.pricePerMl, item.raw]
    .filter(Boolean)
    .join('|');
  return crypto.createHash('sha1').update(base).digest('hex').slice(0, 12);
}

function extractVolume(text) {
  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ML\b/i);
  if (mlMatch) return Number(mlMatch[1]);

  // Rendered tables may split columns and the row can be like: "100 $85 Listed".
  // Use the first sensible number as a fallback, but ignore obvious listing IDs and prices.
  const numbers = [...text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1]));
  const candidates = numbers.filter((n) => n > 0 && n < 100000);
  return candidates.length ? candidates[0] : null;
}

function extractPrice(text) {
  const dollarMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)(?:\s*\/\s*ML)?/i);
  if (dollarMatch) return Number(dollarMatch[1].replace(/,/g, ''));

  const perMlMatch = text.match(/(?:Price|AUD|\$\/ML|per\s*ML)\D{0,20}([\d,]+(?:\.\d+)?)/i);
  if (perMlMatch) return Number(perMlMatch[1].replace(/,/g, ''));
  return null;
}

function extractId(text) {
  const labelled = text.match(/(?:ID|Listing|Order)\s*#?\s*(\d{3,10})/i);
  if (labelled) return labelled[1];
  const match = text.match(/^\s*(\d{3,10})\b/);
  return match ? match[1] : compactId({ raw: text });
}

function extractStatus(text, type) {
  if (type === 'tradesInProgress') return 'Trade in progress';
  if (/trade\s+in\s+progress/i.test(text)) return 'Trade in progress';
  if (/pending|awaiting|approval|settlement/i.test(text)) return 'Pending';
  if (/auction/i.test(text)) return 'Auction';
  if (/for\s+sale|sell\s+order|seller/i.test(text)) return 'For sale';
  return 'Listed';
}

function isZone1A(text) {
  return ZONE_PATTERNS.some((pattern) => pattern.test(text));
}

function isOtherZone(text) {
  return OTHER_ZONE_PATTERN.test(text) && !isZone1A(text);
}

function looksTemporaryAllocation(text) {
  if (/Permanent Entitlement|Entitlement Lease|Forward Allocation|Carryover Capacity|Options \((?:PUT|CALL)\)/i.test(text)) return false;
  return true;
}

function hasMarketData(text) {
  return /\bML\b/i.test(text) || /\$\s*\d/i.test(text) || /price|volume|seller|for sale|pending|in progress/i.test(text);
}

function parseLine(line, type, options = {}) {
  const raw = normalizeWhitespace(line);
  if (!raw || raw.length < 3 || !looksTemporaryAllocation(raw) || !hasMarketData(raw)) return null;

  const hasZone = isZone1A(raw);
  if (!hasZone) {
    if (!options.forceZone1A) return null;
    if (isOtherZone(raw)) return null;
  }

  const volumeMl = extractVolume(raw);
  const pricePerMl = extractPrice(raw);

  // Avoid turning table headings/page controls into rows.
  if (volumeMl == null && pricePerMl == null) return null;
  if (/Showing:\s*20\s*15\s*10\s*5/i.test(raw)) return null;
  if (/Previous\s+1\s+2\s+3\s+4\s+5\s+Next/i.test(raw)) return null;

  const totalValue = volumeMl != null && pricePerMl != null ? volumeMl * pricePerMl : null;
  const status = extractStatus(raw, type);
  const id = extractId(raw);
  return {
    id,
    type,
    zone: 'VIC Goulburn Zone 1A',
    market: 'Temporary Allocation',
    status,
    volumeMl,
    pricePerMl,
    totalValue,
    raw,
    fingerprint: compactId({ id, status, volumeMl, pricePerMl, raw })
  };
}

function sectionText(fullText, startPattern, stopPatterns) {
  const start = fullText.search(startPattern);
  if (start === -1) return '';
  let end = fullText.length;
  const afterStart = fullText.slice(start + 1);
  for (const stop of stopPatterns) {
    const rel = afterStart.search(stop);
    if (rel !== -1) end = Math.min(end, start + 1 + rel);
  }
  return fullText.slice(start, end);
}

function rowTextsFromHtml(html, plainText = '') {
  const $ = cheerio.load(html || '');
  const rows = [];

  $('tr, li, .row, .market-row, .listing, article, div').each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (text.length >= 3 && text.length <= 900) rows.push(text);
  });

  const bodyText = plainText || normalizeWhitespace($('body').text() || $.root().text() || html);
  return { rows: [...new Set(rows)], bodyText };
}

function linesFromSection(text) {
  const expanded = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/(Sell Orders|Buy Orders|Trades In Progress|Completed Trades|Registry Pricing)/gi, '\n$1\n')
    .replace(/(\d+(?:\.\d+)?\s*ML)/gi, '\n$1')
    .replace(/(\$\s*\d[\d,]*(?:\.\d+)?(?:\s*\/\s*ML)?)/gi, ' $1 ')
    .replace(/(FOR SALE|SELLER|PENDING|IN PROGRESS|TRADE IN PROGRESS|LISTED|AUCTION)/gi, ' $1 ');

  const lines = expanded
    .split(/\n|\r|(?=\b\d{3,10}\b)/g)
    .map(normalizeWhitespace)
    .filter((line) => line.length > 2 && line.length < 900);
  return [...new Set(lines)];
}

function tableRowsNearHeading($, headingPattern) {
  const out = [];
  $('h1,h2,h3,h4,h5,strong,b,div,span').each((_, el) => {
    const heading = normalizeWhitespace($(el).text());
    if (!headingPattern.test(heading)) return;
    let cursor = $(el).next();
    let hops = 0;
    while (cursor.length && hops < 12) {
      cursor.find('tr').each((__, tr) => {
        const txt = normalizeWhitespace($(tr).text());
        if (txt) out.push(txt);
      });
      const txt = normalizeWhitespace(cursor.text());
      if (txt && txt.length < 900) out.push(txt);
      if (/Buy Orders|Trades In Progress|Completed Trades|Registry Pricing/i.test(txt) && !headingPattern.test(txt)) break;
      cursor = cursor.next();
      hops += 1;
    }
  });
  return out;
}

export function parseRuralcoMarket(html, options = {}) {
  const $ = cheerio.load(html || '');
  const { rows, bodyText } = rowTextsFromHtml(html, options.plainText);

  const sellSection = sectionText(bodyText, /Sell Orders/i, [
    /Buy Orders/i,
    /Trades In Progress/i,
    /Completed Trades/i,
    /Registry Pricing/i,
    /Permanent Entitlement/i,
    /Entitlement Lease/i
  ]);

  const progressSection = sectionText(bodyText, /Trades In Progress/i, [
    /Completed Trades/i,
    /Registry Pricing/i,
    /Trading Zone Information/i,
    /Permanent Entitlement/i,
    /Entitlement Lease/i
  ]);

  const sellCandidates = [
    ...tableRowsNearHeading($, /Sell Orders/i),
    ...rows.filter((t) => /Sell Orders|FOR SALE|SELLER|Sell\s+Order/i.test(t)),
    ...linesFromSection(sellSection)
  ];

  const progressCandidates = [
    ...tableRowsNearHeading($, /Trades? In Progress/i),
    ...rows.filter((t) => /Trades? In Progress|Pending|In Progress/i.test(t)),
    ...linesFromSection(progressSection)
  ];

  const parseOptions = { forceZone1A: Boolean(options.forceZone1A) };

  const sellOrders = [...new Map(
    sellCandidates
      .map((line) => parseLine(line, 'sellOrders', parseOptions))
      .filter(Boolean)
      .map((item) => [item.fingerprint, item])
  ).values()].slice(0, 20);

  const tradesInProgress = [...new Map(
    progressCandidates
      .map((line) => parseLine(line, 'tradesInProgress', parseOptions))
      .filter(Boolean)
      .map((item) => [item.fingerprint, item])
  ).values()].slice(0, 20);

  return {
    checkedAt: new Date().toISOString(),
    source: 'Ruralco Water',
    zone: 'VIC Goulburn Zone 1A',
    market: 'Temporary Allocation',
    fetchMode: options.fetchMode || 'plain',
    debugSteps: options.debugSteps || [],
    sellOrders,
    tradesInProgress,
    counts: {
      sellOrders: sellOrders.length,
      tradesInProgress: tradesInProgress.length
    }
  };
}

export function snapshotHash(snapshot) {
  const stable = {
    sellOrders: (snapshot?.sellOrders || []).map((x) => ({
      id: x.id,
      pricePerMl: x.pricePerMl,
      volumeMl: x.volumeMl,
      status: x.status,
      raw: x.raw
    })),
    tradesInProgress: (snapshot?.tradesInProgress || []).map((x) => ({
      id: x.id,
      pricePerMl: x.pricePerMl,
      volumeMl: x.volumeMl,
      status: x.status,
      raw: x.raw
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
