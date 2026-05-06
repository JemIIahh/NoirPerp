import * as hre from "hardhat";
import { readFileSync } from "node:fs";
import { Wallet, ZeroAddress, Interface } from "ethers";

/// Phase 11+ Sepolia smoke test — peer-to-peer pair-match end-to-end.
///
/// Submits two opposite encrypted orders on the live DarkpoolEngine v2,
/// then watches the full pipeline:
///   trader → engine → bot → KMS → bot → engine._onMatchDecided →
///   PerpEngine.openAsExecutor → vault.PositionOpened (×2)
///
/// PASS = `MatchSettled` + 2× `PositionOpened` (one per trader) within
/// the timeout. FAIL = anything else (`MatchAborted`, `MatchRejected`,
/// missing positions, timeout). The script identifies the exact pipeline
/// stage that broke so the failure is debuggable from the log alone.
///
/// REQUIRED env (in `contracts/.env`):
///   SEPOLIA_RPC_URL          — already present
///   SMOKE_TRADER_B_PK        — trader B (short side) private key
///   SMOKE_TRADER_A_PK        — trader A (long side) private key.
///                              Defaults to PRIVATE_KEY (admin) if unset.
///
/// OPTIONAL env:
///   COMPLIANCE_API_URL       — default http://127.0.0.1:4001
///   SMOKE_MARKET_ID          — default 2 (ETH); 1=BTC, 3=SOL (SOL hidden)
///   SMOKE_TIMEOUT_SECONDS    — default 240
///
/// PRE-FLIGHT (asserted, not auto-fixed):
///   - Both traders have ≥0.005 SEP for gas.
///   - Compliance backend reachable; on-chain root == backend root.
///   - Both traders allowlisted (proof returned by /proof/:address).
///   - Oracle for MARKET_ID is fresh.
///   - Both traders have a vault balance handle (i.e. have deposited
///     at least once — required for the engine to debit collateral).
///
/// REQUIREMENT (out-of-band — asserted indirectly via the timeout):
///   - The match-watcher bot must be running locally with
///     bot/.env pointing at Sepolia. Without it, no `submitMatchPair`
///     call is ever made and the script hits the timeout.
///
/// Run: `npx hardhat run scripts/smoke-sepolia-pair-match.ts --network sepolia`

const DEFAULT_API = "http://127.0.0.1:4001";
const DEFAULT_TIMEOUT_SECONDS = 240;
const ORDER_SIZE = 2n;
const ORDER_CPU = 200n;
const PRICE_OFFSET = 200n; // buy limit = oracle+200, sell limit = oracle-200

type Stage = "submit-A" | "submit-B" | "match-proposed" | "match-settled" | "positions";

function fail(stage: Stage | "preflight", msg: string): never {
  console.error(`\n❌ FAIL [${stage}] ${msg}`);
  process.exit(1);
}

function ok(stage: string, msg: string) {
  console.log(`✅ ${stage.padEnd(16)} ${msg}`);
}

async function backendHealth(api: string) {
  let res;
  try {
    res = await fetch(`${api}/health`);
  } catch (e: any) {
    fail("preflight",
      `cannot reach compliance backend at ${api} (${e?.cause?.code ?? e?.message ?? e}). ` +
      `Start it: cd compliance-backend && npm start`);
  }
  if (!res.ok) fail("preflight", `compliance backend /health: ${res.status}`);
  return await res.json() as { status: string; root: string; count: number };
}

async function backendProof(api: string, addr: string): Promise<string[]> {
  const res = await fetch(`${api}/proof/${addr}`);
  if (!res.ok) fail("preflight", `compliance backend /proof: ${res.status}`);
  const body = (await res.json()) as { allowlisted: boolean; proof: string[] };
  if (!body.allowlisted) {
    fail("preflight",
      `trader ${addr} not on allowlist. ` +
      `Fix: curl -X POST ${api}/admin/add ` +
      `-H 'x-api-key: <COMPLIANCE_ADMIN_API_KEY>' ` +
      `-H 'Content-Type: application/json' ` +
      `-d '{"address":"${addr}"}'  ` +
      `&& npx hardhat run scripts/sync-compliance-root.ts --network sepolia`);
  }
  return body.proof;
}

async function buildEncryptedInputs(
  sdkInstance: any,
  contractAddr: string,
  user: string,
  size: bigint, cpu: bigint, limit: bigint,
) {
  const inp = sdkInstance.createEncryptedInput(contractAddr, user);
  inp.add64(size);
  inp.add64(cpu);
  inp.add64(limit);
  const enc = await inp.encrypt();
  // Frontend pattern: same inputProof reused across all 3 handles.
  return {
    eSize: enc.handles[0],                   sizeProof: enc.inputProof,
    eCollateralPerUnit: enc.handles[1],      collateralPerUnitProof: enc.inputProof,
    eLimitPrice: enc.handles[2],             limitProof: enc.inputProof,
  };
}

async function main() {
  // ─── Config + signers ───────────────────────────────────────────
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11155111n) {
    fail("preflight", `expected Sepolia (11155111), got chainId=${network.chainId}. ` +
      `Run with --network sepolia.`);
  }

  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
  const apiUrl = process.env.COMPLIANCE_API_URL ?? DEFAULT_API;
  const marketId = Number(process.env.SMOKE_MARKET_ID ?? 2);
  if (![1, 2].includes(marketId)) {
    fail("preflight", `SMOKE_MARKET_ID=${marketId} unsupported on Sepolia. Use 1 (BTC) or 2 (ETH). SOL is hidden.`);
  }
  const timeoutMs = Number(process.env.SMOKE_TIMEOUT_SECONDS ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

  const pkA = process.env.SMOKE_TRADER_A_PK ?? process.env.PRIVATE_KEY;
  const pkB = process.env.SMOKE_TRADER_B_PK;
  if (!pkA) fail("preflight", "neither SMOKE_TRADER_A_PK nor PRIVATE_KEY set in contracts/.env");
  if (!pkB) fail("preflight", "SMOKE_TRADER_B_PK must be set in contracts/.env");
  const usingAdminAsA = !process.env.SMOKE_TRADER_A_PK;
  const provider = hre.ethers.provider;
  const traderA = new Wallet(pkA, provider);
  const traderB = new Wallet(pkB, provider);
  if (traderA.address.toLowerCase() === traderB.address.toLowerCase()) {
    fail("preflight", "trader A and B keys resolve to the same address — engine will revert PairOrdersSameOwner");
  }

  console.log(`\n┌── NoirPerp Phase 11+ smoke (live Sepolia) ──`);
  console.log(`│ DarkpoolEngine v2 : ${dep.contracts.DarkpoolEngine}`);
  console.log(`│ NoirVault         : ${dep.contracts.NoirVault}`);
  console.log(`│ Trader A (long)   : ${traderA.address}${usingAdminAsA ? "  [admin / from PRIVATE_KEY]" : ""}`);
  console.log(`│ Trader B (short)  : ${traderB.address}`);
  console.log(`│ Market            : ${marketId} (${marketId === 1 ? "BTC" : "ETH"})`);
  console.log(`│ Timeout           : ${timeoutMs / 1000}s`);
  console.log(`└──`);

  // ─── Pre-flight ─────────────────────────────────────────────────
  console.log(`\n[preflight]`);

  // gas
  for (const [label, w] of [["A", traderA], ["B", traderB]] as const) {
    const bal = await provider.getBalance(w.address);
    if (bal < hre.ethers.parseEther("0.005")) {
      fail("preflight",
        `trader ${label} (${w.address}) has ${hre.ethers.formatEther(bal)} SEP — needs ≥0.005 for gas. ` +
        `Top up via https://sepoliafaucet.com.`);
    }
    ok("gas", `trader ${label} = ${hre.ethers.formatEther(bal)} SEP`);
  }

  // compliance backend
  const health = await backendHealth(apiUrl);
  ok("backend", `${apiUrl}/health → root=${health.root.slice(0, 10)}… count=${health.count}`);

  // on-chain root match — read-only, use traderA as the connected signer (any will do)
  const compliance = await hre.ethers.getContractAt("Compliance", dep.contracts.Compliance, traderA);
  const onchainRoot: string = await compliance.merkleRoot();
  if (onchainRoot.toLowerCase() !== health.root.toLowerCase()) {
    fail("preflight",
      `on-chain Compliance root (${onchainRoot.slice(0, 10)}…) != backend root (${health.root.slice(0, 10)}…). ` +
      `Fix: npx hardhat run scripts/sync-compliance-root.ts --network sepolia`);
  }
  ok("compliance", `on-chain root matches backend`);

  // proofs (also asserts traders are on the tree)
  const proofA = await backendProof(apiUrl, traderA.address);
  const proofB = await backendProof(apiUrl, traderB.address);
  // Belt-and-braces: ask the contract to verify, since a stale local tree
  // could yield a proof that the on-chain root rejects.
  const verifA: boolean = await compliance.verify(traderA.address, proofA);
  const verifB: boolean = await compliance.verify(traderB.address, proofB);
  if (!verifA || !verifB) {
    fail("preflight", `Compliance.verify returned false (A=${verifA}, B=${verifB}). Re-sync the on-chain root.`);
  }
  ok("allowlist", `both traders verified by Compliance contract`);

  // oracle freshness + price (read-only). The Sepolia oracle-relayer
  // serializes 6 txs per tick (~84s) against a 90s staleness window, so
  // freshness windows are narrow. Poll up to 120s waiting for one.
  const oracle = await hre.ethers.getContractAt("Oracle", dep.contracts.Oracle, traderA);
  let oraclePrice: bigint | undefined;
  const oracleDeadline = Date.now() + 120_000;
  let lastPrice = 0n;
  while (Date.now() < oracleDeadline) {
    const [price, fresh]: [bigint, boolean] = await oracle.getPrice(marketId);
    lastPrice = price;
    if (fresh) { oraclePrice = price; break; }
    process.stdout.write(`   waiting for oracle freshness… (price=${price}, ${Math.round((oracleDeadline - Date.now()) / 1000)}s left)\r`);
    await new Promise(r => setTimeout(r, 5000));
  }
  if (oraclePrice === undefined) {
    process.stdout.write("\n");
    fail("preflight",
      `Oracle.getPrice(${marketId}) was never fresh in 120s (last price=${lastPrice}). ` +
      `Check oracle-relayer logs (/tmp/noirperp-smoke/oracle-relayer.log) — the service ` +
      `should be submitting prices for market ${marketId} every ~60s.`);
  }
  process.stdout.write("\n");
  ok("oracle", `market ${marketId} price=${oraclePrice} (fresh)`);

  // vault balance handle exists for both traders (proxy for "has deposited")
  const vault = await hre.ethers.getContractAt("NoirVault", dep.contracts.NoirVault, traderA);
  for (const [label, w] of [["A", traderA], ["B", traderB]] as const) {
    const handle: string = await vault.getBalance(w.address);
    if (handle === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      fail("preflight",
        `trader ${label} (${w.address}) has no vault balance handle (never deposited). ` +
        `Fix: open the frontend Faucet (http://localhost:5173/faucet), connect this wallet, ` +
        `mint USDCx, then deposit at least ${ORDER_SIZE * ORDER_CPU} units into the vault.`);
    }
    ok("vault", `trader ${label} balance handle = ${handle.slice(0, 10)}…`);
  }

  // ─── Build relayer-SDK Node instance ────────────────────────────
  console.log(`\n[init]`);
  // Mirror bot/src/index.ts — relayer-sdk is ESM, dynamic import via Function trick.
  const sdkModule = await (Function('return import("@zama-fhe/relayer-sdk/node")')() as Promise<any>);
  const sdkInstance = await sdkModule.createInstance({
    ...sdkModule.SepoliaConfig,
    network: process.env.SEPOLIA_RPC_URL!,
  });
  ok("relayer-sdk", `instance ready (Sepolia preset)`);

  // ─── Submit two opposite orders ─────────────────────────────────
  console.log(`\n[submit]`);
  const dark = await hre.ethers.getContractAt("DarkpoolEngine", dep.contracts.DarkpoolEngine, traderA);
  const darkA = dark.connect(traderA);
  const darkB = dark.connect(traderB);

  // Bracket the oracle: long fills if oracle ≤ buyLimit, short fills if oracle ≥ sellLimit.
  const buyLimit  = oraclePrice + PRICE_OFFSET;
  const sellLimit = oraclePrice - PRICE_OFFSET;
  console.log(`   oracle=${oraclePrice}  buyLimit=${buyLimit}  sellLimit=${sellLimit}`);

  // --- A submits long ---
  const inputsA = await buildEncryptedInputs(
    sdkInstance, dep.contracts.DarkpoolEngine, traderA.address,
    ORDER_SIZE, ORDER_CPU, buyLimit,
  );
  const t0 = Date.now();
  const txA = await (darkA as any).submitOrderForPairMatch(inputsA, marketId, true, proofA);
  const rA = await txA.wait();
  const eventIface = new Interface([
    "event OrderSubmittedForPair(uint256 indexed orderId, address indexed owner, uint8 marketId, bool isLong)",
  ]);
  let buyId: bigint | undefined;
  for (const log of rA.logs) {
    try {
      const parsed = eventIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "OrderSubmittedForPair") buyId = parsed.args.orderId as bigint;
    } catch { /* not our event */ }
  }
  if (buyId === undefined) fail("submit-A", `OrderSubmittedForPair not found in receipt ${rA.hash}`);
  ok("submit-A", `buyId=${buyId} tx=${rA.hash} (${Date.now() - t0}ms)`);

  // --- B submits short ---
  const inputsB = await buildEncryptedInputs(
    sdkInstance, dep.contracts.DarkpoolEngine, traderB.address,
    ORDER_SIZE, ORDER_CPU, sellLimit,
  );
  const t1 = Date.now();
  const txB = await (darkB as any).submitOrderForPairMatch(inputsB, marketId, false, proofB);
  const rB = await txB.wait();
  let sellId: bigint | undefined;
  for (const log of rB.logs) {
    try {
      const parsed = eventIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "OrderSubmittedForPair") sellId = parsed.args.orderId as bigint;
    } catch { /* not our event */ }
  }
  if (sellId === undefined) fail("submit-B", `OrderSubmittedForPair not found in receipt ${rB.hash}`);
  ok("submit-B", `sellId=${sellId} tx=${rB.hash} (${Date.now() - t1}ms)`);

  // ─── Watch for MatchProposed → MatchSettled → 2x PositionOpened ─
  console.log(`\n[watch]  waiting up to ${timeoutMs / 1000}s for the bot + KMS pipeline…`);
  console.log(`         (if this hangs >60s with no MatchProposed: the match-watcher bot probably isn't running)`);

  const submitBlock = rB.blockNumber;
  const deadline = Date.now() + timeoutMs;
  let matchRequestId: bigint | undefined;
  let settled = false;
  let positionsSeen = 0;
  const opened: { positionId: bigint; owner: string; marketId: number }[] = [];

  while (Date.now() < deadline) {
    const head = await provider.getBlockNumber();

    if (matchRequestId === undefined) {
      const proposed = await dark.queryFilter(
        dark.filters.MatchProposed(undefined, buyId, sellId), submitBlock, head,
      );
      if (proposed.length > 0) {
        matchRequestId = (proposed[0] as any).args.requestId as bigint;
        ok("match-proposed", `requestId=${matchRequestId} block=${proposed[0].blockNumber}`);
      }
    }

    if (matchRequestId !== undefined && !settled) {
      const settledEvs = await dark.queryFilter(
        dark.filters.MatchSettled(matchRequestId), submitBlock, head,
      );
      if (settledEvs.length > 0) {
        settled = true;
        ok("match-settled", `block=${settledEvs[0].blockNumber}`);
      } else {
        const aborted = await dark.queryFilter(
          dark.filters.MatchAborted(matchRequestId), submitBlock, head,
        );
        if (aborted.length > 0) {
          fail("match-settled",
            `MatchAborted: reason=${(aborted[0] as any).args.reason} requestId=${matchRequestId}`);
        }
        const rejected = await dark.queryFilter(
          dark.filters.MatchRejected(matchRequestId), submitBlock, head,
        );
        if (rejected.length > 0) {
          fail("match-settled",
            `MatchRejected (limits don't intersect at oracle=${oraclePrice}; this should be impossible since we set ` +
            `buyLimit=${buyLimit}, sellLimit=${sellLimit}). requestId=${matchRequestId}`);
        }
      }
    }

    if (settled && positionsSeen < 2) {
      const events = await vault.queryFilter(
        vault.filters.PositionOpened(), submitBlock, head,
      );
      for (const ev of events) {
        const owner = ((ev as any).args.owner as string).toLowerCase();
        if (owner !== traderA.address.toLowerCase() && owner !== traderB.address.toLowerCase()) continue;
        const id = (ev as any).args.positionId as bigint;
        if (opened.some(o => o.positionId === id)) continue;
        opened.push({
          positionId: id,
          owner: (ev as any).args.owner as string,
          marketId: Number((ev as any).args.marketId),
        });
      }
      positionsSeen = opened.length;
      if (positionsSeen >= 2) break;
    }

    await new Promise(r => setTimeout(r, 4000));
  }

  if (matchRequestId === undefined) {
    fail("match-proposed",
      `no MatchProposed in ${timeoutMs / 1000}s — match-watcher bot is likely not running. ` +
      `Start it: cd bot && npm start (with bot/.env pointing at Sepolia).`);
  }
  if (!settled) fail("match-settled", `match in flight but no MatchSettled in time`);
  if (positionsSeen < 2) fail("positions", `expected 2 PositionOpened events, got ${positionsSeen}`);

  // Sanity: one position per trader, both on the right market.
  const ownerSet = new Set(opened.map(o => o.owner.toLowerCase()));
  if (!ownerSet.has(traderA.address.toLowerCase()) || !ownerSet.has(traderB.address.toLowerCase())) {
    fail("positions", `position owners ${[...ownerSet].join(", ")} != [${traderA.address}, ${traderB.address}]`);
  }
  for (const p of opened) {
    if (p.marketId !== marketId) {
      fail("positions", `position ${p.positionId} on market ${p.marketId}, expected ${marketId}`);
    }
  }

  console.log(`\n┌── PASS ──────────────────────────────────────`);
  for (const p of opened) {
    console.log(`│ position ${p.positionId.toString().padEnd(4)} owner=${p.owner} market=${p.marketId}`);
  }
  console.log(`└── pipeline verified end-to-end on live Sepolia (${(Date.now() - t0) / 1000}s total)`);
}

main().catch((e) => {
  console.error("\nUnexpected error:", e);
  process.exit(1);
});
