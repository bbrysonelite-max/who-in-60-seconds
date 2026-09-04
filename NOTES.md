# Verification

Draft-only build. `npm install` was run in this directory; no payment was ever sent (verified with curl, and both proofs below never reach a signing step).

## `npm install`

Installed with no vulnerabilities:

```
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'who-in-60-seconds@1.0.0',
npm warn EBADENGINE   required: { node: '>=22' },
npm warn EBADENGINE   current: { node: 'v20.19.6', npm: '10.8.2' }
npm warn EBADENGINE }

up to date, audited 19 packages in 2m

12 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

(The build/test sandbox runs Node 20; the package requires Node >=22 per spec. The code is plain ESM with no Node-22-only syntax, so it also runs correctly under Node 20, as shown below.)

## 1. `node who.mjs Acme` with no `PRIVATE_KEY` set

Command:

```bash
env -u PRIVATE_KEY node who.mjs Acme
```

Exact output:

```
PRIVATE_KEY is not set.
Refusing before making any network call that could result in payment.
Set PRIVATE_KEY in .env (see .env.example), or pass --dry to preview the price.
```

Exit code: `1`

No network call was made before this message — the check happens before `fetch` or `wrapFetchWithPaymentFromConfig` is ever reached.

## 2. `node who.mjs apple.com --dry`

Command:

```bash
env -u PRIVATE_KEY node who.mjs apple.com --dry
```

Exact output:

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
  "description": "single-fact who lookup. GLEIF Level 1 record by name, domain or LEI: LEI, legal name, jurisdiction, entity and registration status kept apart; website only on domain answers. Vintage 2026-09-03, all statuses: 3283992 of 3419883; non-Latin-script names (<2 Latin alphanumerics normalized) enter no door. Domains only from Wikidata LEI-website links, exact: subdomains miss. Free: 400 malformed, 404 miss, 409 ambiguous (names only), 503 unreadable. No guesses; full bound in the declaration."
}
```

Exit code: `0`

`amount: "50000"` = $0.05 USDC (6 decimals). `--dry` calls the plain, unwrapped `fetch` — no x402 client is constructed in this code path, no signer exists, `PRIVATE_KEY` was unset for this run and the command still succeeded.

## 3. (bonus) Free refusal through the actual payment-wrapped path

To confirm the library path itself never pays on a free refusal, the same command was run through `runPaid()` (i.e. without `--dry`) using a randomly generated, never-funded, throwaway test key — safe because `Acme` resolves to a free `409`, not a `402`, so no payment is ever attempted regardless of wallet balance:

```bash
TESTKEY=0x<32 random bytes, generated locally, never funded, discarded after this run>
PRIVATE_KEY=$TESTKEY node who.mjs Acme
```

Output (through `wrapFetchWithPaymentFromConfig`):

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

Exit code: `0`. No payment header was constructed or sent (the response was `409`, not `402`, so `@x402/fetch` never invoked the scheme client).

## Live endpoint checks (curl only, no payment ever sent)

```
curl -sS -i "https://lookups.alienprobe.ai/v1/lookup/who/apple.com"   -> HTTP/2 402, payment-required header present, body amount "50000"
curl -sS "https://lookups.alienprobe.ai/v1/lookup/who/Acme"           -> HTTP 409 ambiguous, 5 IT candidates
curl -sS "https://lookups.alienprobe.ai/v1/lookup/who/%20"            -> HTTP 400 {"error":"invalid_subject","reason":"empty"}
curl -sS "https://lookups.alienprobe.ai/v1/lookup/who/ACME%20S.R.L.%3BIT" -> HTTP 409, still ambiguous (5 IT candidates) even with jurisdiction suffix
```

curl never sends a payment header, so a `402` is the worst case from these checks (confirmed above) — no funds were ever at risk.

## No paid (200) response was captured

Per the task, no payment was sent, so the actual paid `200` response body shown in the README is the API's own documented example (present verbatim in the live `payment-required` header's `bazaar.info.output.example` field for `apple.com`, decoded from the base64 header captured above), not a response this run purchased.
