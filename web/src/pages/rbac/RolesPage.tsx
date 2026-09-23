import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tree,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { DataNode } from 'antd/es/tree'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type RbacPermission,
  type RbacRole,
} from '../../lib/api'
import { useAuth } from '../../lib/auth-context'

type PermMode = 'rw' | 'ro'

function flattenPermissions(list: RbacPermission[]): RbacPermission[] {
  const out: RbacPermission[] = []
  const walk = (items: RbacPermission[]) => {
    for (const item of items) {
      out.push(item)
      if (item.children?.length) walk(item.children)
    }
  }
  walk(list)
  return out
}

function buildTreeFromFlat(list: RbacPermission[]): RbacPermission[] {
  if (list.some((p) => p.children?.length)) return list
  const byParent = new Map<number | null, RbacPermission[]>()
  for (const p of list) {
    const parent = p.parentPermissionId ?? null
    const arr = byParent.get(parent) ?? []
    arr.push({ ...p, children: [] })
    byParent.set(parent, arr)
  }
  const attach = (parentId: number | null): RbacPermission[] => {
    const nodes = (byParent.get(parentId) ?? []).sort(
      (a, b) => (a.sort ?? 0) - (b.sort ?? 0),
    )
    return nodes.map((n) => ({
      ...n,
      children: attach(n.permissionId),
    }))
  }
  return attach(null)
}

function toTreeData(nodes: RbacPermission[]): DataNode[] {
  return nodes.map((n) => ({
    key: n.permissionId,
    title: `${n.name}${n.code ? ` (${n.code})` : ''}`,
    children: n.children?.length ? toTreeData(n.children) : undefined,
  }))
}

export function RolesPage() {
  const { can } = useAuth()
  const canWrite = can('role_config', 'rw')

  const [loading, setLoading] = useState(false)
  const [roles, setRoles] = useState<RbacRole[]>([])
  const [permTree, setPermTree] = useState<RbacPermission[]>([])

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editing, setEditing] = useState<RbacRole | null>(null)
  const [editForm] = Form.useForm<{
    name: string
    description?: string
    key?: string
  }>()

  const [permOpen, setPermOpen] = useState(false)
  const [permLoading, setPermLoading] = useState(false)
  const [currentRole, setCurrentRole] = useState<RbacRole | null>(null)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [modeMap, setModeMap] = useState<Record<number, PermMode>>({})

  const flatPerms = useMemo(() => flattenPermissions(permTree), [permTree])
  const treeData = useMemo(() => toTreeData(permTree), [permTree])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [roleList, permList] = await Promise.all([
        api.listRoles(),
        api.listPermissions(),
      ])
      setRoles(Array.isArray(roleList) ? roleList : [])
      const raw = Array.isArray(permList) ? permList : []
      setPermTree(buildTreeFromFlat(raw))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载角色失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    editForm.resetFields()
    setEditOpen(true)
  }

  function openEdit(role: RbacRole) {
    setEditing(role)
    editForm.setFieldsValue({
      name: role.name,
      description: role.description ?? undefined,
      key: role.key ?? undefined,
    })
    setEditOpen(true)
  }

  async function handleSaveRole() {
    try {
      const values = await editForm.validateFields()
      setEditLoading(true)
      if (editing) {
        await api.updateRole(editing.roleId, values)
        message.success('角色已更新')
      } else {
        await api.createRole(values)
        message.success('角色已创建')
      }
      setEditOpen(false)
      await load()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setEditLoading(false)
    }
  }

  async function openPermissions(role: RbacRole) {
    setCurrentRole(role)
    setPermOpen(true)
    setPermLoading(true)
    try {
      const data = await api.getRolePermissions(role.roleId)
      const rw = data.permissionIds ?? []
      const ro = data.readOnlyPermissionIds ?? []
      const checked = Array.from(new Set([...rw, ...ro]))
      const modes: Record<number, PermMode> = {}
      for (const id of rw) modes[id] = 'rw'
      for (const id of ro) modes[id] = modes[id] === 'rw' ? 'rw' : 'ro'
      setCheckedIds(checked)
      setModeMap(modes)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载权限失败')
      setCheckedIds([])
      setModeMap({})
    } finally {
      setPermLoading(false)
    }
  }

  async function handleSavePermissions() {
    if (!currentRole) return
    setPermLoading(true)
    try {
      const permissionIds = checkedIds.filter((id) => modeMap[id] !== 'ro')
      const readOnlyPermissionIds = checkedIds.filter(
        (id) => modeMap[id] === 'ro',
      )
      await api.setRolePermissions(currentRole.roleId, {
        permissionIds,
        readOnlyPermissionIds,
      })
      message.success('权限已保存')
      setPermOpen(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存权限失败')
    } finally {
      setPermLoading(false)
    }
  }

  function handleDelete(role: RbacRole) {
    Modal.confirm({
      title: '确认删除该角色？',
      content: role.name,
      okType: 'danger',
      onOk: async () => {
        try {
          await api.deleteRole(role.roleId)
          message.success('已删除')
          await load()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败')
        }
      },
    })
  }

  const columns: ColumnsType<RbacRole> = [
    { title: '角色名', dataIndex: 'name', key: 'name' },
    {
      title: 'Key',
      dataIndex: 'key',
      key: 'key',
      render: (v) => v || '—',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v) => v || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'createTime',
      key: 'createTime',
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      render: (_, row) => (
        <Space>
          <Button type="link" onClick={() => void openPermissions(row)}>
            设置权限
          </Button>
          {canWrite ? (
            <Button type="link" onClick={() => openEdit(row)}>
              修改
            </Button>
          ) : null}
          {canWrite ? (
            <Button type="link" danger onClick={() => handleDelete(row)}>
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]

  const selectedLeaves = checkedIds.filter((id) => {
    const node = flatPerms.find((p) => p.permissionId === id)
    return node && !(node.children && node.children.length)
  })

  return (
    <>
      <Card
        title="角色"
        extra={
          canWrite ? (
            <Button type="primary" onClick={openCreate}>
              添加角色
            </Button>
          ) : null
        }
      >
        <Table
          rowKey="roleId"
          loading={loading}
          columns={columns}
          dataSource={roles}
          pagination={false}
        />
      </Card>

      <Modal
        title={editing ? '修改角色' : '添加角色'}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => void handleSaveRole()}
        confirmLoading={editLoading}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="角色名"
            rules={[{ required: true, message: '请输入角色名' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="key"
            label="Key"
            extra="可选；不填则按角色名拼音生成。经销商/运营请使用 dealer / ops"
          >
            <Input placeholder="如 dealer、ops" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`设置权限${currentRole ? ` — ${currentRole.name}` : ''}`}
        open={permOpen}
        onCancel={() => setPermOpen(false)}
        onOk={() => void handleSavePermissions()}
        confirmLoading={permLoading}
        width={720}
        destroyOnHidden
        okButtonProps={{ disabled: !canWrite }}
      >
        <Tree
          checkable
          defaultExpandAll
          treeData={treeData}
          checkedKeys={checkedIds}
          onCheck={(keys) => {
            const next = (Array.isArray(keys) ? keys : keys.checked).map(
              Number,
            )
            setCheckedIds(next)
            setModeMap((prev) => {
              const copy = { ...prev }
              for (const id of next) {
                if (!copy[id]) copy[id] = 'rw'
              }
              for (const id of Object.keys(copy).map(Number)) {
                if (!next.includes(id)) delete copy[id]
              }
              return copy
            })
          }}
        />

        {selectedLeaves.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 8, color: '#677489', fontSize: 13 }}>
              已选权限读写级别（默认读写；可改为只读）
            </div>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {selectedLeaves.map((id) => {
                const node = flatPerms.find((p) => p.permissionId === id)
                if (!node) return null
                return (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      background: '#fafafa',
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    <span>
                      {node.name}
                      <span style={{ color: '#999', marginLeft: 8 }}>
                        {node.code}
                      </span>
                    </span>
                    <Radio.Group
                      size="small"
                      value={modeMap[id] ?? 'rw'}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setModeMap((prev) => ({
                          ...prev,
                          [id]: e.target.value as PermMode,
                        }))
                      }
                      options={[
                        { label: '读写', value: 'rw' },
                        { label: '只读', value: 'ro' },
                      ]}
                      optionType="button"
                    />
                  </div>
                )
              })}
            </Space>
          </div>
        ) : null}
      </Modal>
    </>
  )
}

