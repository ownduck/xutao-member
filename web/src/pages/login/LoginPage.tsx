import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Form, Input, Typography, message } from 'antd'
import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import loginBack from '../../assets/login-back.png'
import { signIn, useSession } from '../../lib/auth-client'
import { useAuth } from '../../lib/auth-context'

type LoginForm = {
  email: string
  password: string
  remember?: boolean
}

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: session, isPending } = useSession()
  const { refresh } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isPending && session?.user) {
    const redirect = searchParams.get('redirect') || '/dashboard'
    return <Navigate to={redirect} replace />
  }

  async function onFinish(values: LoginForm) {
    setLoading(true)
    setError(null)
    try {
      const result = await signIn.email({
        email: values.email.trim(),
        password: values.password,
        rememberMe: values.remember,
      })
      if (result.error) {
        setError(result.error.message || '登录失败')
        return
      }
      await refresh()
      message.success('登录成功')
      const redirect = searchParams.get('redirect') || '/dashboard'
      navigate(redirect, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div
        className="login-bg"
        style={{ backgroundImage: `url(${loginBack})` }}
      >
        <div className="login-row">
          <div className="login-left">
            <div className="brand-title">会员管理后台</div>
          </div>
          <div className="login-right">
            <Form<LoginForm>
              className="login-card"
              layout="vertical"
              requiredMark={false}
              initialValues={{ remember: true }}
              onFinish={(v) => void onFinish(v)}
            >
              <div className="card-title">登录</div>
              <div className="card-subtitle">
                请使用管理员分配的账号登录
              </div>

              <div className="card-body">
                {error ? (
                  <Alert
                    type="error"
                    showIcon
                    message={error}
                    style={{ marginBottom: 16 }}
                  />
                ) : null}

                <Form.Item
                  name="email"
                  rules={[
                    { required: true, message: '请输入邮箱' },
                    { type: 'email', message: '邮箱格式不正确' },
                  ]}
                >
                  <Input
                    size="large"
                    prefix={<UserOutlined />}
                    placeholder="邮箱"
                    autoComplete="username"
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  rules={[{ required: true, message: '请输入密码' }]}
                >
                  <Input.Password
                    size="large"
                    prefix={<LockOutlined />}
                    placeholder="密码"
                    autoComplete="current-password"
                  />
                </Form.Item>

                <div className="login-tip-row">
                  <Form.Item name="remember" valuePropName="checked" noStyle>
                    <Checkbox>自动登录</Checkbox>
                  </Form.Item>
                  <Typography.Text className="accent-link">
                    联系管理员
                  </Typography.Text>
                </div>

                <Form.Item style={{ marginBottom: 0, marginTop: 30 }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={loading}
                    className="login-submit"
                  >
                    登录
                  </Button>
                </Form.Item>
              </div>
            </Form>
          </div>
        </div>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          width: 100%;
        }
        .login-bg {
          min-height: 100vh;
          width: 100%;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
        }
        .login-row {
          display: flex;
          min-height: 100vh;
          width: 100%;
        }
        .login-left,
        .login-right {
          width: 50%;
          box-sizing: border-box;
        }
        .login-left {
          padding: 65px;
        }
        .brand-title {
          margin-top: 20px;
          font-weight: 600;
          font-size: 40px;
          color: #fff;
          letter-spacing: 1px;
        }
        .login-right {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .login-card {
          width: 436px;
          min-height: 528px;
          background: #fff;
          border-radius: 20px;
          box-sizing: border-box;
          padding: 63px 57px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        }
        .card-title {
          font-weight: 600;
          font-size: 40px;
          color: #000;
          line-height: 1.2;
        }
        .card-subtitle {
          margin-top: 30px;
          font-size: 12px;
          font-weight: 400;
          color: #999;
        }
        .card-body {
          margin-top: 75px;
        }
        .login-tip-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
        }
        .accent-link {
          color: #df3c19 !important;
          cursor: default;
          font-size: 12px;
        }
        .login-submit {
          border-radius: 3px !important;
          height: 44px;
          font-weight: 600;
        }
        @media (max-width: 900px) {
          .login-row {
            flex-direction: column;
          }
          .login-left,
          .login-right {
            width: 100%;
          }
          .login-left {
            padding: 40px 24px 0;
          }
          .brand-title {
            font-size: 28px;
          }
          .login-right {
            padding: 24px;
            align-items: flex-start;
          }
          .login-card {
            width: 100%;
            max-width: 436px;
            min-height: auto;
            padding: 40px 28px;
          }
          .card-title {
            font-size: 32px;
          }
          .card-body {
            margin-top: 40px;
          }
        }
      `}</style>
    </div>
  )
}

