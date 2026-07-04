export function normaliseAustralianMobile(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const compact = raw.replace(/[\s().-]/g, '');
  if (/^\+614\d{8}$/.test(compact)) return compact;
  if (/^04\d{8}$/.test(compact)) return '+61' + compact.slice(1);
  if (/^614\d{8}$/.test(compact)) return '+' + compact;

  throw new Error('Please enter an Australian mobile like 04XXXXXXXX or +614XXXXXXXX.');
}
