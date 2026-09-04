#!/usr/bin/env node
// who.mjs — one legal-entity lookup, paid via x402 on Base.
//
// GET https://lookups.alienprobe.ai/v1/lookup/who/{q}
// Free refusals (400 malformed, 404 miss, 409 ambiguous, 503 unreadable) never pay.
// A match is a 402 Payment Required; this script pays it through @x402/fetch,
// which does the whole 402 -> sign -> retry -> 200 dance. We never touch the
// payment header by hand.
//
// Usage:
//   node who.mjs "apple.com"
//   node who.mjs "Acme Corp;US-DE"
//   node who.mjs "apple.com" --dry     # fetch the 402, print the terms, pay nothing

import "dotenv/config";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = "https://lookups.alienprobe.ai/v1/lookup/who/";

// Spend cap for this run: $0.10 USDC (6 decimals -> 100000 base units).
// The lookup itself is advertised at $0.05 (50000 units); the cap is a
// hard ceiling, not the expected price. If the server ever advertises
// more than this, the payment client refuses instead of paying it.
const SPEND_CAP_UNITS = 100000n;

function usage() {
  console.error("Usage: node who.mjs <company-name|domain|LEI> [--dry]");
  console.error('  query may carry a ";JURISDICTION" suffix, e.g. "Acme Corp;US-DE"');
  console.error("  --dry   fetch the 402 and print the advertised price/terms; never pays");
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function buildUrl(query) {
  return BASE_URL + encodeURIComponent(query);
}

async function runDry(url) {
  // Plain, unwrapped fetch: no payment client is constructed, no signer
  // exists in this code path, so there is no way for this branch to pay.
  const res = await fetch(url);

  if (res.status !== 402) {
    const body = await res.json().catch(() => null);
    console.log(`HTTP ${res.status} (no payment required to see this)`);
    if (body) printJson(body);
    process.exit(res.status >= 500 ? 1 : 0);
  }

  const body = await res.json();
  const accept = Array.isArray(body.accepts) ? body.accepts[0] : undefined;

  printJson({
    dry_run: true,
    status: 402,
    network: accept?.network,
    scheme: accept?.scheme,
    amount: accept?.amount ?? accept?.maxAmountRequired,
    asset: accept?.asset,
    payTo: accept?.payTo,
    maxTimeoutSeconds: accept?.maxTimeoutSeconds,
    description: accept?.description,
  });
  process.exit(0);
}

async function runPaid(url) {
  const privateKey = process.env.PRIVATE_KEY;

  // Refuse before touching the network. This is the only branch that can
  // ever pay, so this is the only branch that needs the key.
  if (!privateKey) {
    console.error("PRIVATE_KEY is not set.");
    console.error("Refusing before making any network call that could result in payment.");
    console.error("Set PRIVATE_KEY in .env (see .env.example), or pass --dry to preview the price.");
    process.exit(1);
  }

  let account;
  try {
    const hexKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    account = privateKeyToAccount(hexKey);
  } catch (err) {
    console.error(`Invalid PRIVATE_KEY: ${err.message}`);
    process.exit(1);
  }

  // paymentRequirementsSelector is called by @x402/fetch after it parses the
  // 402's accepted terms. Throwing here aborts the payment before anything
  // is signed or sent.
  const selectWithinCap = (_x402Version, accepts) => {
    if (!accepts || accepts.length === 0) {
      throw new Error("no payment options advertised on the 402");
    }
    const chosen = accepts[0];
    const amount = BigInt(chosen.amount ?? chosen.maxAmountRequired ?? "0");
    if (amount > SPEND_CAP_UNITS) {
      throw new Error(
        `refusing to pay: advertised amount ${amount} exceeds the ${SPEND_CAP_UNITS}-unit ($0.10) spend cap`
      );
    }
    return chosen;
  };

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:8453", // Base mainnet
        client: new ExactEvmScheme(account),
      },
    ],
    paymentRequirementsSelector: selectWithinCap,
  });

  let res;
  try {
    res = await fetchWithPayment(url, { method: "GET" });
  } catch (err) {
    console.error(`Request/payment failed: ${err.message}`);
    process.exit(1);
  }

  const body = await res.json().catch(() => null);

  if (res.status >= 500) {
    console.error(`Server error ${res.status}`);
    if (body) printJson(body);
    process.exit(1);
  }

  // 200 (paid), or a free refusal (400/404/409): print and exit 0.
  printJson(body);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const query = args.find((a) => !a.startsWith("--"));

  if (!query) {
    usage();
    process.exit(1);
  }

  const url = buildUrl(query);
  if (dry) {
    await runDry(url);
  } else {
    await runPaid(url);
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
