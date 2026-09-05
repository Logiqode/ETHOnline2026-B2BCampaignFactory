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
  const rows = await sql<CampaignRow[]>`
    UPDATE campaigns SET status = 'launched', salt = ${salt}, launched_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return c.json(toApi(rows[0]))
})