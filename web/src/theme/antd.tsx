import { App, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { PropsWithChildren } from 'react'

export function AntdProvider({ children }: PropsWithChildren) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#df3c19',
          colorInfo: '#df3c19',
          colorSuccess: '#177245',
          colorWarning: '#b76e11',
          colorError: '#b42318',
          borderRadius: 12,
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  )
}
