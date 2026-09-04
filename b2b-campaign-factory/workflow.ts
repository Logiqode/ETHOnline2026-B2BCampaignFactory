import {
	cre,
	hexToBase64,
	ok,
	text,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

// ─── Config Schema ──────────────────────────────────────────────
// Campaign terms + workflow plumbing for the confidential eligibility handler.
export const configSchema = z.object({
	schedule: z.string(),
	// Campaign rules (static for v1; mirrored from CampaignEscrow terms)
	campaignId: z.number().int().nonnegative(),
	minSpend: z.number().nonnegative(),      // e.g. 10 (USD, integer dollars for demo)
	rateBps: z.number().int().positive(),    // e.g. 1000 = 10%
	cap: z.number().nonnegative(),           // per-user lifetime cap in reward units
	start: z.number().int().nonnegative(),   // unix
	end: z.number().int().nonnegative(),     // unix
	// Workflow plumbing
	workflowOwner: z.string(),               // EOA that CRE `evm.write` signs from
	mockContractAddress: z.string(),         // the deployed CampaignEscrow (Base Sepolia)
	// Mock POS payload (test-specific). In prod this arrives via request/HTTP.
	testPayload: z.object({
		userAnchor: z.string(),              // Privy embedded wallet address (identity anchor)
		merchantId: z.string(),
		amountSpent: z.number().nonnegative(),
		timestamp: z.number().int().nonnegative(),
		items: z.array(z.string()).optional(),
	}),
})
type Config = z.infer<typeof configSchema>

// ─── Campaign Eligibility (deterministic, runs inside enclave) ──
// Returns { eligible, points } where points is the reward to mint (capped).
function evaluateCampaign(payload: Config['testPayload'], config: Config): {
	eligible: boolean
	points: number
	reason: string
} {
	// 1. Date window
	if (payload.timestamp < config.start) {
		return { eligible: false, points: 0, reason: 'before-campaign-start' }
	}
	if (payload.timestamp > config.end) {
		return { eligible: false, points: 0, reason: 'after-campaign-end' }
	}
	// 2. Minimum spend
	if (payload.amountSpent < config.minSpend) {
		return { eligible: false, points: 0, reason: 'below-min-spend' }
	}
	// 3. Reward = rate * amountSpent (capped per-user lifetime)
	const points = Math.min(
		(config.rateBps / 10_000) * payload.amountSpent,
		config.cap,
	)
	return { eligible: true, points, reason: 'ok' }
}

// ─── TEE Cron Callback ─────────────────────────────────────────
// Runs inside the enclave. Logs are for simulation/testing only.
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config

	// ── Step 1: Load a secret inside the enclave (Vault DON) ──
	// For now we only log that it was fetched — never the value.
	const apiToken = runtime.getSecret({ id: 'API_TOKEN' }).result().value
	runtime.log(`secret loaded (${apiToken.length} chars)`)

	// ── Step 2: Read the mock POS payload from config (test json) ──
	const payload = config.testPayload
	runtime.log(
		`payload: userAnchor=${payload.userAnchor} merchant=${payload.merchantId}` +
			` amountSpent=${payload.amountSpent} ts=${payload.timestamp} items=${(payload.items ?? []).length}`,
	)

	// ── Step 3: Evaluate eligibility INSIDE the enclave ──
	const verdict = evaluateCampaign(payload, config)
	runtime.log(`eligibility: ${verdict.reason} eligible=${verdict.eligible} points=${verdict.points}`)

	// ── Step 4: Cross back to the DON for consensus + (future) on-chain write ──
	const donRuntime = runtime.usingTheDons()

	// For now: build the report payload but do NOT execute the write —
	// the receiver contract (which validates forwarder/author) isn't deployed yet.
	// Uncomment once CampaignEscrow / receiver is on Base Sepolia.
	//
	// const encodedPayload = encodeAbiParameters(
	//   parseAbiParameters('bytes32 nullifier, address recipient, uint256 amountSpent'),
	//   [nullifier, payeeWallet, BigInt(Math.round(verdict.points * 1e18))],
	// )
	// donRuntime.report({
	//   encodedPayload: hexToBase64(encodedPayload),
	//   encoderName: 'evm',
	//   signingAlgo: 'ecdsa',
	//   hashingAlgo: 'keccak256',
	// }).result()
	//
	// const txHash = new cre.capabilities.EVMClient()
	//   .writeReport(donRuntime, {
	//     receiver: config.mockContractAddress,
	//     report, // from report() above
	//     gasConfig: { gasLimit: 300_000n },
	//   })
	//   .result()

	const reportPayload = encodeAbiParameters(
			parseAbiParameters('bool eligible, uint256 points'),
			[verdict.eligible, BigInt(Math.round(verdict.points * 1e18))],
		)

		// Generate the signed report via the DON (harmless; does NOT write on-chain).
		// The on-chain `EVMClient.writeReport` is left commented until the receiver
		// contract (which validates forwarder/author) is deployed on Base Sepolia.
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

// ─── Workflow Init ─────────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}