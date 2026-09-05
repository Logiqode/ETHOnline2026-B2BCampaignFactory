-- Wizard local-state DB: campaign drafts + launch metadata.
-- Mirrors contracts/src/CampaignFactory.sol (operating deposit, fee split, salt)
-- and the app wizard state. On-chain address fields stay NULL until the
-- createCampaign wiring lands on Base Sepolia (honest boundary).

CREATE TABLE IF NOT EXISTS campaigns (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'launched')),
  reward_type       TEXT NOT NULL DEFAULT 'monetary' CHECK (reward_type IN ('monetary', 'digital', 'physical')),
  mechanics         JSONB NOT NULL DEFAULT '{}'::jsonb,
  terms             JSONB NOT NULL DEFAULT '{}'::jsonb,
  rules             JSONB NOT NULL DEFAULT '{}'::jsonb,
  fee_split_bps     INTEGER NOT NULL DEFAULT 5000 CHECK (fee_split_bps BETWEEN 0 AND 10000),
  company_a         TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
  company_b         TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
  company_a_name    TEXT NOT NULL DEFAULT '',
  company_b_name    TEXT NOT NULL DEFAULT '',
  -- Operating deposit in wei (0.01 ether = 10_000_000_000_000_000). Integer
  -- storage avoids float drift; the contract boundary is wei too.
  operating_deposit BIGINT NOT NULL DEFAULT 10000000000000000,
  salt              TEXT,           -- CREATE2 salt, generated at launch
  escrow_address    TEXT,           -- NULL until on-chain wiring lands
  reward_address    TEXT,           -- NULL until on-chain wiring lands
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  launched_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status);