import { useEffect, useState } from 'react'

interface Campaign {
  id: string
  name: string
  status: 'draft' | 'launched'
  reward_type: 'monetary' | 'digital' | 'physical'
  fee_split_bps: number
  company_a: string
  company_b: string
  company_a_name: string
  company_b_name: string
  salt: string | null
  escrow_address: string | null
  reward_address: string | null
  operatingDepositWei: string
  createdAt: string
  launchedAt: string | null
}

const API = 'http://localhost:4000'

export default function CampaignsList() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API}/api/campaigns`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as Campaign[]
        if (!cancelled) setCampaigns(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load campaigns')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <div className="page"><p>Loading campaigns…</p></div>
  if (error) return <div className="page"><p className="launch-error" role="alert">⚠️ {error}</p></div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Campaigns</h1>
        <p className="page-subtitle">
          Campaigns launched from the wizard, backed by the local Postgres state.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <div className="card">
          <p className="card-desc">No campaigns yet — launch one from the <strong>Campaign Wizard</strong>.</p>
        </div>
      ) : (
        <div className="card">
          <table className="campaigns-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Status</th>
                <th>Reward</th>
                <th>Fee split (A)</th>
                <th>Salt</th>
                <th>Escrow</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td>{c.name}</td>
                  <td><span className={`status status-${c.status}`}>{c.status}</span></td>
                  <td>{c.reward_type}</td>
                  <td className="mono">{(c.fee_split_bps / 100).toFixed(0)}%</td>
                  <td className="mono salt-cell">{c.salt ? `${c.salt.slice(0, 10)}…` : '—'}</td>
                  <td className="mono">{c.escrow_address ? `${c.escrow_address.slice(0, 10)}…` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}