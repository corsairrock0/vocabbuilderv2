// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Terms of Service click-wrap: acceptance at setup, a record per accepted version, re-acceptance after a change,
// and the legal details configured with VB_LEGAL_*.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startTestServer } from '../helpers/harness.ts';
import { TERMS_VERSION } from '../../shared/legal.ts';

test('the legal details are public: Lango LLC by default, VB_LEGAL_* override them', async () => {
  const plain = await startTestServer();
  try {
    const r = await new Client(plain.url).get('/api/legal');
    assert.equal(r.status, 200, 'readable before signing in');
    assert.deepEqual(r.body, { company: 'Lango', legalName: 'Lango LLC', email: 'contact@lango.com', address: null, governingLaw: 'the United States of America', termsVersion: TERMS_VERSION });
  } finally {
    await plain.cleanup();
  }
  const configured = await startTestServer({
    env: { VB_LEGAL_NAME: 'Lango Test LLC', VB_LEGAL_EMAIL: 'legal@example.com', VB_LEGAL_ADDRESS: '1 Example Street', VB_LEGAL_GOVERNING_LAW: '  Ukraine  ' },
  });
  try {
    const r = await new Client(configured.url).get('/api/legal');
    assert.equal(r.body.legalName, 'Lango Test LLC');
    assert.equal(r.body.email, 'legal@example.com');
    assert.equal(r.body.address, '1 Example Street');
    assert.equal(r.body.governingLaw, 'Ukraine', 'trimmed');
  } finally {
    await configured.cleanup();
  }
});

test('creating the account records acceptance of the current terms; a new version must be accepted again', async () => {
  const srv = await startTestServer();
  try {
    const c = new Client(srv.url);
    await c.setup();
    const rows = () => srv.app.db.all<{ terms_version: string; accepted_at: number }>('SELECT terms_version, accepted_at FROM terms_acceptances ORDER BY id');
    assert.equal(rows().length, 1, 'setup records the acceptance');
    assert.equal(rows()[0].terms_version, TERMS_VERSION);
    let boot = (await c.get('/api/bootstrap')).body;
    assert.equal(boot.terms.required, false);
    assert.equal(boot.terms.acceptedVersion, TERMS_VERSION);
    assert.equal(boot.legal.company, 'Lango');

    // The terms change: the stored acceptance is for an older version.
    srv.app.db.run("UPDATE terms_acceptances SET terms_version = '2000-01-01'");
    boot = (await c.get('/api/bootstrap')).body;
    assert.equal(boot.terms.required, true, 'an older acceptance does not cover the new version');
    assert.equal(boot.terms.acceptedVersion, '2000-01-01');

    const outdated = await c.post('/api/legal/accept', { version: '2000-01-01' });
    assert.equal(outdated.status, 409, 'only the version in force can be accepted');
    assert.equal(outdated.body.error.code, 'terms_outdated');

    const ok = await c.post('/api/legal/accept', { version: TERMS_VERSION });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.required, false);
    assert.equal(rows().length, 2, 'each accepted version keeps its own record');
    assert.equal((await c.post('/api/legal/accept', { version: TERMS_VERSION })).status, 200);
    assert.equal(rows().length, 2, 'accepting the same version again adds nothing');
    assert.equal((await c.get('/api/legal/terms')).body.required, false);

    // Accepting needs a signed-in session.
    const anon = await new Client(srv.url).post('/api/legal/accept', { version: TERMS_VERSION });
    assert.equal(anon.status, 401);
  } finally {
    await srv.cleanup();
  }
});
