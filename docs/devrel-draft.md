**Subject:** Confidential Workflows beta — HTTP trigger workflow ACTIVE, but how do I fire a real (signed) execution?

**Org ID:** org_cukZT25aOjmFoGZG
**Workflow:** wizard-staging (`00bf398105e7f12a5ce218898b16a2a9681cecb214b82f3c3287c48f838e12c1`)
**Registry:** private, DON family zone-a, cre CLI 1.31.0

Hi — my confidential workflow (TypeScript, HTTP trigger, TEE handler) is now **ACTIVE** in the private registry, and `cre workflow simulate` runs green against live Base Sepolia contracts. What I can't figure out is how to trigger a **real execution**: what endpoint accepts HTTP-trigger requests in the beta, and what signature format the `authorizedKeys` check expects?

Specifics:

1. **Trigger config** — I register the handler with:
   ```ts
   httpTrigger.trigger({
     authorizedKeys: [{ type: 'KEY_TYPE_ECDSA_EVM', publicKey: '0x<my-address>' }],
   })
   ```
   (Note: activation rejected the 65-byte uncompressed pubkey — `must be 0x-prefixed hex string of length 42` — so I'm using the address form. Worth clarifying in the docs.)

2. **What I tried** — POSTing JSON-RPC to my tenant's gateway host (`01.gateway.zone-a.cre.chain.link`) got `Service name not found`, which suggests that host isn't the trigger ingress.

3. **What I need** — the correct way for my platform backend to submit a signed HTTP-trigger request: endpoint URL (or whether trigger ingress is gated/not-yet-exposed in the beta), the signing scheme (EIP-191 personal_sign? raw secp256k1 over the JSON-RPC body?), and header placement.

4. **Verification access** — also confirming: `cre execution list/status/events/logs` are the intended observability path for real executions, since enclave logs don't leave the TEE?

Happy to share the workflow source/config if useful. Thanks!
