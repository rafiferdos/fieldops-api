import 'dotenv/config';
import { createServer } from 'node:http';

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
if (!clientId || process.env.NODE_ENV === 'production') {
  throw new Error(
    'Set GOOGLE_CLIENT_ID in .env and use this helper only in local development',
  );
}
const origin = new URL(process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001');
if (
  origin.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(origin.hostname) ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
) {
  throw new Error(
    'This helper needs a local HTTP FRONTEND_ORIGIN, for example http://localhost:3001',
  );
}

// A disposable credential viewer for Apidog; no credentials are stored or logged.
const html = `<!doctype html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FieldOps Google login test</title>
  <style>
    body { max-width: 700px; margin: 48px auto; padding: 0 24px; font: 18px system-ui; }
    textarea { box-sizing: border-box; width: 100%; height: 180px; margin-top: 16px; }
  </style>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
  <h1>FieldOps Google login test</h1>
  <p>Sign in করে credential copy করুন। Apidog-এর google_credential Local Value-তে বসান।</p>
  <div id="google-button"></div>
  <label for="credential">Google ID token</label>
  <textarea id="credential" readonly spellcheck="false"></textarea>
  <p id="status" role="status">Google button loading…</p>
  <script>
    window.addEventListener('load', () => {
      const status = document.getElementById('status');
      if (!window.google?.accounts?.id) {
        status.textContent = 'Google button load হয়নি। Internet connection ও browser settings যাচাই করুন।';
        return;
      }
      google.accounts.id.initialize({
        client_id: ${JSON.stringify(clientId).replace(/</g, '\\u003c')},
        callback: ({ credential }) => {
          const output = document.getElementById('credential');
          output.value = credential;
          output.focus();
          output.select();
          status.textContent = 'Credential ready—copy করে Apidog-এ test করুন।';
        },
        ux_mode: 'popup',
        auto_select: false,
      });
      google.accounts.id.renderButton(document.getElementById('google-button'), { theme: 'outline', size: 'large' });
      status.textContent = 'Sign in with Google চাপুন।';
    });
  </script>
</body>
</html>`;

const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' || request.url !== '/') {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(html);
});
server.on('error', (error) => {
  console.error(
    `Google test helper could not start: ${error.code ?? error.message}`,
  );
  process.exitCode = 1;
});
server.listen(Number(origin.port || 80), '127.0.0.1', () => {
  console.log(`Google credential test page: ${origin.origin}`);
});
