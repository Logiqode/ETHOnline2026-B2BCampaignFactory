import { describe, expect } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { initWorkflow, onCronTrigger, type Config } from './workflow'

const API_TOKEN = 'test-token'

// Campaign fixture matching config.staging.json (mock payload inside config).
const makeConfig = (overrides: Partial<Config> = {}): Config => ({
	schedule: '0 */1 * * * *',
	campaignId: 1,
	minSpend: 10,
	rateBps: 1000,
	cap: 20,
	start: 1700000000,
	end: 1800000000,
	workflowOwner: '0x0000000000000000000000000000000000000001',
	mockContractAddress: '0x0000000000000000000000000000000000000002',
	testPayload: {
		userAnchor: '0x1234567890123456789012345678901234567890',
		merchantId: 'burgera',
		amountSpent: 12.0,
		timestamp: 1757366400,
		items: ['burger', 'fries'],
	},
	...overrides,
})

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

describe('onCronTrigger — campaign eligibility', () => {
	test('APPROVEs an eligible purchase (>= minSpend, within window) and computes points', () => {
		const { runtime, reports, logs } = makeFakeTeeRuntime(makeConfig())

		const result = onCronTrigger(runtime)

		expect(result).toContain('APPROVE')
		expect(result).toContain('points=1.2') // 10% of $12
		expect(logs.some((l) => l.includes('eligibility: ok'))).toBe(true)
		// report is prepared (crossed back to DON) even though write is commented
		expect(reports).toHaveLength(1)
		expect(reports[0]).toMatchObject({
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
	})

	test('REJECTs below min-spend', () => {
		const { runtime } = makeFakeTeeRuntime(
			makeConfig({ testPayload: { ...makeConfig().testPayload, amountSpent: 5 } }),
		)
		expect(onCronTrigger(runtime)).toContain('REJECT')
		expect(onCronTrigger(runtime)).toContain('below-min-spend')
	})

	test('REJECTs before campaign start', () => {
		const { runtime } = makeFakeTeeRuntime(
			makeConfig({ testPayload: { ...makeConfig().testPayload, timestamp: 1600000000 } }),
		)
		expect(onCronTrigger(runtime)).toContain('before-campaign-start')
	})

	test('REJECTs after campaign end', () => {
		const { runtime } = makeFakeTeeRuntime(
			makeConfig({ testPayload: { ...makeConfig().testPayload, timestamp: 1900000000 } }),
		)
		expect(onCronTrigger(runtime)).toContain('after-campaign-end')
	})

	test('caps points at the per-user lifetime cap', () => {
		// rate 10% of $500 = $50, but cap is 20 → capped at 20
		const { runtime } = makeFakeTeeRuntime(
			makeConfig({ testPayload: { ...makeConfig().testPayload, amountSpent: 500 } }),
		)
		expect(onCronTrigger(runtime)).toContain('points=20')
	})

	test('logs the payload and secret length (debug)', () => {
		const { runtime, logs } = makeFakeTeeRuntime(makeConfig())
		onCronTrigger(runtime)
		expect(logs.some((l) => l.includes('secret loaded'))).toBe(true)
		expect(logs.some((l) => l.includes('payload:'))).toBe(true)
	})
})