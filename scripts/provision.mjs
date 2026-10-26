import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { openStore } from '../server/store.js';
import { provision } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
const { values } = parseArgs({ options: { tenant: { type: 'string' }, email: { type: 'string' }, reset: { type: 'boolean', default: false } } });
const password = process.env.VOXELSCOPE_ADMIN_PASSWORD;
if (!values.email || !password || (!values.reset && !values.tenant)) {
  console.error('Set VOXELSCOPE_ADMIN_PASSWORD, then run: node scripts/provision.mjs --tenant "Company" --email admin@company.com\nReset an existing account: node scripts/provision.mjs --reset --email admin@company.com'); process.exit(1);
}
const store = openStore(resolve(process.env.DATA_DIR || 'data'));
try {
  if (values.reset) {
    const email = values.email.toLowerCase();
    const user = store.get('SELECT * FROM users WHERE email=?', email);
    if (!user) throw new Error('Account not found.');
    const hash = await hashPassword(password);
    store.transaction(() => {
      store.run('UPDATE users SET password=?,active=1 WHERE id=?', hash, user.id);
      store.run('DELETE FROM sessions WHERE user_id=?', user.id);
      store.audit(user.tenant_id, 'operator', 'user.password.reset', user.id);
    });
    console.log('Password reset. Existing sessions revoked.');
  } else {
    const result = await provision(store, { tenantName: values.tenant, email: values.email, password });
    console.log(`Tenant created: ${result.tenantId}`);
  }
} finally { store.db.close(); }
