import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api, SEED, signIn } from './helpers/auth.js';

describe('rbac users', () => {
  let admin = '';
  let dealer = '';
  const stamp = Date.now().toString(36);
  let testUserId = '';

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
    dealer = await signIn(SEED.dealer.email, SEED.dealer.password);
  });

  it('list users', async () => {
    const list = await api('/api/rbac/users', admin);
    expectOk(list);
    expect(Array.isArray(list.data)).toBe(true);
  });

  it('dealer forbidden on users', async () => {
    const res = await api('/api/rbac/users', dealer);
    expectStatus(res, [401, 403]);
  });

  it('create / update / password / roles / delete', async () => {
    const created = await api('/api/rbac/users', admin, {
      method: 'POST',
      body: JSON.stringify({
        email: `e2e_${stamp}@local.dev`,
        password: 'Test@12345678',
        name: `e2e_${stamp}`,
        realname: 'E2E User',
      }),
    });
    expectOk(created, 'create');
    testUserId = (created.data as { id: string }).id;
    expect(testUserId).toBeTruthy();

    const dup = await api('/api/rbac/users', admin, {
      method: 'POST',
      body: JSON.stringify({
        email: `e2e_${stamp}@local.dev`,
        password: 'Test@12345678',
        name: 'dup',
      }),
    });
    expectStatus(dup, [400, 409], 'duplicate email');

    const upd = await api(`/api/rbac/users/${testUserId}`, admin, {
      method: 'PUT',
      body: JSON.stringify({
        email: `e2e_${stamp}@local.dev`,
        name: `e2e_${stamp}_u`,
        realname: 'E2E Updated',
      }),
    });
    expectOk(upd, 'update');

    const shortPwd = await api(`/api/rbac/users/${testUserId}/password`, admin, {
      method: 'PUT',
      body: JSON.stringify({ password: 'short' }),
    });
    expectStatus(shortPwd, [400], 'password min 8');

    const pwd = await api(`/api/rbac/users/${testUserId}/password`, admin, {
      method: 'PUT',
      body: JSON.stringify({ password: 'Test@87654321' }),
    });
    expectOk(pwd, 'password');

    const rolesList = await api('/api/rbac/roles', admin);
    expectOk(rolesList);
    const roles = rolesList.data as Array<{ roleId: number; key?: string }>;
    const dealerRole = roles.find((r) => r.key === 'dealer');
    expect(dealerRole).toBeTruthy();

    const setRoles = await api(`/api/rbac/users/${testUserId}/roles`, admin, {
      method: 'PUT',
      body: JSON.stringify({ roleIds: [dealerRole!.roleId] }),
    });
    expectOk(setRoles, 'set roles');

    const getRoles = await api(`/api/rbac/users/${testUserId}/roles`, admin);
    expectOk(getRoles, 'get roles');

    const missing = await api('/api/rbac/users/nonexistent-id-404', admin, {
      method: 'PUT',
      body: JSON.stringify({ name: 'x' }),
    });
    expectStatus(missing, [400, 404], '404 user');

    const del = await api(`/api/rbac/users/${testUserId}`, admin, {
      method: 'DELETE',
    });
    expectOk(del, 'delete');
    testUserId = '';
  });

  it('deny delete/update superadmin', async () => {
    const users = (await api('/api/rbac/users', admin)).data as Array<{
      id: string;
      isSuperAdmin?: boolean;
      email?: string;
    }>;
    const sa = users.find(
      (u) => u.isSuperAdmin || u.email === SEED.admin.email,
    );
    expect(sa).toBeTruthy();

    const denyDel = await api(`/api/rbac/users/${sa!.id}`, admin, {
      method: 'DELETE',
    });
    expectStatus(denyDel, [400, 403], 'deny delete sa');

    const denyPwd = await api(`/api/rbac/users/${sa!.id}/password`, admin, {
      method: 'PUT',
      body: JSON.stringify({ password: 'ShouldNot@123456' }),
    });
    expectStatus(denyPwd, [400, 403], 'deny reset sa password');

    const denyRoles = await api(`/api/rbac/users/${sa!.id}/roles`, admin, {
      method: 'PUT',
      body: JSON.stringify({ roleIds: [] }),
    });
    expectStatus(denyRoles, [400, 403], 'deny sa roles');
  });
});
