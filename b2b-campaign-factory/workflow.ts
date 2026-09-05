import {
	cre,
	hexToBase64,
	text,
	type HTTPPayload,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

// ─── Campaign terms (per campaign) ─────────────────────────────
// Each campaign is one entry in the config `campaigns` map, selected by the
// HTTP payload's `campaignId`. A single workflow binary serves N campaigns.

const windowSchema = z.object({
	start: z.number().int().nonnegative(), // unix
	end: z.number().int().nonnegative(),   // unix
	escrow: z.string(),                    // the campaign's deployed CampaignEscrow (Base Sepolia)
})

const cashbackSchema = z.object({
	campaignId: z.number().int().nonnegative(),
	rewardType: z.literal('cashback'),
	minSpend: z.number().nonnegative().default(0),
	rateBps: z.number().int().positive(),    // e.g. 2000 = 20%
	cap: z.number().nonnegative(),           // per-user cap in reward units
	capPeriod: z.enum(['Lifetime', 'Year', 'Month', 'Week', 'Day']).default('Lifetime'),
	capPeriodCount: z.number().int().positive().default(1),
	capResetBasis: z.enum(['Rolling', 'Calendar']).default('Rolling'),
	capResetWeekday: z.number().int().min(0).max(6).optional(), // Week calendar: 0=Mon..6=Sun
	capResetDay: z.number().int().min(1).max(31).optional(),
	capResetMonth: z.number().int().min(1).max(12).optional(),
	capResetTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('00:00'),
	daysOfWeek: z.number().int().min(0).max(127).default(0), // bitmask 0=Mon..6=Sun; 0 = any day
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	escrow: z.string(),
})

const discountSchema = z.object({
	campaignId: z.number().int().nonnegative(),
	rewardType: z.literal('discount'),
	minSpend: z.number().nonnegative().default(0),
	discountType: z.enum(['percent', 'fixed']),
	discountValue: z.number().nonnegative(),
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	escrow: z.string(),
})

const digitalSchema = z.object({
	campaignId: z.number().int().nonnegative(),
	rewardType: z.literal('digital'),
	minSpend: z.number().nonnegative().default(0),
	digitalName: z.string(),
	totalRedeemCap: z.number().nonnegative(),
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	escrow: z.string(),
})

const campaignSchema = z.discriminatedUnion('rewardType', [cashbackSchema, discountSchema, digitalSchema])
type Campaign = z.infer<typeof campaignSchema>

// ─── Config Schema ──────────────────────────────────────────────
// `campaigns` is keyed by the campaignId as a string. Workflow plumbing is global.
export const configSchema = z.object({
	campaigns: z.record(z.string(), campaignSchema),
})
export type Config = z.infer<typeof configSchema>

// ─── HTTP Request Payload ───────────────────────────────────────
// The HTTP body selects a campaign and carries the POS purchase. `earnedInWindow`
// is the caller-computed amount the user already earned in the current reset window
// (0 when the window just rolled over) — the workflow clamps the cap against it.
const requestSchema = z.object({
	campaignId: z.number().int().nonnegative(),
	userAnchor: z.string(),              // Privy embedded wallet address (identity anchor)
	merchantId: z.string(),
	amountSpent: z.number().nonnegative(),
	timestamp: z.number().int().nonnegative(),
	earnedInWindow: z.number().nonnegative().default(0),
	items: z.array(z.string()).optional(),
})
export type Request = z.infer<typeof requestSchema>

// ─── Eligibility (deterministic, runs inside enclave) ─────────
function evaluate(request: Request, campaign: Campaign): { eligible: boolean; points: number; reason: string } {
	// 1. Date window
	if (request.timestamp < campaign.start) {
		return { eligible: false, points: 0, reason: 'before-campaign-start' }
	}
	if (request.timestamp > campaign.end) {
		return { eligible: false, points: 0, reason: 'after-campaign-end' }
	}
	// 2. Minimum spend
	if (request.amountSpent < campaign.minSpend) {
		return { eligible: false, points: 0, reason: 'below-min-spend' }
	}

	// 3. Reward mechanic
	if (campaign.rewardType === 'discount') {
		// A discount is an amount off the price, reported as the reward.
		const discount =
			campaign.discountType === 'percent'
				? (campaign.discountValue / 100) * request.amountSpent
				: campaign.discountValue
		return { eligible: true, points: discount, reason: 'ok' }
	}

	if (campaign.rewardType === 'digital') {
		// Digital merchandise: the reward is the NFT (points = 1 redemption), gated by
		// min-spend. totalRedeemCap is enforced by the caller/escrow; the workflow
		// confirms eligibility and reports 1 unit.
		return { eligible: true, points: 1, reason: 'ok' }
	}

	// cashback
	// 3a. Day-of-week gate (bitmask 0=Mon..6=Sun). UTC weekday from timestamp.
	if (campaign.daysOfWeek !== 0) {
		const dayIndex = ((Math.floor(request.timestamp / 86400) + 3) % 7) // 0=Mon..6=Sun (epoch was Thu)
		if (((campaign.daysOfWeek >> dayIndex) & 1) !== 1) {
			return { eligible: false, points: 0, reason: 'not-allowed-day' }
		}
	}
	// 3b. Cashback = rate% of spend, clamped at cap - earnedInWindow.
	const raw = (campaign.rateBps / 10_000) * request.amountSpent
	const remaining = campaign.cap - (request.earnedInWindow ?? 0)
	const points = Math.min(raw, Math.max(remaining, 0))
	if (points <= 0) {
		return { eligible: false, points: 0, reason: 'cap-exhausted' }
	}
	return { eligible: true, points, reason: 'ok' }
}

// Convert a reward amount to wei (1e18) as a bigint.
function pointsToWei(points: number): bigint {
	const scaled = Math.round(points * 1e18)
	return BigInt(scaled.toLocaleString('en-US', { useGrouping: false }))
}

// ─── HTTP Trigger Handler (runs inside the enclave) ────────────
export const onHTTPTrigger = (runtime: TeeRuntime<Config>, payload: HTTPPayload): string => {
	const config = runtime.config

	if (!payload.input || payload.input.length === 0) {
		throw new Error('HTTP trigger payload is required')
	}

	// Load a secret inside the enclave (Vault DON) — never log its value.
	const apiToken = runtime.getSecret({ id: 'API_TOKEN' }).result().value
	runtime.log(`secret loaded (${apiToken.length} chars)`)

	// Parse the request body (decode the bytes input).
	const request = requestSchema.parse(JSON.parse(Buffer.from(payload.input).toString('utf8')))
	runtime.log(
		`payload: campaign=${request.campaignId} user=${request.userAnchor} merchant=${request.merchantId}` +
			` amount=${request.amountSpent} ts=${request.timestamp} earnedInWindow=${request.earnedInWindow}`,
	)

	// Look up the campaign this payload is for.
	const campaign = config.campaigns[String(request.campaignId)]
	if (!campaign) {
		throw new Error(`Unknown campaignId: ${request.campaignId}`)
	}

	// Evaluate eligibility inside the enclave.
	const verdict = evaluate(request, campaign)
	runtime.log(`eligibility: ${verdict.reason} eligible=${verdict.eligible} points=${verdict.points}`)

	// Cross back to the DON for consensus; build a report (write is commented until
	// the receiver contract is deployed on Base Sepolia).
	const donRuntime = runtime.usingTheDons()
	const reportPayload = encodeAbiParameters(
		parseAbiParameters('bool eligible, uint256 points'),
		[verdict.eligible, pointsToWei(verdict.points)],
	)
	donRuntime
		.report({
			encodedPayload: hexToBase64(reportPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	runtime.log(`report-ready (not written): ${hexToBase64(reportPayload).slice(0, 32)}...`)

	return `${verdict.eligible ? 'APPROVE' : 'REJECT'} points=${verdict.points} reason=${verdict.reason}`
}

// ─── Workflow Init (HTTP trigger) ──────────────────────────────
export function initWorkflow(config: Config) {
	const httpTrigger = new cre.capabilities.HTTPCapability()

	return [
		cre.handlerInTee(httpTrigger.trigger({}), onHTTPTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
