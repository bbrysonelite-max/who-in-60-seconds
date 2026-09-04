# who-in-60-seconds

A CLI that pays $0.05 USDC on Base for one legal-entity lookup, via the [x402](https://github.com/x402-foundation/x402) payment protocol.

```
GET https://lookups.alienprobe.ai/v1/lookup/who/{q}
```

`{q}` is a company name (optionally with a `;JURISDICTION` suffix), a domain, or a 20-character LEI. Example: `who/apple.com`.

## 60 seconds

```bash
git clone <this-repo>
cd who-in-60-seconds
npm install

cp .env.example .env
# put a throwaway wallet's private key in .env as PRIVATE_KEY=0x...
# fund that wallet with about $1 of USDC on Base mainnet first — see "Funding" below.
# never commit .env.

node who.mjs apple.com
```

Output is the paid 200 body:

```json
{
  "schema_version": "who-lookup.v1",
  "subject": { "type": "who", "value": "apple.com" },
  "answer": {
    "lei": "HWUPKR0MPOU8FGXBT394",
    "legal_name": "Apple Inc.",
    "jurisdiction": "US-CA",
    "entity_status": "ACTIVE",
    "registration_status": "ISSUED",
    "last_update": "2026-03-03T16:34:33.150Z",
    "match": { "by": "domain", "rule": "domain_exact" },
    "official_website": "https://apple.com/"
  },
  "source": { "name": "...", "vintage": "...", "snapshot_sha256": "...", "coverage": "..." },
  "delivered_at": "..."
}
```

No signup, no API key, no account. The wallet is the account.

### Funding

The wallet needs a small amount of USDC on Base mainnet — about $1 covers 20 lookups at $0.05 each. This repo does not tell you how to acquire USDC or move it to Base; see Base's own bridge documentation: https://docs.base.org/base-chain/tools/bridges/ (or any exchange/on-ramp that supports Base withdrawals directly). Use a throwaway wallet. Do not fund a wallet that holds anything else.

### First lookup is free

The first successful lookup for a wallet on this pricing shelf settles at $0. The second and subsequent lookups are charged $0.05. This is a property of the service, not of this client.

## Previewing the price without paying

```bash
node who.mjs apple.com --dry
```

This fetches the 402 response and prints the advertised terms. It never constructs a payment, never touches `PRIVATE_KEY`, and works even if `.env` is empty:

```json
{
  "dry_run": true,
  "status": 402,
  "network": "base",
  "scheme": "exact",
  "amount": "50000",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0x701fd2Fc3295Ff2E98d986BD2032A966f54555f7",
  "maxTimeoutSeconds": 60,
  "description": "single-fact who lookup. ..."
}
```

`amount: "50000"` is $0.05 USDC (6 decimals).

## Free refusals

Some queries never reach a paid response. These cost nothing and this client never attempts payment for them:

- `400` — malformed query, body carries a `reason`
- `404` — no match, body carries the source coverage block
- `409` — ambiguous, up to 5 candidates as `legal_name` + `jurisdiction`
- `503` — source unreadable

Example, an ambiguous name:

```bash
node who.mjs Acme
```

```json
{
  "error": "ambiguous",
  "candidates": [
    { "legal_name": "ACME S.R.L.", "jurisdiction": "IT" },
    { "legal_name": "ACME S.R.L.", "jurisdiction": "IT" },
    { "legal_name": "A.C.M.E. S.R.L.", "jurisdiction": "IT" },
    { "legal_name": "ACME S.R.L.", "jurisdiction": "IT" },
    { "legal_name": "ACME S.R.L.", "jurisdiction": "IT" }
  ],
  "truncated": true,
  "hint": "re-ask with the exact legal_name, then a ;jurisdiction suffix if it still collides"
}
```

Re-asking with the exact legal name plus a jurisdiction suffix (`ACME S.R.L.;IT`) is still free if it still collides — the API only charges once it can commit to one entity:

```bash
node who.mjs "ACME S.R.L.;IT"
```

returns the same `409` here, because five different Italian ACME S.R.L. records still collide even with the jurisdiction narrowed. A tighter query (the exact legal name from a candidate, further narrowed) is required before this becomes a paid, unambiguous match.

## What this does not do

- No street addresses, no officers/directors, no ownership graph. The answer is exactly: LEI, legal name, jurisdiction, entity status, registration status, last update, match info, and (domain queries only) the official website.
- No guessing. A miss is a `404`, not a best-effort guess.
- Non-Latin-script legal names (CJK, Cyrillic, Greek, Arabic, Hebrew, Thai, etc.) are outside this vintage's coverage: names that normalize to fewer than 2 Latin alphanumerics are absent from every lookup door (name, LEI, and domain alike), not just the name door. This is a stated gap of the current data build, not a client-side limitation.
- Domain matching only works for entities Wikidata already links to both an LEI and an official website, matched against the exact registrable domain — a subdomain misses, and an absent domain is a miss from this snapshot only, not proof the company lacks an LEI.

## Receipt

A real settled payment for this lookup, on Base mainnet:

- tx `0xde359ce343ebd9bef7a4b7018de902be9835b467b042407c4579900291a1e0fb`
- block `50837309`
- `50000` units (USDC, 6 decimals) = $0.05

## How payment works

`who.mjs` uses [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) (the x402 Foundation's official fetch-wrapping client, maintained by Coinbase) with [`@x402/evm`](https://www.npmjs.com/package/@x402/evm)'s `ExactEvmScheme` and a [viem](https://viem.sh) private-key account. The library does the entire 402 → sign → retry → 200 sequence; this script never constructs a payment header by hand. A `paymentRequirementsSelector` enforces a hard $0.10-per-run spend cap — if the server ever advertises more than that, the client throws instead of paying.

Without `PRIVATE_KEY` set, `who.mjs` refuses before making any network call that could result in payment. Use `--dry` to see pricing with no key at all.

## Files

- `who.mjs` — the CLI
- `package.json` — pinned dependencies
- `.env.example` — copy to `.env`, fill in `PRIVATE_KEY`
- `NOTES.md` — verification transcript (refusal without a key, and `--dry`)

## License

MIT. See `LICENSE`.

## Proven with this exact script

On 2026-09-04 this script, unmodified, paid from a fresh wallet (`0xb83518cC5e585FBaD0407dB576C2Ac10fcF2e7e3`): the wallet's first successful lookup settled $0 (first-can-free), the second settled $0.05 — one USDC `Transfer` of 50000 units to `0x701fd2Fc3295Ff2E98d986BD2032A966f54555f7` in Base block 50880443, tx `0xa331fd1163e4c5f7f69b61a991025770e016003615788b0ac14da90d684300c9`. The earlier receipt cited below (`0xde359ce343…`) is an owner proof made with a hand-built payload.
