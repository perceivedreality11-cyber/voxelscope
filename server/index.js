import { resolve } from 'node:path';
import { createApp } from './app.js';
import { token } from './auth.js';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const password = process.env.VOXELSCOPE_ADMIN_PASSWORD || token().slice(0, 24);
const email = process.env.VOXELSCOPE_ADMIN_EMAIL || 'admin@local';
const secureCookies = process.env.SECURE_COOKIES === 'true';
if (password === 'replace-with-your-own-long-random-password') {
  console.error('Replace the example administrator password in .env before starting.'); process.exit(1);
}
if (host !== '127.0.0.1' && host !== 'localhost' && (!secureCookies || !process.env.PUBLIC_ORIGIN)) {
  console.error('Network exposure requires SECURE_COOKIES=true and PUBLIC_ORIGIN=https://your-domain. Use an HTTPS reverse proxy.');
  process.exit(1);
}
const app = await createApp({ directory: resolve(process.env.DATA_DIR || 'data'), secureCookies,
  publicOrigin: process.env.PUBLIC_ORIGIN || null,
  bootstrap: { tenantName: process.env.VOXELSCOPE_TENANT || '材料检测实验室', email, password } });
const fresh = app.initialized;
app.server.listen(port, host, () => {
  console.log(`\nVoxelScope Enterprise → http://${host}:${port}\n`);
  if (fresh) console.log(`Initial administrator: ${email}\nTemporary password: ${password}\nChange it in Account settings after signing in.\n`);
  else console.log('Existing workspace loaded. Use your saved credentials.\n');
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return; closing = true;
  await app.close(); process.exit(0);
});
