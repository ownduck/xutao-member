export const ORDER_STATUS = {
  RESERVING: 'reserving',
  PENDING_FULFILL: 'pending_fulfill',
  PARTIAL_FULFILL: 'partial_fulfill',
  FULFILLED: 'fulfilled',
  COMPLETED: 'completed',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const RESERVE_LIST_STATUSES: OrderStatus[] = [
  ORDER_STATUS.RESERVING,
  ORDER_STATUS.PENDING_FULFILL,
  ORDER_STATUS.PARTIAL_FULFILL,
  ORDER_STATUS.FULFILLED,
];

export const FULFILL_LIST_STATUSES: OrderStatus[] = [
  ORDER_STATUS.PENDING_FULFILL,
  ORDER_STATUS.PARTIAL_FULFILL,
  ORDER_STATUS.FULFILLED,
];

export const HISTORY_LIST_STATUSES: OrderStatus[] = [ORDER_STATUS.COMPLETED];

/** 0=正常 1=已取消 */
export const CANCEL_STATUS = {
  NORMAL: 0,
  CANCELLED: 1,
} as const;

/** 预约列表中允许取消的业务状态 */
export const CANCELABLE_STATUSES: OrderStatus[] = [
  ORDER_STATUS.RESERVING,
  ORDER_STATUS.PENDING_FULFILL,
];

export function canCancelOrder(
  status: string,
  cancelStatus: number | null | undefined,
): boolean {
  if (Number(cancelStatus) === CANCEL_STATUS.CANCELLED) return false;
  return CANCELABLE_STATUSES.includes(status as OrderStatus);
}

export function computeFulfillStatus(
  items: Array<{ reserveQty: number; fulfillQty: number }>,
): OrderStatus {
  const anyFilled = items.some((i) => i.fulfillQty > 0);
  if (!anyFilled) return ORDER_STATUS.PENDING_FULFILL;
  const allDone = items.every((i) => i.fulfillQty >= i.reserveQty);
  return allDone ? ORDER_STATUS.FULFILLED : ORDER_STATUS.PARTIAL_FULFILL;
}
