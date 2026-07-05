# Water Watch — Ruralco VIC Goulburn Zone 1A

Private dashboard and SMS watcher for the **Ruralco Water temporary allocation market**.

It is configured for:

- Source: Ruralco Water only
- Market: Temporary Allocation Markets
- State: VIC
- Zone: VIC Goulburn Zone 1A
- Dashboard: first 3 Sell Orders and first 3 Trades In Progress
- Alerts: only when a sell order/trade changes
- Check interval: 30 minutes

## Important update in this version

Ruralco's page needs a real browser-style check. The app now uses Playwright when this environment variable is set:

```env
USE_RENDERED_FETCH=true
```

When that is enabled, the checker opens Ruralco, then tries to select:

1. `TEMPORARY ALLOCATION MARKETS`
2. `VIC`
3. `1A VIC GOULBURN ZONE 1A`

Then it reads the visible `Sell Orders` and `Trades In Progress` sections.

## Render settings

Use:

```text
Build Command: npm install
Start Command: npm start
```

If Playwright fails to find a browser on Render, change the Build Command to:

```text
npm install && npx playwright install chromium
```

If it still says browser/dependencies missing, use:

```text
npm install && npx playwright install --with-deps chromium
```

## Environment variables

Add these in Render:

```env
APP_PIN=1234
RURALCO_SOURCE_URL=https://www.ruralcowater.com.au/home/
CHECK_EVERY_MINUTES=30
TIMEZONE=Australia/Adelaide
PUBLIC_APP_URL=https://your-render-link.onrender.com
SMS_TO_NUMBER=+614XXXXXXXX
USE_RENDERED_FETCH=true
RURALCO_MARKET_TEXT=TEMPORARY ALLOCATION MARKETS
RURALCO_STATE_TEXT=VIC
RURALCO_ZONE_TEXT=1A VIC GOULBURN ZONE 1A
```

For SMS, add your Twilio values:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

## Local test

```bash
npm install
npx playwright install chromium
npm start
```

Then open:

```text
http://localhost:3000/healthz
http://localhost:3000/
```

Use the app PIN, then press **Check Now**.


## Manual Check Update

The **Check Now** button now refreshes the Sell Orders and Trades In Progress cards immediately from the latest Ruralco check. SMS is still sent only when a change is detected.
