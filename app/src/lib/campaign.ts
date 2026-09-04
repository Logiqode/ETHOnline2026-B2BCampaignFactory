// Campaign configuration model.
//
// Rules are toggleable: enabling a rule reveals its value inputs (with a 1-line
// guide), exactly the chainlink-cre discover / privy pattern. v1 demo scope:
// the two core rules (Minimum spend, Campaign window) are ON; the rest of the
// catalog is greyed-out frontend presentation (no backend/contract logic).

export interface RuleConfig {
  id: string
  name: string
  description: string
  guide: string        // 1-line "what this rule does" for the value inputs
  enabled: boolean
  // Value inputs that appear when the rule is enabled.
  fields: RuleField[]
}

export interface RuleField {
  key: string
  label: string
  hint?: string
  type: 'number' | 'text' | 'datetime' | 'select'
  options?: string[]   // for select
  placeholder?: string
}

export const RULE_CATALOG: RuleConfig[] = [
  {
    id: 'min-spend',
    name: 'Minimum spend',
    description: 'Reward only when the purchase total is at least X.',
    guide: 'The minimum USD amount a purchase must reach to qualify.',
    enabled: true,
    fields: [
      { key: 'minSpend', label: 'Min spend (USD)', type: 'number', placeholder: '10' },
    ],
  },
  {
    id: 'campaign-window',
    name: 'Campaign window',
    description: 'Reward only within a start/end date range.',
    guide: 'When the campaign is live. Pick "Semi-permanent" for no end date.',
    enabled: true,
    fields: [
      { key: 'start', label: 'Start', type: 'datetime' },
      {
        key: 'windowType',
        label: 'End',
        type: 'select',
        options: ['Semi-permanent', 'Set end date'],
      },
      { key: 'end', label: 'End date', type: 'datetime' },
    ],
  },
  {
    id: 'cashback',
    name: 'Cashback rate',
    description: 'Reward percentage returned on each qualifying purchase.',
    guide: 'Percentage of the purchase returned as Bpoints (e.g. 10 = 10%).',
    enabled: false,
    fields: [
      { key: 'rate', label: 'Cashback rate (%)', type: 'number', placeholder: '10' },
      { key: 'rewardUnit', label: 'Reward unit', type: 'text', placeholder: 'Bpoints' },
    ],
  },
  {
    id: 'reward-cap',
    name: 'Reward cap / user',
    description: 'Lifetime Bpoints a single user can earn in this campaign.',
    guide: 'Caps cumulative rewards per customer (anti-abuse).',
    enabled: false,
    fields: [
      { key: 'cap', label: 'Reward cap / user', type: 'number', placeholder: '100' },
    ],
  },
  {
    id: 'cumulative-spend',
    name: 'Cumulative spend period',
    description: 'Aggregate spending over a time window.',
    guide: 'Reward is based on cumulative spend, not per-transaction.',
    enabled: false,
    fields: [{ key: 'period', label: 'Period (days)', type: 'number', placeholder: '30' }],
  },
  {
    id: 'max-visits',
    name: 'Max visits per period',
    description: 'Limit of 1 transaction per day in-window.',
    guide: 'Restricts how often a customer can earn in a period.',
    enabled: false,
    fields: [{ key: 'max', label: 'Max transactions', type: 'number', placeholder: '1' }],
  },
  {
    id: 'day-of-week',
    name: 'Day of week',
    description: 'Weekend only / weekdays / a specific day.',
    guide: 'Only reward purchases on chosen days.',
    enabled: false,
    fields: [
      {
        key: 'day',
        label: 'Day',
        type: 'select',
        options: ['Any', 'Weekends', 'Weekdays', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      },
    ],
  },
  {
    id: 'pay-with-purchase',
    name: 'Pay-with-Purchase',
    description: 'Spend X to qualify, then pay Z to get Y.',
    guide: 'A second payment unlocks the reward after qualifying.',
    enabled: false,
    fields: [
      { key: 'qualify', label: 'Qualify spend (X)', type: 'number' },
      { key: 'unlock', label: 'Unlock pay (Z)', type: 'number' },
    ],
  },
  {
    id: 'product',
    name: 'Buy specific product',
    description: 'Eligible on a named product / combination.',
    guide: 'Only listed products trigger the reward.',
    enabled: false,
    fields: [{ key: 'products', label: 'Products', type: 'text', placeholder: 'latte, pastry' }],
  },
  {
    id: 'is-member',
    name: 'Is member',
    description: 'Must be a registered member.',
    guide: 'Requires a membership before rewarding.',
    enabled: false,
    fields: [{ key: 'membership', label: 'Membership', type: 'select', options: ['Any', 'Specific'] }],
  },
  {
    id: 'member-tier',
    name: 'Member tier',
    description: 'e.g. Tier 2 / Gold and above.',
    guide: 'Only members above a tier earn rewards.',
    enabled: false,
    fields: [
      { key: 'tier', label: 'Tier', type: 'select', options: ['Tier 1', 'Tier 2', 'Tier 3', 'Gold', 'Platinum'] },
    ],
  },
  {
    id: 'refer-friend',
    name: 'Refer a friend',
    description: 'Reward tied to a successful referral.',
    guide: 'Reward when a referred friend completes a purchase.',
    enabled: false,
    fields: [{ key: 'referralCount', label: 'Referrals', type: 'number', placeholder: '1' }],
  },
  {
    id: 'reward-shapes',
    name: 'Reward shapes',
    description: 'Cashback / badge / redeemable badge / flat discount.',
    guide: 'How the reward is delivered (points vs NFT badge).',
    enabled: false,
    fields: [
      { key: 'shape', label: 'Shape', type: 'select', options: ['Cashback', 'Badge', 'Redeemable badge', 'Flat discount'] },
    ],
  },
  {
    id: 'birth-month',
    name: 'Date-specific',
    description: 'e.g. customer birth month is July.',
    guide: 'Reward based on a customer attribute (birth month).',
    enabled: false,
    fields: [
      { key: 'month', label: 'Month', type: 'select', options: ['January','February','March','April','May','June','July','August','September','October','November','December'] },
    ],
  },
]

export const BRANDS = ['Acme Coffee', 'Globex Books', 'Initech Foods', 'Hooli Fitness', 'Umbrella Goods'] as const