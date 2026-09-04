import { useMemo, useState } from 'react'
import { BRANDS, RULE_CATALOG, type RuleConfig } from '../lib/campaign'

// Default values per rule field (shown when a rule is enabled).
const DEFAULTS: Record<string, string | number> = {
  minSpend: 10,
  start: '2026-09-10T00:00',
  end: '2026-12-31T23:59',
  windowType: 'Semi-permanent',
  rate: 10,
  rewardUnit: 'Bpoints',
  cap: 100,
  period: 30,
  max: 1,
  day: 'Any',
  qualify: 50,
  unlock: 5,
  products: 'latte, pastry',
  membership: 'Any',
  tier: 'Tier 2',
  referralCount: 1,
  shape: 'Cashback',
  month: 'July',
}

type Values = Record<string, string | number>

export default function FactoryConsole() {
  const [campaignName, setCampaignName] = useState('Acme Coffee × Globex Books')
  const [brands, setBrands] = useState<string[]>([BRANDS[0], BRANDS[1]])
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(RULE_CATALOG.map((r) => [r.id, r.enabled])),
  )
  const [values, setValues] = useState<Values>({ ...DEFAULTS })
  const [launched, setLaunched] = useState(false)

  const toggleRule = (id: string) => {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const setValue = (key: string, v: string | number) =>
    setValues((prev) => ({ ...prev, [key]: v }))

  const setBrand = (index: number, brand: string) =>
    setBrands((prev) => prev.map((b, i) => (i === index ? brand : b)))

  const removeBrand = (index: number) =>
    setBrands((prev) => prev.filter((_, i) => i !== index))

  const isOn = (id: string) => enabled[id]

  // Derived summary — only enabled rules contribute.
  const summary = useMemo(() => {
    const rows: { label: string; value: string; mono?: boolean }[] = []
    rows.push({ label: 'Campaign', value: campaignName || '—' })

    if (isOn('cashback')) {
      rows.push({ label: 'Reward', value: `${values.rate}% cashback in ${values.rewardUnit}` })
    }
    if (isOn('min-spend')) {
      rows.push({ label: 'Min spend', value: `$${values.minSpend}` })
    }
    if (isOn('reward-cap')) {
      rows.push({ label: 'Per-user cap', value: `${values.cap} ${values.rewardUnit}` })
    }
    if (isOn('campaign-window')) {
      const win =
        values.windowType === 'Semi-permanent'
          ? `from ${values.start}`
          : `${values.start} → ${values.end}`
      rows.push({ label: 'Window', value: win })
    }
    rows.push({
      label: 'Terms (on-chain)',
      value: `rateBps=${Math.round(Number(values.rate || 0) * 100)} minSpend=${values.minSpend} cap=${values.cap}`,
      mono: true,
    })
    return rows
  }, [campaignName, enabled, values])

  const enabledCount = RULE_CATALOG.filter((r) => isOn(r.id)).length

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Factory Console</h1>
        <p className="page-subtitle">
          Configure a cross-brand campaign. Turn on rules to set their values. Launching deploys a{' '}
          <span className="mono">CampaignEscrow</span> clone + paired ERC-1155 reward on Base Sepolia —
          deployment gas sponsored by the platform.
        </p>
      </div>

      <div className="grid-2">
        {/* ── Campaign identity ── */}
        <div className="card">
          <div className="card-title">Campaign</div>
          <div className="card-desc">Name and the companies running the campaign.</div>

          <div className="field">
            <label className="field-label">Campaign name</label>
            <input className="input" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          </div>

          <div className="field">
            <label className="field-label">Participating brands</label>
            {brands.map((brand, i) => (
              <div key={i} className="brand-row" style={{ marginBottom: 8 }}>
                <span className="brand-index">{i + 1}</span>
                <select className="select brand-select" value={brand} onChange={(e) => setBrand(i, e.target.value)}>
                  {BRANDS.map((b) => <option key={b}>{b}</option>)}
                </select>
                {brands.length > 1 && (
                  <button className="brand-remove" onClick={() => removeBrand(i)} aria-label="Remove brand">
                    ×
                  </button>
                )}
              </div>
            ))}
            <button className="add-brand" disabled title="Coming soon">
              + Add Another Company
            </button>
          </div>
        </div>

        {/* ── Summary + launch ── */}
        <div>
          <div className="card">
            <div className="card-title">Campaign summary</div>
            <div className="card-desc">What the confidential workflow will enforce (enabled rules only).</div>
            {summary.map((row) => (
              <div className="insight-row" key={row.label}>
                <span className="insight-label">{row.label}</span>
                <span className={`insight-value${row.mono ? ' mono' : ''}`}>{row.value}</span>
              </div>
            ))}
          </div>

          <div className="launch-panel">
            <div className="launch-info">
              {launched ? (
                <strong>Deployed — pending on-chain wiring</strong>
              ) : (
                <>
                  <strong>Launch Campaign</strong> · one click, gas sponsored by the platform
                </>
              )}
            </div>
            <button className="btn btn-primary" onClick={() => setLaunched(true)} disabled={launched}>
              {launched ? 'Deployed ✓' : 'Launch Campaign'}
            </button>
          </div>

          {launched && (
            <div className="launch-pending" role="status">
              ⚠️ Smart-contract deployment is pended — createCampaign() wiring lands after contracts are
              deployed on-chain.
            </div>
          )}
        </div>
      </div>

      {/* ── Rule catalog ── */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-title">
          Rule catalog{' '}
          <span className="badge" style={{ marginLeft: 8 }}>
            {enabledCount} enabled · demo scope
          </span>
        </div>
        <div className="card-desc">
          Turn on a rule to set its value. Non-enabled rules stay greyed out — frontend-only presentation.
        </div>

        <div className="rule-grid">
          {RULE_CATALOG.map((rule) => {
            const on = isOn(rule.id)
            return (
              <div key={rule.id} className={`rule-item ${on ? 'enabled' : 'disabled'}`}>
                <div className="rule-head">
                  <button
                    className={`rule-toggle${on ? ' on' : ''}`}
                    onClick={() => toggleRule(rule.id)}
                    aria-pressed={on}
                    aria-label={`Toggle ${rule.name}`}
                  >
                    <span className="rule-toggle-knob" />
                  </button>
                  <div className="rule-info">
                    <div className="rule-name">{rule.name}</div>
                    <div className="rule-desc">{rule.description}</div>
                  </div>
                  <span className="rule-status">{on ? 'Enabled' : 'Greyed out'}</span>
                </div>

                {on && (
                  <div className="rule-body">
                    <div className="rule-desc" style={{ color: 'var(--text-tertiary)' }}>
                      {rule.guide}
                    </div>
                    <div className={`rule-config ${rule.fields.length === 1 ? 'full' : ''}`}>
                      {rule.fields.map((field) => (
                        <div className="field" key={field.key}>
                          <label className="field-label">{field.label}</label>
                          <RuleInput
                            field={field}
                            value={values[field.key]}
                            onChange={(v) => setValue(field.key, v)}
                          />
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
    </div>
  )
}

function RuleInput({ field, value, onChange }: { field: RuleConfig['fields'][number]; value: string | number; onChange: (v: string | number) => void }) {
  if (field.type === 'select') {
    return (
      <select className="select" value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {field.options?.map((o) => <option key={o}>{o}</option>)}
      </select>
    )
  }
  if (field.type === 'datetime') {
    return (
      <input className="input" type="datetime-local" value={String(value)} onChange={(e) => onChange(e.target.value)} />
    )
  }
  if (field.type === 'number') {
    return (
      <input className="input" type="number" value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} placeholder={field.placeholder} />
    )
  }
  return (
    <input className="input" type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
  )
}