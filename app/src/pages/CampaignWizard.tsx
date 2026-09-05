import { useMemo, useState } from 'react'
import {
  BRANDS,
  BRAND_ROLES,
  CAMPAIGN_RULES,
  NO_END_DATE_SENTINEL,
  REWARD_BLOCKS,
  REWARD_TYPES,
  TIMEZONES,
  timezoneAbbr,
  type BrandParticipant,
  type BrandRole,
  type RewardType,
  type RuleState,
  type Timezone,
} from '../lib/campaign'

// ─── Campaign Description (name + brands) ──────────────────────
const DEFAULT_DESCRIPTION: { campaignName: string; participants: BrandParticipant[] } = {
  campaignName: 'Acme Coffee × Globex Books',
  participants: [
    { name: BRANDS[0], role: 'pos' as BrandRole },
    { name: BRANDS[1], role: 'reward' as BrandRole },
  ],
}

// ─── Campaign Terms (window + total redeem cap) ────────────────
const DEFAULT_TERMS = {
  start: '2026-09-10T00:00',
  noEndDate: true,
  end: '2026-12-31T23:59',
  totalRedeemCap: 10000000,
  timezone: 'UTC' as Timezone,
}

// ─── Campaign Rules (toggleable) ───────────────────────────────
const DEFAULT_RULE_STATES: Record<string, RuleState> = Object.fromEntries(
  CAMPAIGN_RULES.map((r) => [r.id, r.state]),
)
const DEFAULT_RULE_VALUES: Record<string, string | number> = {
  minSpend: 10,
  cap: 100,
  capPeriod: 'Lifetime',
  capPeriodCount: 1,
  capResetBasis: 'Rolling',
  capResetWeekday: 'Monday',
  capResetDay: 1,
  capResetMonth: 'January',
  capResetTime: '00:00',
  day: '',
  tier: 'Tier 2',
  period: 30,
  max: 1,
  qualify: 50,
  unlock: 5,
  products: 'latte, pastry',
  membership: 'Any',
  referralCount: 1,
  shape: 'Cashback',
  month: 'July',
}

// ─── Campaign Rewards (type + mechanics) ───────────────────────
const DEFAULT_REWARD_TYPE: RewardType = 'monetary'
const DEFAULT_REWARD_BLOCK_STATES: Record<string, 'enabled' | 'disabled'> = Object.fromEntries(
  REWARD_BLOCKS.map((b) => [b.id, b.state]),
)
const DEFAULT_REWARD_VALUES: Record<string, string | number | boolean> = {
  cashbackRate: 10,
  cashbackCap: 100,
  cashbackToken: 'Bpoints',
  discountValue: 5,
  discountType: '%',
  digitalName: 'Golden Badge',
  digitalTransferable: true,
}

// ─── Launch / operating fee (mirrors CampaignFactory) ──────────
// feeSplitBps = Company A's share of the operating deposit (basis points),
// Company B gets the remainder — matches the contract's _splitDeposit.
const DEFAULT_LAUNCH = {
  feeSplitBps: 5000,
  companyAFeeAddress: '0x1111111111111111111111111111111111111111',
  companyBFeeAddress: '0x2222222222222222222222222222222222222222',
}

export default function CampaignWizard() {
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION)
  const [terms, setTerms] = useState(DEFAULT_TERMS)
  const [ruleStates, setRuleStates] = useState<Record<string, RuleState>>(DEFAULT_RULE_STATES)
  const [ruleValues, setRuleValues] = useState<Record<string, string | number | boolean>>(DEFAULT_RULE_VALUES)
  const [rewardType, setRewardType] = useState<RewardType>(DEFAULT_REWARD_TYPE)
  const [rewardBlockStates, setRewardBlockStates] = useState<Record<string, 'enabled' | 'disabled'>>(DEFAULT_REWARD_BLOCK_STATES)
  const [rewardValues, setRewardValues] = useState<Record<string, string | number | boolean>>(DEFAULT_REWARD_VALUES)
  const [redeemCapEnabled, setRedeemCapEnabled] = useState(true)
  const [launch, setLaunch] = useState(DEFAULT_LAUNCH)
  const [launched, setLaunched] = useState(false)
  const [launchResult, setLaunchResult] = useState<{ id: string; salt: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const setLaunchField = <K extends keyof typeof DEFAULT_LAUNCH>(k: K, v: (typeof DEFAULT_LAUNCH)[K]) =>
    setLaunch((p) => ({ ...p, [k]: v }))

  const setDesc = <K extends keyof typeof DEFAULT_DESCRIPTION>(k: K, v: (typeof DEFAULT_DESCRIPTION)[K]) =>
    setDescription((p) => ({ ...p, [k]: v }))
  const setTerm = <K extends keyof typeof DEFAULT_TERMS>(k: K, v: (typeof DEFAULT_TERMS)[K]) =>
    setTerms((p) => ({ ...p, [k]: v }))
  const setParticipant = (i: number, patch: Partial<BrandParticipant>) =>
    setDescription((p) => ({ ...p, participants: p.participants.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }))
  const removeParticipant = (i: number) =>
    setDescription((p) => ({ ...p, participants: p.participants.filter((_, idx) => idx !== i) }))

  const toggleRule = (id: string) => {
    const current = ruleStates[id]
    if (current === 'production-limited') return
    setRuleStates((p) => ({ ...p, [id]: current === 'enabled' ? 'disabled' : 'enabled' }))
  }
  const setRuleValue = (key: string, v: string | number | boolean) => setRuleValues((p) => ({ ...p, [key]: v }))

  // Cashback and Discount are mutually exclusive AND one must always be active.
  // Clicking a block selects it (the other turns off); you can never disable both.
  const toggleRewardBlock = (id: string) => {
    if (id === 'cashback' || id === 'discount') {
      setRewardBlockStates(() => ({
        cashback: id === 'cashback' ? 'enabled' : 'disabled',
        discount: id === 'discount' ? 'enabled' : 'disabled',
      }))
    } else {
      setRewardBlockStates((p) => ({ ...p, [id]: p[id] === 'enabled' ? 'disabled' : 'enabled' }))
    }
  }
  const setRewardValue = (key: string, v: string | number | boolean) => setRewardValues((p) => ({ ...p, [key]: v }))

  const effectiveEnd = terms.noEndDate ? NO_END_DATE_SENTINEL : terms.end
  const rewardTypeMeta = REWARD_TYPES.find((t) => t.value === rewardType)!

  // The asset label shown for the reward (depends on type + mechanics).
  const assetLabel = (() => {
    const rewardLabel = rewardTypeMeta.label.toLowerCase()
    if (rewardType === 'digital') return `${rewardValues.digitalName}${rewardValues.digitalTransferable ? '' : ' (non-transferable)'}`
    if (rewardType === 'monetary' && rewardBlockStates.cashback === 'enabled') return rewardValues.cashbackToken as string
    return rewardLabel
  })()

  // When Discount is selected, the cap/total are $ denominated.
  const isDiscount = rewardType === 'monetary' && rewardBlockStates.discount === 'enabled'
  const capUnit = isDiscount ? '$' : ''
  const capSuffix = isDiscount ? '' : ` ${assetLabel}`

  const summary = useMemo(() => {
    const rows: { label: string; value: string; mono?: boolean }[] = []
    rows.push({ label: 'Campaign', value: description.campaignName || '—' })
    rows.push({ label: 'Brands', value: description.participants.map((p) => `${p.name} (${BRAND_ROLES.find((r) => r.value === p.role)?.short})`).join(' · ') })
    const rewardParts: string[] = []
    // Cashback/discount only apply to monetary rewards.
    if (rewardType === 'monetary') {
      if (rewardBlockStates.cashback === 'enabled') rewardParts.push(`${rewardValues.cashbackRate}% cashback in ${rewardValues.cashbackToken}`)
      if (rewardBlockStates.discount === 'enabled') rewardParts.push(`${rewardValues.discountValue}${rewardValues.discountType === '%' ? '%' : ' USD'} discount`)
    }
    rows.push({ label: 'Reward', value: rewardParts.length ? rewardParts.join(' + ') : assetLabel })
    if (ruleStates['min-spend'] === 'enabled') rows.push({ label: 'Min spend', value: `$${ruleValues.minSpend}` })
    if (ruleStates['reward-cap'] === 'enabled') {
      const capPeriod = ruleValues.capPeriod
      const capCount = Number(ruleValues.capPeriodCount || 1)
      if (capPeriod === 'Lifetime') {
        rows.push({ label: 'Per-user cap', value: `${capUnit}${ruleValues.cap}${capSuffix} (lifetime)` })
      } else {
        const basis = ruleValues.capResetBasis === 'Calendar' ? 'calendar' : 'rolling'
        let periodLabel = `every ${capCount} ${String(capPeriod).toLowerCase()}${capCount > 1 ? 's' : ''} (${basis})`
        if (ruleValues.capResetBasis === 'Calendar') {
          const tz = timezoneAbbr(terms.timezone)
          if (capPeriod === 'Week') periodLabel += `, resets ${ruleValues.capResetWeekday} ${ruleValues.capResetTime} ${tz}`
          else if (capPeriod === 'Month') periodLabel += `, resets on day ${ruleValues.capResetDay} ${ruleValues.capResetTime} ${tz}`
          else if (capPeriod === 'Year') periodLabel += `, resets ${ruleValues.capResetMonth} ${ruleValues.capResetDay} ${ruleValues.capResetTime} ${tz}`
          else periodLabel += `, resets ${ruleValues.capResetTime} ${tz}`
        }
        rows.push({ label: 'Per-user cap', value: `${capUnit}${ruleValues.cap}${capSuffix} (${periodLabel})` })
      }
    }
    if (redeemCapEnabled) rows.push({ label: 'Total redeem cap', value: `${capUnit}${terms.totalRedeemCap.toLocaleString()}${capSuffix}` })
    rows.push({ label: 'Window', value: terms.noEndDate ? `from ${terms.start} · ${terms.timezone} · no end date` : `${terms.start} → ${terms.end} · ${terms.timezone}` })
    const rateBps = rewardBlockStates.cashback === 'enabled' ? Math.round(Number(rewardValues.cashbackRate || 0) * 100) : 0
    rows.push({ label: 'Terms (on-chain)', value: `rateBps=${rateBps} minSpend=${ruleValues.minSpend} cap=${ruleValues.cap}`, mono: true })
    return rows
  }, [description, terms, ruleStates, ruleValues, rewardType, rewardBlockStates, rewardValues, redeemCapEnabled, assetLabel, capUnit, capSuffix])

  const enabledRules = Object.values(ruleStates).filter((s) => s === 'enabled').length
  const prodLimited = Object.values(ruleStates).filter((s) => s === 'production-limited').length
  const enabledRewardBlocks = Object.values(rewardBlockStates).filter((s) => s === 'enabled').length

  // ── Launch: POST draft → POST launch. Creates the campaign in the local DB,
  // ── then validates launch (fee split, fee accounts, deposit) and marks it
  // ── launched with a generated CREATE2 salt. On-chain createCampaign wiring
  // ── is still pending, so addresses stay null — the salt is the launch artifact.
  const launchCampaign = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        name: description.campaignName,
        rewardType: 'monetary',
        mechanics: { rewardType, rewardBlocks: rewardBlockStates, rewardValues },
        terms: { ...terms, start: terms.start, end: terms.noEndDate ? undefined : terms.end, noEndDate: terms.noEndDate },
        rules: { ruleStates, ruleValues },
        feeSplitBps: Number(launch.feeSplitBps) || 0,
        companyA: launch.companyAFeeAddress,
        companyB: launch.companyBFeeAddress,
        companyAName: description.participants.find((p) => p.role === 'pos')?.name ?? '',
        companyBName: description.participants.find((p) => p.role === 'reward')?.name ?? '',
      }
      const saveRes = await fetch('http://localhost:4000/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({ error: `HTTP ${saveRes.status}` }))
        throw new Error(err.error || `HTTP ${saveRes.status}`)
      }
      const saved = await saveRes.json()
      const launchRes = await fetch(`http://localhost:4000/api/campaigns/${saved.id}/launch`, { method: 'POST' })
      if (!launchRes.ok) {
        const err = await launchRes.json().catch(() => ({ error: `HTTP ${launchRes.status}` }))
        throw new Error(err.error || `HTTP ${launchRes.status}`)
      }
      const launchedCampaign = await launchRes.json()
      setLaunchResult({ id: String(launchedCampaign.id), salt: launchedCampaign.salt })
      setLaunched(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Launch failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Campaign Wizard</h1>
        <p className="page-subtitle">
          Assemble a cross-brand campaign from building blocks: describe it, set the terms, toggle the rules,
          and choose the rewards. Launching deploys a <span className="mono">CampaignEscrow</span> clone +
          paired ERC-1155 reward on Base Sepolia — contract deployment is free.
        </p>
      </div>

      {/* ── Row 1: Campaign Description + Campaign Terms (parallel) ── */}
      <div className="grid-2" style={{ marginBottom: 16 }}>
        {/* Campaign Description */}
        <div className="card">
          <div className="card-title">Campaign Description</div>
          <div className="card-desc">Who's running the campaign.</div>
          <div className="field">
            <label className="field-label">Campaign name</label>
            <input className="input" value={description.campaignName} onChange={(e) => setDesc('campaignName', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Participating brands</label>
            {description.participants.map((p, i) => (
              <div key={i} className="brand-row" style={{ marginBottom: 8 }}>
                <span className="brand-index">{i + 1}</span>
                <select className="select brand-select" value={p.name} onChange={(e) => setParticipant(i, { name: e.target.value })}>
                  {BRANDS.map((b) => <option key={b}>{b}</option>)}
                </select>
                <select className="select role-select" value={p.role} onChange={(e) => setParticipant(i, { role: e.target.value as BrandRole })}>
                  {BRAND_ROLES.map((r) => <option key={r.value} value={r.value}>{r.short}</option>)}
                </select>
                {description.participants.length > 1 && (
                  <button className="brand-remove" onClick={() => removeParticipant(i)} aria-label="Remove brand">×</button>
                )}
              </div>
            ))}
            <button className="add-brand" disabled title="Coming soon">+ Add Another Company</button>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label className="field-label">Operating fee split (Company A)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input className="input" type="number" min={0} max={10000} value={launch.feeSplitBps} onChange={(e) => setLaunchField('feeSplitBps', Number(e.target.value))} />
              <span className="field-suffix">bps</span>
            </div>
            <span className="field-hint">
              Company A's share of the launch operating deposit (0–10000 bps). Company B gets the remainder — matches the contract's fee split.
            </span>
          </div>
          <div className="field">
            <label className="field-label">Company A fee address</label>
            <input className="input mono" value={launch.companyAFeeAddress} onChange={(e) => setLaunchField('companyAFeeAddress', e.target.value)} placeholder="0x…" />
          </div>
          <div className="field">
            <label className="field-label">Company B fee address</label>
            <input className="input mono" value={launch.companyBFeeAddress} onChange={(e) => setLaunchField('companyBFeeAddress', e.target.value)} placeholder="0x…" />
          </div>
        </div>

        {/* Campaign Terms */}
        <div className="card">
          <div className="card-title">Campaign Terms</div>
          <div className="card-desc">Structural baseline — the campaign's envelope.</div>
          <div className="grid-2">
            <div className="field">
              <label className="field-label">Start</label>
              <input className="input" type="datetime-local" value={terms.start} onChange={(e) => setTerm('start', e.target.value)} />
            </div>
            <div className="field">
              <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                <span>End date</span>
                <span style={{ flex: 1 }} />
                <button className={`rule-toggle${terms.noEndDate ? ' on' : ''}`} onClick={() => setTerm('noEndDate', !terms.noEndDate)} aria-pressed={terms.noEndDate} aria-label="No end date">
                  <span className="rule-toggle-knob" />
                </button>
                <span className="field-hint" style={{ margin: 0 }}>No end date</span>
              </div>
              {terms.noEndDate ? (
                <input className="input" type="datetime-local" value={effectiveEnd} onChange={(e) => setTerm('end', e.target.value)} disabled style={{ opacity: 0.5 }} />
              ) : (
                <input className="input" type="datetime-local" value={effectiveEnd} onChange={(e) => setTerm('end', e.target.value)} />
              )}
              <span className="field-hint">{terms.noEndDate ? 'No end date — campaign runs indefinitely.' : 'Campaign ends at this datetime.'}</span>
            </div>
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label className="field-label">Timezone</label>
            <select className="select" value={terms.timezone} onChange={(e) => setTerm('timezone', e.target.value as Timezone)} aria-label="Timezone">
              {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
            <span className="field-hint">Applies to the whole campaign — Start, End, and all time-based rules.</span>
          </div>
          <div className="field">
            <label className="field-label">Total redeem cap (campaign)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className={`rule-toggle${redeemCapEnabled ? ' on' : ''}`} onClick={() => setRedeemCapEnabled(!redeemCapEnabled)} aria-pressed={redeemCapEnabled} aria-label="Toggle total redeem cap">
                <span className="rule-toggle-knob" />
              </button>
              <span className="field-hint" style={{ margin: 0 }}>Cap total rewards issued</span>
              <span style={{ flex: 1 }} />
              {redeemCapEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="input cap-input" type="number" min={0} value={terms.totalRedeemCap} onChange={(e) => setTerm('totalRedeemCap', Number(e.target.value))} />
                  <span className="field-hint" style={{ margin: 0 }}>{capUnit}{terms.totalRedeemCap.toLocaleString()}{capSuffix}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Campaign Rewards ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          Campaign Rewards
          <span className="badge" style={{ marginLeft: 8 }}>{rewardTypeMeta.label} · {enabledRewardBlocks} block(s)</span>
        </div>
        <div className="card-desc">What's given and how. Reward type is required; add mechanic blocks.</div>

        <div className="field">
          <label className="field-label">Reward type</label>
          <div className="segmented" role="radiogroup">
            {REWARD_TYPES.map((t) => (
              <button key={t.value} className={rewardType === t.value ? 'active' : ''} onClick={() => setRewardType(t.value)} role="radio" aria-checked={rewardType === t.value}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="reward-type-hint">{rewardTypeMeta.hint}</span>
        </div>

        {rewardType === 'digital' && (
          <div className="reward-digital-fields">
            <div className="field">
              <label className="field-label">Merchandise name</label>
              <input className="input" value={String(rewardValues.digitalName)} onChange={(e) => setRewardValue('digitalName', e.target.value)} placeholder="e.g. Golden Badge" />
            </div>
            <div className="field">
              <label className="field-label">Transferable</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className={`rule-toggle${rewardValues.digitalTransferable ? ' on' : ''}`} onClick={() => setRewardValue('digitalTransferable', !rewardValues.digitalTransferable)} aria-pressed={!!rewardValues.digitalTransferable} aria-label="Toggle transferable">
                  <span className="rule-toggle-knob" />
                </button>
                <span className="field-hint" style={{ margin: 0 }}>
                  {rewardValues.digitalTransferable ? 'Users can transfer. Admins/whitelisted can move on behalf.' : 'Non-transferable (soulbound).'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="reward-grid">
          {REWARD_BLOCKS.map((block) => {
            // Only show cashback/discount blocks when reward type is monetary.
            if (rewardType !== 'monetary') return null
            const on = rewardBlockStates[block.id] === 'enabled'
            return (
              <div key={block.id} className={`rule-item ${on ? 'enabled' : 'disabled'}`}>
                <div className="rule-head">
                  <button className={`rule-toggle${on ? ' on' : ''}`} onClick={() => toggleRewardBlock(block.id)} aria-pressed={on} aria-label={`Toggle ${block.name}`}>
                    <span className="rule-toggle-knob" />
                  </button>
                  <div className="rule-info">
                    <div className="rule-name">{block.name}</div>
                    <div className="rule-desc">{block.description}</div>
                  </div>
                  <span className="rule-status">{on ? 'ON' : 'OFF'}</span>
                </div>
                {on && (
                  <div className="rule-body">
                    <div className="rule-desc" style={{ color: 'var(--text-tertiary)' }}>{block.guide}</div>
                    <div className={`rule-config ${block.fields.length === 1 ? 'full' : ''}`}>
                      {block.fields.map((field) => (
                        <div className="field" key={field.key}>
                          <label className="field-label">{field.label}</label>
                          <RuleInput field={field} value={rewardValues[field.key]} onChange={(v) => setRewardValue(field.key, v)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Campaign Rules ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          Campaign Rules
          <span className="badge" style={{ marginLeft: 8 }}>{enabledRules} enabled · {prodLimited} production-limited</span>
        </div>
        <div className="card-desc">
          Optional eligibility gates. ON and OFF rules are toggleable; PRODUCTION-LIMITED rules are
          showcased (deferred) and not interactable.
        </div>
        <div className="rule-grid">
          {CAMPAIGN_RULES.map((rule) => {
            const state = ruleStates[rule.id]
            const on = state === 'enabled'
            const limited = state === 'production-limited'
            return (
              <div key={rule.id} className={`rule-item ${limited ? 'production-limited' : on ? 'enabled' : 'disabled'}`}>
                <div className="rule-head">
                  {limited ? <span className="rule-toggle" style={{ opacity: 0.35, cursor: 'not-allowed' }} /> : (
                    <button className={`rule-toggle${on ? ' on' : ''}`} onClick={() => toggleRule(rule.id)} aria-pressed={on} aria-label={`Toggle ${rule.name}`}>
                      <span className="rule-toggle-knob" />
                    </button>
                  )}
                  <div className="rule-info">
                    <div className="rule-name">{rule.name}</div>
                    <div className="rule-desc">{rule.description}</div>
                  </div>
                  <span className="rule-status">{limited ? 'PRODUCTION-LIMITED' : on ? 'ON' : 'OFF'}</span>
                </div>
                {on && (
                  <div className="rule-body">
                    <div className="rule-desc" style={{ color: 'var(--text-tertiary)' }}>{rule.guide}</div>
                    <div className={`rule-config ${rule.fields.length === 1 ? 'full' : ''}`}>
                      {rule.fields.map((field) => {
                        // For reward-cap: hide "Every N" + reset-basis + calendar-boundary fields as appropriate.
                        if (ruleValues.capPeriod === 'Lifetime' && (field.key === 'capPeriodCount' || field.key === 'capResetBasis' || field.key === 'capResetWeekday' || field.key === 'capResetDay' || field.key === 'capResetMonth' || field.key === 'capResetTime')) return null
                        // Calendar-boundary fields only show for Calendar basis.
                        if ((field.key === 'capResetWeekday' || field.key === 'capResetDay' || field.key === 'capResetMonth' || field.key === 'capResetTime') && ruleValues.capResetBasis !== 'Calendar') return null
                        // Weekday boundary only for Week; day-of-month for Month/Year; month only for Year.
                        if (field.key === 'capResetWeekday' && ruleValues.capPeriod !== 'Week') return null
                        if (field.key === 'capResetDay' && ruleValues.capPeriod !== 'Month' && ruleValues.capPeriod !== 'Year') return null
                        if (field.key === 'capResetMonth' && ruleValues.capPeriod !== 'Year') return null
                        return (
                          <div className="field" key={field.key}>
                            <label className="field-label">{field.label}</label>
                            {field.key === 'capPeriodCount' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <RuleInput field={field} value={ruleValues[field.key]} onChange={(v) => setRuleValue(field.key, v)} />
                                <span className="field-suffix">{String(ruleValues.capPeriod).toLowerCase()}{Number(ruleValues[field.key] || 1) > 1 ? 's' : ''}</span>
                              </div>
                            ) : field.key === 'cap' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <RuleInput field={field} value={ruleValues[field.key]} onChange={(v) => setRuleValue(field.key, v)} />
                                <span className="field-suffix">{isDiscount ? 'USD' : assetLabel}</span>
                              </div>
                            ) : field.type === 'time' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <RuleInput field={field} value={ruleValues[field.key]} onChange={(v) => setRuleValue(field.key, v)} />
                                <span className="field-suffix">{timezoneAbbr(terms.timezone)}</span>
                              </div>
                            ) : (
                              <RuleInput field={field} value={ruleValues[field.key]} onChange={(v) => setRuleValue(field.key, v)} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {rule.fields.some((f) => f.hint) && (
                      <div className="rule-config-hint">
                        {rule.fields.filter((f) => f.hint).map((f) => <span key={f.key} className="field-hint">{f.hint}</span>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Summary + launch ── */}
      <div className="card">
        <div className="card-title">Campaign summary</div>
        <div className="card-desc">What the campaign will enforce.</div>
        {summary.map((row) => (
          <div className="insight-row" key={row.label}>
            <span className="insight-label">{row.label}</span>
            <span className={`insight-value${row.mono ? ' mono' : ''}`}>{row.value}</span>
          </div>
        ))}
        <div className="launch-panel" style={{ marginTop: 16 }}>
          <div className="launch-info">
            {launched ? <strong>Launched — pending on-chain wiring</strong> : <><strong>Launch Campaign</strong> · saves a draft, then validates + launches</>}
          </div>
          <button className="btn btn-primary" onClick={launchCampaign} disabled={launched || saving}>
            {saving ? 'Launching…' : launched ? 'Launched ✓' : 'Launch Campaign'}
          </button>
        </div>
        {saveError && <div className="launch-error" role="alert">⚠️ {saveError}</div>}
        {launched && launchResult && (
          <div className="launch-pending" role="status">
            <strong>Campaign #{launchResult.id} launched</strong> — on-chain <span className="mono">createCampaign()</span> wiring
            still pending (addresses stay null until deployment lands). CREATE2 salt:
            <code className="salt">{launchResult.salt}</code>
          </div>
        )}
      </div>
    </div>
  )
}

function RuleInput({ field, value, onChange }: { field: { key: string; label: string; type: string; options?: string[]; placeholder?: string; min?: number; max?: number }; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  if (field.type === 'select') {
    return <select className="select" value={String(value)} onChange={(e) => onChange(e.target.value)}>{field.options?.map((o) => <option key={o}>{o}</option>)}</select>
  }
  if (field.type === 'number') {
    return <input className="input" type="number" value={Number(value)} onChange={(e) => {
      let v = Number(e.target.value)
      if (field.min !== undefined && v < field.min) v = field.min
      if (field.max !== undefined && v > field.max) v = field.max
      onChange(v)
    }} placeholder={field.placeholder} min={field.min} max={field.max} />
  }
  if (field.type === 'multi') {
    const selected = String(value || '').split(',').filter(Boolean)
    const toggle = (opt: string) => {
      const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]
      onChange(next.join(','))
    }
    return (
      <div className="multi-select">
        {field.options?.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`multi-chip${selected.includes(opt) ? ' on' : ''}`}
            onClick={() => toggle(opt)}
            aria-pressed={selected.includes(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    )
  }
  if (field.type === 'time') {
    return <input className="input" type="time" value={String(value)} onChange={(e) => onChange(e.target.value)} />
  }
  return <input className="input" type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
}