import { Hono } from 'hono'
import { z } from 'zod'
import { sql } from '../db'
import {
  MIN_OPERATING_WEI,
  campaignSchema,
  generateSalt,
  toApi,
  validateLaunch,
  type CampaignRow,
} from '../lib/launch'
import { createCampaignOnChain, loadDeployment, usdToWei } from '../lib/onchain'
import type { Address, Hex } from 'viem'

export const campaigns = new Hono()

// postgres.js sql.json() expects its JSONValue union; our records are `unknown`-typed.
// Cast through a narrow helper so the DB still gets properly-encoded JSON.
const asJson = (v: Record<string, unknown>) => sql.json(v as never)

// POST /api/campaigns — create a draft campaign
campaigns.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const parsed = campaignSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400)
  }
  const v = parsed.data
  const rows = await sql<CampaignRow[]>`
    INSERT INTO campaigns (
      name, reward_type, mechanics, terms, rules,
      fee_split_bps, company_a, company_b, company_a_name, company_b_name,
      operating_deposit, status
    ) VALUES (
      ${v.name}, ${v.rewardType}, ${asJson(v.mechanics)}, ${asJson(v.terms)}, ${asJson(v.rules)},
      ${v.feeSplitBps}, ${v.companyA}, ${v.companyB}, ${v.companyAName}, ${v.companyBName},
      ${MIN_OPERATING_WEI.toString()}, 'draft'
    )
    RETURNING *
  `
  return c.json(toApi(rows[0]), 201)
})

// GET /api/campaigns — list campaigns
campaigns.get('/', async (c) => {
  const rows = await sql<CampaignRow[]>`SELECT * FROM campaigns ORDER BY id DESC`
  return c.json(rows.map(toApi))
})

// GET /api/campaigns/:id
campaigns.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid id' }, 400)
  }
  const rows = await sql<CampaignRow[]>`SELECT * FROM campaigns WHERE id = ${id}`
  if (rows.length === 0) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(toApi(rows[0]))
})

// PUT /api/campaigns/:id — update a draft
campaigns.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid id' }, 400)
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const parsed = campaignSchema.partial().safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400)
  }
  const v = parsed.data
  const existing = await sql<CampaignRow[]>`SELECT * FROM campaigns WHERE id = ${id}`
  if (existing.length === 0) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (existing[0].status === 'launched') {
    return c.json({ error: 'Cannot update a launched campaign' }, 409)
  }
  const merged = {
    name: v.name ?? existing[0].name,
    rewardType: v.rewardType ?? existing[0].reward_type,
    mechanics: v.mechanics ?? existing[0].mechanics,
    terms: v.terms ?? existing[0].terms,
    rules: v.rules ?? existing[0].rules,
    feeSplitBps: v.feeSplitBps ?? existing[0].fee_split_bps,
    companyA: v.companyA ?? existing[0].company_a,
    companyB: v.companyB ?? existing[0].company_b,
    companyAName: v.companyAName ?? existing[0].company_a_name,
    companyBName: v.companyBName ?? existing[0].company_b_name,
  }
  const rows = await sql<CampaignRow[]>`
    UPDATE campaigns SET
      name = ${merged.name},
      reward_type = ${merged.rewardType},
      mechanics = ${asJson(merged.mechanics)},
      terms = ${asJson(merged.terms)},
      rules = ${asJson(merged.rules)},
      fee_split_bps = ${merged.feeSplitBps},
      company_a = ${merged.companyA},
      company_b = ${merged.companyB},
      company_a_name = ${merged.companyAName},
      company_b_name = ${merged.companyBName}
    WHERE id = ${id}
    RETURNING *
  `
  return c.json(toApi(rows[0]))
})

// POST /api/campaigns/:id/launch — validate + salt + mark launched
campaigns.post('/:id/launch', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid id' }, 400)
  }
  const existing = await sql<CampaignRow[]>`SELECT * FROM campaigns WHERE id = ${id}`
  if (existing.length === 0) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (existing[0].status === 'launched') {
    return c.json({ error: 'Already launched' }, 409)
  }

  const row = existing[0]
  let deployment: Awaited<ReturnType<typeof loadDeployment>>
  try {
    deployment = await loadDeployment()
  } catch (err) {
    return c.json({ error: `Deployment config unavailable: ${(err as Error).message}` }, 503)
  }
  const validation = validateLaunch({
    feeSplitBps: row.fee_split_bps,
    companyA: row.company_a,
    companyB: row.company_b,
    operatingDepositWei: BigInt(row.operating_deposit),
  })
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400)
  }

  const salt = generateSalt()

  // ── On-chain createCampaign: real deployment to Base Sepolia ──────────────
  // Terms from the wizard's JSONB record; rewardUri points at the (future)
  // metadata endpoint — the reward contract's ERC-1155 base URI template.
  const mechanics = row.mechanics as { rewardType?: string; rewardValues?: Record<string, string | number | boolean> }
  const rv = mechanics?.rewardValues ?? {}
  const rules = row.rules as { ruleStates?: Record<string, string>; ruleValues?: Record<string, string | number> }
  const rs = rules?.ruleStates ?? {}
  const rvals = rules?.ruleValues ?? {}
  const t = row.terms as { start?: string; end?: string; noEndDate?: boolean }

  const startUnix = t?.start ? Math.floor(new Date(t.start).getTime() / 1000) : 0
  // "No end date" maps to a far-future end (the wizard uses 7026-12-31 for this).
  const endUnix = t?.noEndDate || !t?.end
    ? 4102444800 // 2100-01-01
    : Math.floor(new Date(t.end).getTime() / 1000)
  const minSpendEnabled = rs['min-spend'] === 'enabled'
  const capEnabled = rs['reward-cap'] === 'enabled'
  const dowEnabled = rs['day-of-week'] === 'enabled'
  const daysMask = dowEnabled ? 127 : 0 // every day allowed when the rule is on with no selection

  // ── Reward mechanic mapping (mirrors CampaignRulesLib.computePoints) ──────
  // 'monetary' = cashback: percent (rateBps% of spend) or flat (fixed per
  // purchase). 'discount' = proof-of-savings: redeemable=false, the computed
  // value is dollars saved — it lands in the user's totalSaved counter only.
  const cashbackType = String(rv.cashbackType ?? 'percent')
  const flatEnabled = mechanics?.rewardType === 'monetary' && cashbackType === 'flat'
  const rateBps = flatEnabled ? 0 : Math.round(Number(rv.cashbackRate ?? 0) * 100)
  const flatValueWei = flatEnabled ? usdToWei(Number(rv.cashbackFlat ?? 0)) : 0n
  const redeemable = mechanics?.rewardType !== 'discount'

  let onchain
  try {
    onchain = await createCampaignOnChain({
      terms: {
        rateBps,
        startUnix,
        endUnix,
        minSpendEnabled,
        minSpendWei: usdToWei(Number(rvals.minSpend ?? 0)),
        capEnabled,
        capWei: usdToWei(Number(rvals.cap ?? 0)),
        dayOfWeekEnabled: dowEnabled,
        daysOfWeekBitmask: daysMask,
        flatEnabled,
        flatValueWei,
        redeemable,
      },
      workflowOwner: (process.env.WORKFLOW_OWNER_ADDRESS || deployment?.deployer) as Address,
      rewardUri: process.env.REWARD_URI || 'https://wizard.example/api/metadata/{id}.json',
      salt: salt as Hex,
      companyA: row.company_a as Address,
      companyB: row.company_b as Address,
      feeSplitBps: row.fee_split_bps,
    })
  } catch (err) {
    return c.json({ error: `On-chain launch failed: ${(err as Error).message}` }, 502)
  }

  const rows = await sql<CampaignRow[]>`
    UPDATE campaigns SET
      status = 'launched', salt = ${salt}, launched_at = NOW(),
      escrow_address = ${onchain.escrow}, reward_address = ${onchain.reward}
    WHERE id = ${id}
    RETURNING *
  `
  return c.json({ ...toApi(rows[0]), onchainTxHash: onchain.txHash, onchainCampaignId: onchain.campaignId })
})