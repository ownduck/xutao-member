import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type RbacRole,
  type RbacUser,
} from '../../lib/api'
import { useAuth } from '../../lib/auth-context'

function genPassword(len = 12) {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  let out = ''
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

export function UsersPage() {
  const { can } = useAuth()
  const canWrite = can('user_config', 'rw')

  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<RbacUser[]>([])
  const [roles, setRoles] = useState<RbacRole[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm] = Form.useForm<{
    email: string
    password: string
    name: string
    realname?: string
  }>()

  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editForm] = Form.useForm<{
    name: string
    email: string
    realname?: string
  }>()

  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdForm] = Form.useForm<{ password: string }>()

  const [rolesOpen, setRolesOpen] = useState(false)
  const [rolesLoading, setRolesLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState<RbacUser | null>(null)
  const [roleIds, setRoleIds] = useState<number[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [userList, roleList] = await Promise.all([
        api.listUsers(),
        api.listRoles(),
      ])
      setUsers(Array.isArray(userList) ? userList : [])
      setRoles(Array.isArray(roleList) ? roleList : [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate() {
    try {
      const values = await createForm.validateFields()
      setCreateLoading(true)
      await api.createUser(values)
      message.success('用户已创建')
      setCreateOpen(false)
      createForm.resetFields()
      await load()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreateLoading(false)
    }
  }

  function openEdit(user: RbacUser) {
    setCurrentUser(user)
    editForm.setFieldsValue({
      name: user.name,
      email: user.email,
      realname: user.realname ?? undefined,
    })
    setEditOpen(true)
  }

  async function handleEdit() {
    if (!currentUser) return
    try {
      const values = await editForm.validateFields()
      setEditLoading(true)
      await api.updateUser(currentUser.id, values)
      message.success('修改成功')
      setEditOpen(false)
      await load()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(err instanceof Error ? err.message : '修改失败')
    } finally {
      setEditLoading(false)
    }
  }

  function openResetPassword(user: RbacUser) {
    setCurrentUser(user)
    pwdForm.setFieldsValue({ password: genPassword() })
    setPwdOpen(true)
  }

  async function handleResetPassword() {
    if (!currentUser) return
    try {
      const values = await pwdForm.validateFields()
      setPwdLoading(true)
      await api.resetUserPassword(currentUser.id, values.password)
      message.success('重置密码成功')
      setPwdOpen(false)
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(err instanceof Error ? err.message : '重置失败')
    } finally {
      setPwdLoading(false)
    }
  }

  function openAssignRoles(user: RbacUser) {
    setCurrentUser(user)
    setRoleIds((user.roles ?? []).map((r) => r.roleId))
    setRolesOpen(true)
  }

  async function handleAssignRoles() {
    if (!currentUser) return
    setRolesLoading(true)
    try {
      await api.setUserRoles(currentUser.id, roleIds)
      message.success('角色已更新')
      setRolesOpen(false)
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新角色失败')
    } finally {
      setRolesLoading(false)
    }
  }

  async function handleDelete(user: RbacUser) {
    Modal.confirm({
      title: '确认删除该用户？',
      content: user.email,
      okType: 'danger',
      onOk: async () => {
        try {
          await api.deleteUser(user.id)
          message.success('已删除')
          await load()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败')
        }
      },
    })
  }

  const columns: ColumnsType<RbacUser> = [
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '用户名', dataIndex: 'name', key: 'name' },
    {
      title: '姓名',
      dataIndex: 'realname',
      key: 'realname',
      render: (v) => v || '—',
    },
    {
      title: '角色',
      key: 'roles',
      render: (_, row) =>
        row.isSuperAdmin ? (
          <Tag color="red">超级管理员</Tag>
        ) : (
          <Space wrap size={[4, 4]}>
            {(row.roles ?? []).length
              ? (row.roles ?? []).map((r) => (
                  <Tag key={r.roleId}>{r.name}</Tag>
                ))
              : '—'}
          </Space>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_, row) =>
        row.isSuperAdmin ? (
          '—'
        ) : (
          <Space wrap size={[0, 0]}>
            {canWrite ? (
              <Button type="link" onClick={() => openEdit(row)}>
                修改
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="link" onClick={() => openResetPassword(row)}>
                重置密码
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="link" onClick={() => openAssignRoles(row)}>
                分配角色
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="link" danger onClick={() => void handleDelete(row)}>
                删除
              </Button>
            ) : null}
          </Space>
        ),
    },
  ]

  return (
    <>
      <Card
        title="管理员"
        extra={
          canWrite ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建用户
            </Button>
          ) : null
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={users}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        confirmLoading={createLoading}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item
            name="name"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="登录显示名" />
          </Form.Item>
          <Form.Item name="realname" label="姓名">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '至少 8 位' },
            ]}
          >
            <Input.Password placeholder="至少 8 位" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`修改用户${currentUser ? ` — ${currentUser.name}` : ''}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => void handleEdit()}
        confirmLoading={editLoading}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮件地址"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="realname" label="姓名">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码${currentUser ? ` — ${currentUser.name}` : ''}`}
        open={pwdOpen}
        onCancel={() => setPwdOpen(false)}
        onOk={() => {
          Modal.confirm({
            title: '确认重置该管理员密码？',
            onOk: () => handleResetPassword(),
          })
        }}
        confirmLoading={pwdLoading}
        destroyOnHidden
      >
        <Form form={pwdForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="用户名">
            <Input value={currentUser?.name} disabled />
          </Form.Item>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '至少 8 位' },
            ]}
          >
            <Input.Password
              placeholder="至少 8 位"
              addonAfter={
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() =>
                    pwdForm.setFieldsValue({ password: genPassword() })
                  }
                >
                  生成
                </Button>
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`分配角色${currentUser ? ` — ${currentUser.email}` : ''}`}
        open={rolesOpen}
        onCancel={() => setRolesOpen(false)}
        onOk={() => void handleAssignRoles()}
        confirmLoading={rolesLoading}
        destroyOnHidden
      >
        <Select
          mode="multiple"
          style={{ width: '100%', marginTop: 16 }}
          placeholder="选择角色"
          value={roleIds}
          onChange={(v) => setRoleIds(v)}
          options={roles.map((r) => ({
            label: r.name,
            value: r.roleId,
          }))}
        />
      </Modal>
    </>
  )
}

