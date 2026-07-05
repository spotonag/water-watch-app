const $ = (id) => document.getElementById(id);

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit'
  });
}

function fmtMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Not shown';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(value);
}

function fmtMl(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'ML not shown';
  return `${value} ML`;
}

function renderList(el, items, emptyText) {
  const firstThree = (items || []).slice(0, 3);
  if (!firstThree.length) {
    el.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }

  el.innerHTML = firstThree.map((item) => `
    <article class="item">
      <div class="topline">
        <div>
          <strong>${fmtMl(item.volumeMl)}</strong><br />
          <small>${item.pricePerMl == null ? 'Price not shown' : `${fmtMoney(item.pricePerMl)}/ML`}</small>
        </div>
        <span class="badge">${item.status || 'Listed'}</span>
      </div>
      <small>Total: ${item.totalValue == null ? 'Not shown' : fmtMoney(item.totalValue)}</small>
      <p class="raw">${item.raw || ''}</p>
    </article>
  `).join('');
}


function renderSnapshot(snapshot) {
  $('lastChecked').textContent = fmtDate(snapshot?.checkedAt);
  $('sellCount').textContent = snapshot?.counts?.sellOrders ?? 0;
  $('progressCount').textContent = snapshot?.counts?.tradesInProgress ?? 0;

  renderList($('sellOrders'), snapshot?.sellOrders || [], 'No Zone 1A temporary allocation sell orders found in the current Ruralco source.');
  renderList($('progressOrders'), snapshot?.tradesInProgress || [], 'No Zone 1A trades in progress found in the current Ruralco source.');
}

function renderEvents(events) {
  if (!events?.length) {
    $('events').innerHTML = '<div class="empty">No checks have run yet.</div>';
    return;
  }

  $('events').innerHTML = events.slice(0, 8).map((event) => `
    <div class="event">
      <strong>${event.changed ? 'Change detected' : event.firstRun ? 'Initial snapshot' : 'No change'}</strong>
      <br />${fmtDate(event.at)} — ${event.message || 'No Ruralco change found.'}
    </div>
  `).join('');
}

async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    $('connectionStatus').textContent = 'Online';
    $('smsToNumber').value = data.settings?.smsToNumber || '';

    renderSnapshot(data.snapshot);
    renderEvents(data.events || []);
  } catch (error) {
    $('connectionStatus').textContent = 'Offline';
    $('formMessage').textContent = error.message;
  }
}

$('settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('formMessage').textContent = 'Saving...';
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-pin': $('pin').value
    },
    body: JSON.stringify({ smsToNumber: $('smsToNumber').value })
  });
  const data = await response.json();
  if (!response.ok) {
    $('formMessage').textContent = data.error || 'Could not save.';
    return;
  }
  $('formMessage').textContent = 'SMS number saved.';
  await loadStatus();
});

$('checkNow').addEventListener('click', async () => {
  const button = $('checkNow');
  button.disabled = true;
  $('formMessage').textContent = 'Checking Ruralco now and updating Sell Orders / Trades In Progress...';

  try {
    const response = await fetch('/api/check-now', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-pin': $('pin').value },
      body: JSON.stringify({})
    });

    const data = await response.json();
    if (!response.ok) {
      $('formMessage').textContent = data.error || 'Check failed.';
      return;
    }

    // Update the dashboard straight away from the manual check result.
    renderSnapshot(data.result.current);

    const sellCount = data.result.current?.counts?.sellOrders ?? 0;
    const progressCount = data.result.current?.counts?.tradesInProgress ?? 0;

    $('formMessage').textContent = data.result.diff.changed
      ? `Updated now: ${sellCount} sell order(s), ${progressCount} trade(s) in progress. Change found, SMS sent if Twilio is configured.`
      : `Updated now: ${sellCount} sell order(s), ${progressCount} trade(s) in progress. No Ruralco change found, so no SMS sent.`;

    // Refresh change log and saved SMS number from server storage.
    await loadStatus();
  } catch (error) {
    $('formMessage').textContent = error.message || 'Check failed.';
  } finally {
    button.disabled = false;
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadStatus();
setInterval(loadStatus, 60_000);
