export default function BrandAPos() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Brand A — POS</h1>
        <p className="page-subtitle">
          Mock point-of-sale intake. A purchase payload is sent to the confidential workflow; eligibility is
          verified inside the TEE and only the verdict + mint lands on-chain.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-title">Purchase entry</div>
        <div className="card-desc">
          UI shell only — live CRE submission wires in after the receiver contract is deployed.
        </div>

        <div className="field">
          <label className="field-label">Customer wallet</label>
          <input className="input mono" placeholder="0x… (Privy embedded wallet)" disabled />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="field-label">Amount</label>
            <input className="input" type="number" placeholder="12.00" disabled />
          </div>
          <div className="field">
            <label className="field-label">Items</label>
            <input className="input" placeholder="latte, pastry" disabled />
          </div>
        </div>
        <button className="btn btn-ghost" disabled>
          Submit to confidential workflow
        </button>
        <p className="field-hint" style={{ marginTop: 8 }}>
          Pending: CRE receiver wiring.
        </p>
      </div>
    </div>
  )
}