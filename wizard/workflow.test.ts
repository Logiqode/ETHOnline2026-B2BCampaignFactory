import { describe, expect, test } from 'bun:test'
import { evaluate, type OnChainCampaign } from './workflow'

// Direct unit tests of the eligibility evaluator — pure logic, no runtime, no
// EVM mock. The on-chain read path (factory → terms) is verified by
// `cre workflow simulate` against the live Base Sepolia factory.
//
// NOTE: the export of `evaluate` is temporary scaffolding for these tests. If
// it gets un-exported, inline these cases back into the function's JSDoc.

const ts = 1700003600 // in-window timestamp (day index 3 = Thursday)

const base: OnChainCampaign = {
	escrow: '0x0000000000000000000000000000000000000001',
	rateBps: 1000, // 10%
	start: 1700000000,
	end: 1800000000,
	minSpend: 0,
	cap: 0,
	minSpendEnabled: false,
	capEnabled: false,
	dayOfWeekEnabled: false,
	daysOfWeek: 0,
}

const req = (amountSpent: number, timestamp = ts, earnedInWindow = 0) => ({
	campaignId: 1,
	userAnchor: '0x1234567890123456789012345678901234567890',
	merchantId: 'burgera',
	amountSpent,
	timestamp,
	earnedInWindow,
	items: ['burger'],
})

describe('evaluate — window gates', () => {
	test('rejects before campaign start', () => {
		const r = evaluate(req(100, base.start - 1), base)
		expect(r.eligible).toBe(false)
		expect(r.reason).toBe('before-campaign-start')
	})

	test('rejects after campaign end', () => {
		const r = evaluate(req(100, base.end + 1), base)
		expect(r.eligible).toBe(false)
		expect(r.reason).toBe('after-campaign-end')
	})

	test('approves at exact start boundary', () => {
		expect(evaluate(req(100, base.start), base).eligible).toBe(true)
	})

	test('approves at exact end boundary', () => {
		expect(evaluate(req(100, base.end), base).eligible).toBe(true)
	})
})

describe('evaluate — min spend gate', () => {
	const c = { ...base, minSpendEnabled: true, minSpend: 10 }

	test('rejects below min spend', () => {
		expect(evaluate(req(9.99), c).reason).toBe('below-min-spend')
	})

	test('approves at exactly min spend', () => {
		const r = evaluate(req(10), c)
		expect(r.eligible).toBe(true)
		expect(r.points).toBe(1) // 10% of $10
	})
})

describe('evaluate — cashback math + per-user cap', () => {
	test('uncapped: 10% of spend', () => {
		expect(evaluate(req(100), base).points).toBe(10)
		expect(evaluate(req(50), base).points).toBe(5)
	})

	test('cap clamps against remaining budget (cap - earnedInWindow)', () => {
		const c = { ...base, capEnabled: true, cap: 50 }
		// raw 20, remaining 50-40=10 → 10
		expect(evaluate(req(100, ts, 40), c).points).toBe(10)
		// raw 20, remaining 50 → 20
		expect(evaluate(req(100, ts, 0), c).points).toBe(20)
	})

	test('exhausted cap rejects (cap-exhausted, never negative)', () => {
		const c = { ...base, capEnabled: true, cap: 50 }
		expect(evaluate(req(100, ts, 50), c).reason).toBe('cap-exhausted')
		expect(evaluate(req(100, ts, 60), c).reason).toBe('cap-exhausted')
	})
})

describe('evaluate — day-of-week gate', () => {
	// ts is day index 3 (Thursday). Bit 3 = allowed.
	const tueThu = { ...base, dayOfWeekEnabled: true, daysOfWeek: 0b0001010 }

	test('approves on an allowed day (Thursday)', () => {
		const r = evaluate(req(100, tueThu.daysOfWeek !== undefined ? ts : ts), tueThu)
		expect(r.eligible).toBe(true)
	})

	test('rejects on a disallowed day (Monday)', () => {
		// find a Monday: dayIndex 0
		let mon = ts
		for (let i = 0; i < 7; i++) {
			if ((Math.floor(mon / 86400) + 3) % 7 === 0) break
			mon += 86400
		}
		expect(evaluate(req(100, mon), tueThu).reason).toBe('not-allowed-day')
	})

	test('day gate only filters within window — before start still rejects with window reason', () => {
		// Window check runs FIRST: a before-start timestamp must report the window
		// reason even on an allowed day (enforcement-order guarantee).
		const r = evaluate(req(100, base.start - 1), tueThu)
		expect(r.reason).toBe('before-campaign-start')
	})
})

describe('evaluate — combined constraints (tightest wins)', () => {
	test('cap + min spend both enforced', () => {
		const c = { ...base, minSpendEnabled: true, minSpend: 10, capEnabled: true, cap: 15 }
		// $200 spend: raw 20, remaining 15 → 15
		expect(evaluate(req(200), c).points).toBe(15)
	})
})
