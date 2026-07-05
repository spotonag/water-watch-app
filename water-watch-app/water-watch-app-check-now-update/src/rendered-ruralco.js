import { chromium } from 'playwright';

const DEFAULT_SOURCE_URL = 'https://www.ruralcowater.com.au/home/';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitSettled(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function clickByText(page, patterns, label) {
  for (const pattern of patterns) {
    const locator = page.getByText(pattern).first();
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
      await locator.click({ timeout: 5000 });
      await waitSettled(page);
      return { ok: true, method: 'text', label, pattern: String(pattern) };
    } catch (_) {
      // Try the next text pattern.
    }
  }

  // Some sites use table rows/divs with onclick handlers. Try a DOM-level click as a fallback.
  const patternSources = patterns.map((p) => p.source || escapeRegExp(String(p)));
  const clicked = await page.evaluate((sources) => {
    const regexes = sources.map((source) => new RegExp(source, 'i'));
    const candidates = Array.from(document.querySelectorAll('button,a,li,td,th,span,div'));
    const hit = candidates.find((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return text && text.length < 120 && regexes.some((rx) => rx.test(text));
    });
    if (!hit) return false;
    hit.scrollIntoView({ block: 'center', inline: 'center' });
    hit.click();
    return true;
  }, patternSources).catch(() => false);

  if (clicked) {
    await waitSettled(page);
    return { ok: true, method: 'dom', label };
  }

  return { ok: false, label };
}

async function selectZone(page, zonePatterns) {
  // First try HTML <select> boxes, because Ruralco may expose the zone there.
  const selected = await page.evaluate((sources) => {
    const regexes = sources.map((source) => new RegExp(source, 'i'));
    const selects = Array.from(document.querySelectorAll('select'));
    for (const select of selects) {
      const option = Array.from(select.options || []).find((opt) => {
        const text = `${opt.textContent || ''} ${opt.value || ''}`.replace(/\s+/g, ' ').trim();
        return regexes.some((rx) => rx.test(text));
      });
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, text: option.textContent, value: option.value };
      }
    }
    return { ok: false };
  }, zonePatterns.map((p) => p.source || escapeRegExp(String(p)))).catch(() => ({ ok: false }));

  if (selected.ok) {
    await waitSettled(page);
    return { ok: true, method: 'select', label: 'zone', selected };
  }

  return clickByText(page, zonePatterns, 'zone');
}

function buildPatternsFromEnv(value, fallbacks) {
  const patterns = [];
  if (value) patterns.push(new RegExp(escapeRegExp(value), 'i'));
  patterns.push(...fallbacks);
  return patterns;
}

export async function fetchRenderedRuralcoPage(sourceUrl = DEFAULT_SOURCE_URL) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage({
    viewport: { width: 1365, height: 1400 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 WaterWatch/1.1'
  });

  const debugSteps = [];
  try {
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitSettled(page);

    const marketPatterns = buildPatternsFromEnv(process.env.RURALCO_MARKET_TEXT, [
      /TEMPORARY\s+ALLOCATION\s+MARKETS/i,
      /Temporary\s+Allocation/i
    ]);
    debugSteps.push(await clickByText(page, marketPatterns, 'market'));

    const statePatterns = buildPatternsFromEnv(process.env.RURALCO_STATE_TEXT, [
      /^\s*VIC\s*$/i,
      /\bVIC\b/i
    ]);
    debugSteps.push(await clickByText(page, statePatterns, 'state'));

    const zonePatterns = buildPatternsFromEnv(process.env.RURALCO_ZONE_TEXT, [
      /1A\s+VIC\s+GOULBURN/i,
      /VIC\s+GOULBURN\s+ZONE\s*1A/i,
      /GOULBURN\s+ZONE\s*1A/i,
      /^\s*1A\b/i,
      /Zone\s*1A/i
    ]);
    debugSteps.push(await selectZone(page, zonePatterns));

    // Give Ruralco/Water Exchange time to fill the tables after the final filter.
    await waitSettled(page);
    await page.waitForTimeout(2500);

    const html = await page.content();
    const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(async () => {
      return page.evaluate(() => document.body?.innerText || '');
    });

    return {
      html,
      bodyText,
      finalUrl: page.url(),
      debugSteps
    };
  } finally {
    await browser.close();
  }
}
