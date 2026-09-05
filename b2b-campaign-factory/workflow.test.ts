import { describe, expect, test } from 'bun:test'
import type { HTTPPayload, TeeRuntime } from '@chainlink/cre-sdk'
import { onHTTPTrigger, type Config, type Request } from './workflow'

const API_TOKEN = 'test-token'

// Config with the 3 demo campaigns:
//  A (id 1): fixed $5 discount, min spend $20, no caps.
//  B (id 2): 20% cashback, Tue+Thu, $50/user cap, resets weekly Mon 04:00 UTC.
//  C (id 3): $15 min spend -> Digital Merchandise "White Bear Plushie Medium", total cap 200.
const makeConfig = (): Config => ({
	campaigns: {
		'1': {
			campaignId: 1,
			rewardType: 'discount',
			minSpend: 20,
			discountType: 'fixed',
			discountValue: 5,
			start: 1700000000,
			end: 1800000000,
			escrow: '0x0000000000000000000000000000000000000001',
		},
		'2': {
			campaignId: 2,
			rewardType: 'cashback',
			minSpend: 0,
			rateBps: 2000,
			cap: 50,
			capPeriod: 'Week',
			capPeriodCount: 1,
			capResetBasis: 'Calendar',
			capResetWeekday: 1,
			capResetTime: '04:00',
			daysOfWeek: 10, // Tue (bit1) + Thu (bit3)
			start: 1700000000,
			end: 1800000000,
			escrow: '0x0000000000000000000000000000000000000002',
		},
		'3': {
			campaignId: 3,
			rewardType: 'digital',
			minSpend: 15,
			digitalName: 'White Bear Plushie Medium',
			totalRedeemCap: 200,
			start: 1700000000,
			end: 1800000000,
			escrow: '0x0000000000000000000000000000000000000003',
		},
	},
})

// Build an HTTP payload from a request object (JSON-encoded into the .input bytes).
const makePayload = (request: Request): HTTPPayload => ({
	input: new TextEncoder().encode(JSON.stringify(request)),
} as HTTPPayload)

// Minimal TeeRuntime slice the handler uses: config, getSecret, log, usingTheDons.
const makeFakeTeeRuntime = (config: Config) => {
	const logs: string[] = []
	const reports: unknown[] = []
	const runtime = {
		config,
		getSecret: (request: { id?: string }) => ({
			result: () => ({ id: request.id, value: API_TOKEN }),
		}),
		log: (message: string) => logs.push(message),
		usingTheDons: () => ({
			report: (input: unknown) => {
				reports.push(input)
				return { result: () => ({}) }
			},
		}),
	}
	return { runtime: runtime as unknown as TeeRuntime<Config>, logs, reports }
}

// A Monday 04:00 UTC-aligned timestamp inside the window. We'll build per-test timestamps.
const BASE = 1700000000
const WINDOW_START = 1700000000
const WINDOW_END = 1800000000

// Helper to build a request for a campaign with a chosen timestamp.
const req = (campaignId: number, amountSpent: number, timestamp: number, earnedInWindow = 0): Request => ({
	campaignId,
	userAnchor: '0x1234567890123456789012345678901234567890',
	merchantId: 'burgera',
	amountSpent,
	timestamp,
	earnedInWindow,
	items: ['burger', 'fries'],
})

describe('Campaign A — fixed $5 discount, min spend $20', () => {
	const config = makeConfig()
	const ts = WINDOW_START + 3600 // in window

	test('approves a $30 purchase: $5 fixed discount (>= min spend)', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		const result = onHTTPTrigger(runtime, makePayload(req(1, 30, ts)))
		expect(result).toContain('APPROVE')
		expect(result).toContain('points=5')
	})

	test('rejects a $19 purchase below min spend', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		expect(onHTTPTrigger(runtime, makePayload(req(1, 19, ts)))).toContain('below-min-spend')
	})

	test('rejects before campaign start', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		expect(onHTTPTrigger(runtime, makePayload(req(1, 30, WINDOW_START - 10)))).toContain('before-campaign-start')
	})

	test('rejects after campaign end', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		expect(onHTTPTrigger(runtime, makePayload(req(1, 30, WINDOW_END + 10)))).toContain('after-campaign-end')
	})

	test('no per-user or total cap: a very large purchase still gives $5', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		const result = onHTTPTrigger(runtime, makePayload(req(1, 5000, ts, 9999)))
		expect(result).toContain('APPROVE')
		expect(result).toContain('points=5') // fixed discount, unaffected by earnedInWindow
	})
})

describe('Campaign B — 20% cashback, Tue+Thu, $50/user cap weekly', () => {
	const config = makeConfig()

	// Pick a Tuesday (dayIndex 1) and a Thursday (dayIndex 3) timestamp in-window.
	// dayIndex = (floor(ts/86400) + 3) % 7. Find them by scanning.
	const findDay = (targetIndex: number) => {
		for (let ts = WINDOW_START; ts < WINDOW_END; ts += 86400) {
			const idx = (Math.floor(ts / 86400) + 3) % 7
			if (idx === targetIndex) return ts
		}
		throw new Error('day not found')
	}
	const tue = findDay(1)
	const thu = findDay(3)

	test('approves a $100 purchase on Tuesday: 20% cashback = $20', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		const result = onHTTPTrigger(runtime, makePayload(req(2, 100, tue)))
		expect(result).toContain('APPROVE')
		expect(result).toContain('points=20')
	})

	test('rejects a purchase on Monday (not allowed day)', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		const mon = findDay(0)
		expect(onHTTPTrigger(runtime, makePayload(req(2, 100, mon)))).toContain('not-allowed-day')
	})

	test('clamps at cap minus earnedInWindow (weekly reset cap)', () => {
		// cap 50, already earned 40 this window -> remaining 10; raw 20% of $100 = 20 -> clamped to 10
		const { runtime } = makeFakeTeeRuntime(config)
		const result = onHTTPTrigger(runtime, makePayload(req(2, 100, tue, 40)))
		expect(result).toContain('points=10')
	})

	test('after weekly rollover (earnedInWindow 0), user earns fresh up to cap', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		// raw 20% of $250 = 50, remaining 50 - 0 = 50 -> points 50
		const result = onHTTPTrigger(runtime, makePayload(req(2, 250, tue, 0)))
		expect(result).toContain('points=50')
	})

	test('rejects when the per-user cap is exhausted', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		expect(onHTTPTrigger(runtime, makePayload(req(2, 100, tue, 50)))).toContain('cap-exhausted')
	})
})

describe('Campaign C — $15 min spend -> Digital Merchandise (NFT), total cap 200', () => {
	const config = makeConfig()
	const ts = WINDOW_START + 3600

	test('approves a $20 purchase: eligible for the White Bear Plushie Medium', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		const result = onHTTPTrigger(runtime, makePayload(req(3, 20, ts)))
		expect(result).toContain('APPROVE')
		expect(result).toContain('points=1') // 1 NFT redemption
	})

	test('rejects a $14 purchase below the $15 min spend', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		expect(onHTTPTrigger(runtime, makePayload(req(3, 14, ts)))).toContain('below-min-spend')
	})

	test('approves regardless of earnedInWindow (digital, no per-user cap)', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		const result = onHTTPTrigger(runtime, makePayload(req(3, 20, ts, 1000)))
		expect(result).toContain('APPROVE')
		expect(result).toContain('points=1')
	})

	test('rejects before campaign start', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		expect(onHTTPTrigger(runtime, makePayload(req(3, 20, WINDOW_START - 10)))).toContain('before-campaign-start')
	})

	test('unknown campaignId throws', () => {
		const { runtime } = makeFakeTeeRuntime(config)
		expect(() => onHTTPTrigger(runtime, makePayload(req(99, 30, ts)))).toThrow(/Unknown campaignId/)
	})
})
