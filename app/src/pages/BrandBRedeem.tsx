export default function BrandBRedeem() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Brand B — Redeem</h1>
        <p className="page-subtitle">
          Where customers redeem earned Bpoints. Redemption is driven by Brand B's authorized wallet
          (<span className="mono">redeemFor</span>) — the user's balance is burned as spent, and the UTXO
          ledger preserves lifetime lineage.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-title">Redemption</div>
        <div className="card-desc">UI shell only — live redemption wires in after the escrow is deployed on-chain.</div>

        <div className="insight-row">
          <span className="insight-label">Available balance</span>
          <span className="insight-value mono">0.00 Bpoints</span>
        </div>
        <div className="insight-row">
          <span className="insight-label">Lifetime earned</span>
          <span className="insight-value mono">0.00 Bpoints</span>
        </div>

        <div className="field" style={{ marginTop: 16 }}>
          <label className="field-label">Redeem amount</label>
          <input className="input" type="number" placeholder="0.00" disabled />
        </div>
        <button className="btn btn-primary" disabled>
          Redeem with Brand B
        </button>
        <p className="field-hint" style={{ marginTop: 8 }}>
          Pending: escrow deployment + redeemFor wiring.
        </p>
      </div>
    </div>
  )
}