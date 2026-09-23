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

export function computeFulfillStatus(
  items: Array<{ reserveQty: number; fulfillQty: number }>,
): OrderStatus {
  const anyFilled = items.some((i) => i.fulfillQty > 0);
  if (!anyFilled) return ORDER_STATUS.PENDING_FULFILL;
  const allDone = items.every((i) => i.fulfillQty >= i.reserveQty);
  return allDone ? ORDER_STATUS.FULFILLED : ORDER_STATUS.PARTIAL_FULFILL;
}
