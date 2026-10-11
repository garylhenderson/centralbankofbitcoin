/* Read only: the front door uses the same observed register as the market. */
(async () => {
  const note = document.getElementById('home-observed');
  const totals = document.getElementById('home-totals');
  const issuance = document.getElementById('home-issuance');
  const state = document.getElementById('home-state');
  try {
    const response = await fetch('/data/vaults.json', { cache: 'no-store' });
    if (!response.ok) throw Error();
    const data = await response.json();
    if (!Number.isFinite(data.generated_at) || data.generated_at <= 0 || data.generated_at > Date.now() / 1000 + 60) throw Error();
    for (const [id, key] of [['home-issued', 'minted'], ['home-live', 'live'], ['home-opened', 'opened']]) {
      const count = data.totals?.[key];
      document.getElementById(id).textContent = Number.isSafeInteger(count) && count >= 0 ? count.toLocaleString('en-US') : 'Unavailable';
    }
    const value = data.totals?.value_usd;
    document.getElementById('home-reserves').textContent = Number.isFinite(value) && value >= 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : 'Unavailable';
    const beforeFirstIssue = data.totals?.minted === 0;
    totals.hidden = beforeFirstIssue;
    issuance.hidden = !beforeFirstIssue;
    if (beforeFirstIssue) issuance.textContent = '0 of 2,100 vaults issued. The register begins with the first.';
    const delayed = Date.now() / 1000 - data.generated_at > 1800;
    note.textContent = (delayed ? 'Delayed return. ' : '') + 'Observed ' + new Date(data.generated_at * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' }) + '. Reserve values are estimates, not sale prices.';
    state.textContent = delayed ? 'Delayed register' : data.collection ? 'Public register' : 'Preparing to open';
  } catch {
    totals.hidden = true;
    issuance.hidden = false;
    issuance.textContent = 'The current register is temporarily unavailable.';
    note.textContent = 'Explore the vault designs and check the market for updates.';
    state.textContent = 'Register unavailable';
  }
})();
