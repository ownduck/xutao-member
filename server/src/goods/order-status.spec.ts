import { describe, expect, it } from 'vitest';
import {
  CANCEL_STATUS,
  CANCELABLE_STATUSES,
  ORDER_STATUS,
  canCancelOrder,
  computeFulfillStatus,
} from './order-status.js';

describe('canCancelOrder', () => {
  it('allows reserving / pending_fulfill when not cancelled', () => {
    expect(canCancelOrder(ORDER_STATUS.RESERVING, CANCEL_STATUS.NORMAL)).toBe(
      true,
    );
    expect(
      canCancelOrder(ORDER_STATUS.PENDING_FULFILL, CANCEL_STATUS.NORMAL),
    ).toBe(true);
  });

  it('rejects cancelled or non-cancelable statuses', () => {
    expect(
      canCancelOrder(ORDER_STATUS.RESERVING, CANCEL_STATUS.CANCELLED),
    ).toBe(false);
    expect(
      canCancelOrder(ORDER_STATUS.PARTIAL_FULFILL, CANCEL_STATUS.NORMAL),
    ).toBe(false);
    expect(canCancelOrder(ORDER_STATUS.FULFILLED, CANCEL_STATUS.NORMAL)).toBe(
      false,
    );
    expect(canCancelOrder(ORDER_STATUS.COMPLETED, CANCEL_STATUS.NORMAL)).toBe(
      false,
    );
  });

  it('CANCELABLE_STATUSES matches product rule', () => {
    expect(CANCELABLE_STATUSES).toEqual([
      ORDER_STATUS.RESERVING,
      ORDER_STATUS.PENDING_FULFILL,
    ]);
  });
});

describe('computeFulfillStatus', () => {
  it('maps fulfill qty to pending / partial / fulfilled', () => {
    expect(
      computeFulfillStatus([
        { reserveQty: 2, fulfillQty: 0 },
        { reserveQty: 1, fulfillQty: 0 },
      ]),
    ).toBe(ORDER_STATUS.PENDING_FULFILL);
    expect(
      computeFulfillStatus([
        { reserveQty: 2, fulfillQty: 1 },
        { reserveQty: 1, fulfillQty: 0 },
      ]),
    ).toBe(ORDER_STATUS.PARTIAL_FULFILL);
    expect(
      computeFulfillStatus([
        { reserveQty: 2, fulfillQty: 2 },
        { reserveQty: 1, fulfillQty: 1 },
      ]),
    ).toBe(ORDER_STATUS.FULFILLED);
  });
});
