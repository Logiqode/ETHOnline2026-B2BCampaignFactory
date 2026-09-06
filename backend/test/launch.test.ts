import { describe, expect, test } from 'bun:test'
import {
  MAX_FEE_SPLIT_BPS,
  MIN_OPERATING_DEPOSIT,
  MIN_OPERATING_WEI,
  calculateRewardEarn,
  generateSalt,
  validateLaunch,
} from '../src/lib/launch'

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'

describe('validateLaunch (mirrors CampaignFactory.createCampaign)', () => {
  test('accepts a valid fee split + non-zero fee accounts + sufficient deposit', () => {
    expect(validateLaunch({ feeSplitBps: 2500, companyA: A, companyB: B, operatingDepositWei: MIN_OPERATING_WEI })).toEqual({ ok: true })
  })

  test('fee split must be an integer in [0, 10000]', () => {
    expect(validateLaunch({ feeSplitBps: -1, companyA: A, companyB: B }).ok).toBe(false)
    expect(validateLaunch({ feeSplitBps: MAX_FEE_SPLIT_BPS + 1, companyA: A, companyB: B }).ok).toBe(false)
    expect(validateLaunch({ feeSplitBps: 1.5, companyA: A, companyB: B }).ok).toBe(false)
  })

  test('zero fee account is rejected (company A or B)', () => {
    const ZERO = '0x0000000000000000000000000000000000000000'
    expect(validateLaunch({ feeSplitBps: 5000, companyA: ZERO, companyB: B }).ok).toBe(false)
    expect(validateLaunch({ feeSplitBps: 5000, companyA: A, companyB: ZERO }).ok).toBe(false)
  })

  test('deposit below the required amount is rejected', () => {
    expect(validateLaunch({ feeSplitBps: 5000, companyA: A, companyB: B, operatingDepositWei: MIN_OPERATING_WEI - 1n }).ok).toBe(false)
  })

  test('deposit above the required amount is rejected (owed amount is exact, not >=)', () => {
    expect(validateLaunch({ feeSplitBps: 5000, companyA: A, companyB: B, operatingDepositWei: MIN_OPERATING_WEI * 2n }).ok).toBe(false)
  })

  test('defaults to the minimum deposit when not provided', () => {
    expect(validateLaunch({ feeSplitBps: 5000, companyA: A, companyB: B }).ok).toBe(true)
  })

  test('constant sanity', () => {
    expect(MIN_OPERATING_DEPOSIT).toBe(0.01)
    expect(MIN_OPERATING_WEI).toBe(10_000_000_000_000_000n)
  })
})

describe('generateSalt', () => {
  test('returns a 32-byte 0x-hex string unique per call', () => {
    const s1 = generateSalt()
    const s2 = generateSalt()
    expect(s1).toMatch(/^0x[0-9a-f]{64}$/)
    expect(s1).not.toBe(s2)
  })
})

describe('calculateRewardEarn (per-tx cap × per-user cap interplay)', () => {
  // 10% cashback on a $100 purchase = 10 points (rateBps = 1000).
  const rate10 = 1000

  test('uncapped earn is rate% of the purchase', () => {
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: rate10 })).toBe(10)
    expect(calculateRewardEarn({ purchaseAmount: 50, rateBps: 500 })).toBe(2.5)
  })

  test('per-tx cap truncates a single large purchase', () => {
    // 10% of $500 = 50, but per-tx cap 20 → 20.
    expect(calculateRewardEarn({ purchaseAmount: 500, rateBps: rate10, perTxCap: 20 })).toBe(20)
  })

  test('per-tx cap never boosts a small earn', () => {
    // 10% of $100 = 10; cap 20 is not reached → still 10.
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: rate10, perTxCap: 20 })).toBe(10)
  })

  test('per-user cap truncates when the lifetime budget is partially spent', () => {
    // 10 earn, budget 100, already earned 95 → only 5 remains.
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: rate10, perUserCap: 100, alreadyEarned: 95 })).toBe(5)
  })

  test('exhausted per-user budget earns nothing (never negative)', () => {
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: rate10, perUserCap: 100, alreadyEarned: 100 })).toBe(0)
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: rate10, perUserCap: 100, alreadyEarned: 120 })).toBe(0)
  })

  test('both caps apply: the tightest constraint wins', () => {
    // 10% of $800 = 80; per-tx cap 30; remaining user budget 25 → 25.
    expect(
      calculateRewardEarn({ purchaseAmount: 800, rateBps: rate10, perTxCap: 30, perUserCap: 100, alreadyEarned: 75 }),
    ).toBe(25)
    // Same purchase but plenty of user budget left → per-tx cap 30 governs.
    expect(
      calculateRewardEarn({ purchaseAmount: 800, rateBps: rate10, perTxCap: 30, perUserCap: 100, alreadyEarned: 10 }),
    ).toBe(30)
  })

  test('disabled per-tx cap (null/undefined) is ignored', () => {
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: rate10, perTxCap: null })).toBe(10)
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: rate10, perTxCap: undefined, perUserCap: null })).toBe(10)
  })

  test('zero earn when rate is zero', () => {
    expect(calculateRewardEarn({ purchaseAmount: 100, rateBps: 0, perTxCap: 20, perUserCap: 100 })).toBe(0)
  })
})