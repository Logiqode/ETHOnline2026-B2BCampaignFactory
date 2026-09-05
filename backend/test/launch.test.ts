import { describe, expect, test } from 'bun:test'
import {
  MAX_FEE_SPLIT_BPS,
  MIN_OPERATING_DEPOSIT,
  MIN_OPERATING_WEI,
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

  test('deposit below the minimum is rejected', () => {
    expect(validateLaunch({ feeSplitBps: 5000, companyA: A, companyB: B, operatingDepositWei: MIN_OPERATING_WEI - 1n }).ok).toBe(false)
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