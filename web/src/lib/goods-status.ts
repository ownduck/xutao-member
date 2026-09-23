export const GOODS_STATUS_LABEL: Record<string, { text: string; color: string }> =
  {
    reserving: { text: '预约中', color: 'blue' },
    pending_fulfill: { text: '待履约', color: 'orange' },
    partial_fulfill: { text: '部分履约', color: 'gold' },
    fulfilled: { text: '已履约', color: 'cyan' },
    completed: { text: '已完成', color: 'green' },
  }
