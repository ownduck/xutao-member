import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, expectStatus } from './helpers/assert.js';
import { ensureE2eApp } from './helpers/app.js';
import { api, SEED, signIn } from './helpers/auth.js';

type PermNode = { permissionId: number; children?: PermNode[] };

function walkPermIds(nodes: PermNode[] | undefined, out: number[] = []) {
  for (const n of nodes || []) {
    out.push(n.permissionId);
    if (n.children?.length) walkPermIds(n.children, out);
  }
  return out;
}

describe('rbac roles + permissions', () => {
  let admin = '';
  const stamp = Date.now().toString(36);
  let testRoleId = 0;

  beforeAll(async () => {
    await ensureE2eApp();
    admin = await signIn(SEED.admin.email, SEED.admin.password);
  });

  it('GET /api/rbac/permissions', async () => {
    const perms = await api('/api/rbac/permissions', admin);
    expectOk(perms);
  });

  it('roles CRUD + permissions bind', async () => {
    const list = await api('/api/rbac/roles', admin);
    expectOk(list);

    const created = await api('/api/rbac/roles', admin, {
      method: 'POST',
      body: JSON.stringify({
        name: `E2E角色${stamp}`,
        description: 'e2e',
        key: `e2e_${stamp}`,
      }),
    });
    expectOk(created, 'create role');
    testRoleId = (created.data as { roleId: number }).roleId;
    expect(testRoleId).toBeGreaterThan(0);

    const upd = await api(`/api/rbac/roles/${testRoleId}`, admin, {
      method: 'PUT',
      body: JSON.stringify({
        name: `E2E角色${stamp}_u`,
        description: 'x',
      }),
    });
    expectOk(upd, 'update role');

    const perms = await api('/api/rbac/permissions', admin);
    const ids = walkPermIds(perms.data as PermNode[]);
    const leaf = ids[ids.length - 1];
    expect(leaf).toBeTruthy();

    const setP = await api(`/api/rbac/roles/${testRoleId}/permissions`, admin, {
      method: 'PUT',
      body: JSON.stringify({
        permissionIds: [leaf],
        readOnlyPermissionIds: [],
      }),
    });
    expectOk(setP, 'set perms');

    const getP = await api(`/api/rbac/roles/${testRoleId}/permissions`, admin);
    expectOk(getP, 'get perms');

    const del = await api(`/api/rbac/roles/${testRoleId}`, admin, {
      method: 'DELETE',
    });
    expectOk(del, 'soft delete role');
    testRoleId = 0;
  });

  it('anonymous roles → 401/403', async () => {
    const res = await api('/api/rbac/roles', null);
    expectStatus(res, [401, 403]);
  });
});
