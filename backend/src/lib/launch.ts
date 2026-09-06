import { randomBytes } from 'node:crypto'
import { z } from 'zod'

// ─── Constants mirrored from contracts/src/CampaignFactory.sol ──────────────
// MIN_OPERATING_DEPOSIT = 0.01 ether; fee split is in basis points (0-10000).
export const MIN_OPERATING_DEPOSIT = 0.01 // demo constant (ETH)
export const MIN_OPERATING_WEI = BigInt(10_000_000_000_000_000) // 0.01 ether, wei
export const MAX_FEE_SPLIT_BPS = 10_000

// ─── Zod schema (mirror the contract's createCampaign boundary) ─────────────
// The workflow/wizard state is JSONB; only the launch-relevant fields are
// validated at the boundary. `feeSplitBps` is Company A's share; Company B
// receives the remainder (matches the contract's _splitDeposit).
export const campaignSchema = z.object({
  name: z.string().min(1).max(200),
  rewardType: z.enum(['monetary', 'digital', 'physical']).default('monetary'),
  mechanics: z.record(z.string(), z.unknown()).default({}),
  terms: z.record(z.string(), z.unknown()).default({}),
  rules: z.record(z.string(), z.unknown()).default({}),
  feeSplitBps: z.number().int().min(0).max(MAX_FEE_SPLIT_BPS).default(5000),
  companyA: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),
  companyB: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),
  companyAName: z.string().default(''),
  companyBName: z.string().default(''),
})

export type CampaignInput = z.infer<typeof campaignSchema>

// ─── Launch validation (mirrors CampaignFactory.createCampaign) ─────────────
// Order matters and matches the contract:
//   1. feeSplit bps check      (CampaignFactory__InvalidFeeSplit)
//   2. fee-account zero check  (CampaignFactory__InvalidFeeAccount)
//   3. deposit check           (CampaignFactory__DepositRequired)
// The deposit is the demo constant (0.01 ether, in wei) — real settlement deferred.
export interface LaunchInput {
  feeSplitBps: number
  companyA: string
  companyB: string
  operatingDepositWei?: bigint
}

export function validateLaunch(input: LaunchInput): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(input.feeSplitBps) || input.feeSplitBps < 0 || input.feeSplitBps > MAX_FEE_SPLIT_BPS) {
    return { ok: false, error: `InvalidFeeSplit: ${input.feeSplitBps} (must be 0-${MAX_FEE_SPLIT_BPS} bps)` }
  }
  const a = input.companyA.toLowerCase()
  const b = input.companyB.toLowerCase()
  if (a === '0x0000000000000000000000000000000000000000' || b === '0x0000000000000000000000000000000000000000') {
    return { ok: false, error: 'InvalidFeeAccount: company A and B fee accounts must be non-zero' }
  }
  const depositWei = input.operatingDepositWei ?? MIN_OPERATING_WEI
  if (depositWei !== MIN_OPERATING_WEI) {
    return { ok: false, error: `OperatingDeposit: companies owe exactly ${MIN_OPERATING_DEPOSIT} ETH combined (A ${input.feeSplitBps} bps, B the rest), got ${Number(depositWei) / 1e18}` }
  }
  return { ok: true }
}

// ─── Reward earn calculation (mirrors CampaignEscrow earn semantics) ─────────
// Pure function so the wizard's cap logic is testable backend-side. A user's
// earn on a single purchase is:
//   1. rate% of the purchase
//   2. capped per transaction when perTxCap is set
//   3. capped cumulatively by the remaining per-user budget (per-user cap
//      minus everything already earned)
// Both caps are optional; caps never go negative, and 0 remaining budget means
// the user earns nothing.
export interface EarnParams {
  purchaseAmount: number
  rateBps: number // 0-10000 (cashbackRate% × 100)
  perTxCap?: number | null
  perUserCap?: number | null
  alreadyEarned?: number
}

export function calculateRewardEarn(p: EarnParams): number {
  let earn = (p.purchaseAmount * p.rateBps) / 10_000
  if (p.perTxCap != null) earn = Math.min(earn, p.perTxCap)
  if (p.perUserCap != null) {
    const remaining = Math.max(0, p.perUserCap - (p.alreadyEarned ?? 0))
    earn = Math.min(earn, remaining)
  }
  return Math.max(0, earn)
}

// ─── Salt generation ────────────────────────────────────────────────────────
// The smart contract uses a CREATE2 salt for deterministic escrow addresses.
// Backend generates a 32-byte random salt at launch (same shape the contract
// accepts); the on-chain createCampaign wiring is still pending deployment, so
// the salt is stored now and consumed when that wiring lands.
export function generateSalt(): string {
  return '0x' + randomBytes(32).toString('hex')
}

// ─── Row → API shape (JSONB comes back as an object) ────────────────────────
export interface CampaignRow {
  id: number
  name: string
  status: 'draft' | 'launched'
  reward_type: 'monetary' | 'digital' | 'physical'
  mechanics: Record<string, unknown>
  terms: Record<string, unknown>
  rules: Record<string, unknown>
  fee_split_bps: number
  company_a: string
  company_b: string
  company_a_name: string
  company_b_name: string
  operating_deposit: bigint | string | number
  salt: string | null
  escrow_address: string | null
  reward_address: string | null
  created_at: Date
  launched_at: Date | null
}

export interface CampaignApi extends Omit<CampaignRow, 'operating_deposit' | 'created_at' | 'launched_at'> {
  operatingDepositWei: string
  createdAt: string
  launchedAt: string | null
}

export function toApi(row: CampaignRow): CampaignApi {
  const { operating_deposit, created_at, launched_at, ...rest } = row
  return {
    ...rest,
    operatingDepositWei: operating_deposit.toString(),
    createdAt: created_at.toISOString(),
    launchedAt: launched_at ? launched_at.toISOString() : null,
  }
}