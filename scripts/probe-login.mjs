const base = process.env.PROBE_BASE_URL || 'http://127.0.0.1:8080';
const mobile = process.env.PROBE_MOBILE || '9000000004';
const password = process.env.PROBE_PASSWORD || 'ChangeMe_123!';

const url = `${base}/api/auth/login`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile, password }),
  });

  const text = await res.text();
  console.log(`POST ${url}`);
  console.log(`status=${res.status} ok=${res.ok}`);
  console.log(text);
  process.exitCode = res.ok ? 0 : 1;
} catch (err) {
  console.error(`POST ${url}`);
  console.error(String(err?.message || err));
  process.exitCode = 1;
}
