# Phase 7 — Off-chain Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three off-chain services (`oracle-relayer/`, `compliance-backend/`, `bot/`) so deployed contracts can actually function end-to-end on Sepolia: prices flow, KYC proofs are served, and async decryption + liquidation/trigger/match are driven by an unattended process.

**Architecture:** Three independent Node/TypeScript services. Each is its own npm package — no monorepo workspace required. They share read-only access to deployment artifacts (`contracts/deployments/<network>.json`) and ABI files exported by Hardhat. They communicate ONLY through the chain — no service-to-service RPC. This keeps the deploy/restart story trivial and matches the spec's threat model (orchestrator is a *liveness provider*, not a trust root).

**Tech stack (shared):**
- Node 20+ TypeScript
- `ethers@^6.13` (matches contracts/)
- `@zama-fhe/relayer-sdk@0.4.1` (EXACT pin — for `publicDecrypt` in bot)
- `dotenv@^16.4` for config
- `vitest@^2.0` for tests
- `pino@^9` for structured logging
- `tsx@^4` for dev runner

**Reference docs:**
- Spec: `docs/specs/2026-04-24-noirperp-design.md` §4.6 (Oracle), §4.7 (Compliance), §5.2 (Liquidation flow), §5.4 (Oracle update flow), §5.5 (Compliance onboarding)
- `docs/fhe-primitives.md` §5 (pull-based async decrypt) + §5.2.1 (multi-handle decrypt encoding)
- Existing patterns: `contracts/test/PerpEngine.Liquidation.test.ts`, `contracts/test/AMMEngine.RequestWithdraw.test.ts`, `contracts/test/LimitEngine.Trigger.test.ts`, `contracts/test/DarkpoolEngine.BatchMatch.test.ts` — these all exercise the same pull-decrypt flow the bot will drive in production.

**Spec alignment & deviations** (intentional, documented):
1. **Compliance KYC provider stubbed.** Spec §5.5 mentions Sumsub/Persona; for Phase 7 we use a JSON-file allowlist gated by an admin API key. Real KYC integration is post-submission scope.
2. **Bot is single-process, no queue.** Spec §3 calls out "orchestrator bot"; we don't spec'd Redis/BullMQ. Single Node process subscribing to events + polling on a tick. Simpler and within the demo's operational scope.
3. **No 3rd relayer running by default.** Spec §5.4 says 3 relayers; Oracle contract enforces 2-of-3 quorum. We run relayer A + relayer B in process; relayer C exists in the contract relayer set but stays offline until it's needed for rotation drills (Phase 9). The 2-of-3 quorum is satisfied by A+B.
4. **No paid Gateway $ZAMA fee handling.** Mock + Sepolia testnet runs on Zama's free tier; the bot does not need to manage $ZAMA balances. Real fees are post-submission.

---

## Service-1 / oracle-relayer

**Purpose:** Read Chainlink BTC/USD, ETH/USD, SOL/USD price feeds and post them to `Oracle.submitPrice(marketId, price, timestamp)` from two relayer accounts (A + B), satisfying the on-chain 2-of-3 quorum.

**Process model:** Single Node process. On startup: load deployment config + 2 relayer private keys. Tick loop every `POLL_INTERVAL_MS` (default 30s):
1. For each market (BTC=1, ETH=2, SOL=3):
   - Fetch latest Chainlink price (use mock feed in local dev).
   - Submit from relayer A wallet.
   - Submit from relayer B wallet (timestamp + 1 to satisfy contract's "different relayer + within window" rule).
2. Sleep until next tick.

**Files:**
- `oracle-relayer/package.json`
- `oracle-relayer/tsconfig.json`
- `oracle-relayer/.env.example`
- `oracle-relayer/src/config.ts` — env loading + deployment.json reader
- `oracle-relayer/src/chainlink.ts` — Chainlink reader (with mock for local)
- `oracle-relayer/src/relayer.ts` — submission loop
- `oracle-relayer/src/index.ts` — entrypoint
- `oracle-relayer/test/relayer.test.ts` — vitest unit tests
- `oracle-relayer/test/integration.test.ts` — runs against `npx hardhat node`

---

## Service-2 / compliance-backend

**Purpose:** Serve Merkle proofs for allowlisted addresses; admin-gated endpoint to add/remove addresses (rebuilds tree, returns new root for the multisig admin to apply on-chain via `Compliance.updateRoot(newRoot)`).

**Process model:** Single Express server. State: a JSON file `data/allowlist.json` (`{addresses: ["0x...", ...]}`). On startup: load file, build Merkle tree (using `@openzeppelin/merkle-tree`, same as contracts/ tests). On admin add/remove: mutate file, rebuild tree, persist new root.

**Endpoints:**
- `GET /proof/:address` → `{ root, proof, allowlisted }` — public
- `POST /admin/add` (header `x-api-key`) → `{ added, newRoot }` — gated
- `POST /admin/remove` (header `x-api-key`) → `{ removed, newRoot }` — gated
- `GET /health` → `{ status, root, count }` — public

**Files:**
- `compliance-backend/package.json`
- `compliance-backend/tsconfig.json`
- `compliance-backend/.env.example`
- `compliance-backend/src/config.ts`
- `compliance-backend/src/tree.ts` — Merkle tree builder + persister
- `compliance-backend/src/server.ts` — Express app
- `compliance-backend/src/index.ts` — entrypoint
- `compliance-backend/data/allowlist.json` — committed empty `{addresses:[]}`
- `compliance-backend/test/tree.test.ts`
- `compliance-backend/test/server.test.ts`

---

## Service-3 / bot

**Purpose:** Drive async-decryption and trigger flows that engines expose. Four logical watchers in one process:

1. **Liquidation watcher** — for each `PerpEngine.PositionOpened` event, track positionIds. On each oracle price tick (heuristic: every N seconds), call `requestLiquidation(positionId)` for each *active* position. Engine evaluates underwater on ciphertexts.
2. **Trigger watcher** — for each `LimitEngine.OrderPlaced` event, track orderIds. On each oracle price tick, call `requestTrigger(orderId)` for each active order.
3. **Batch matcher** — for each `DarkpoolEngine.OrderSubmitted` event, track orderIds. On each tick, group by market and call `requestBatchMatch(orderIds)` for groups ≥1 and ≤10 (HCU cap). MVP: take all active orders per market per tick.
4. **Decrypt-relay** — listens to all four async-decrypt events: `LiquidationRequested`, `WithdrawRequested`, `TriggerRequested`, `BatchMatchRequested`. For each, calls `relayerSDK.publicDecrypt(handles)`, then calls back the appropriate engine's `_onXDecided(...)`.

**Process model:** Single Node process. ethers v6 `WebSocketProvider` subscribes to all events. A tick loop (default 15s) drives liquidation/trigger/batch retries. Watchers track tracked-orderIds in memory; persistence is event-replay-on-start (no Redis needed).

**Files:**
- `bot/package.json`
- `bot/tsconfig.json`
- `bot/.env.example`
- `bot/src/config.ts`
- `bot/src/clients.ts` — ethers provider, signer, contract instances, relayer SDK setup
- `bot/src/state.ts` — tracked positionIds / orderIds / batchOrderIds (in-memory Sets)
- `bot/src/watchers/liquidation.ts`
- `bot/src/watchers/trigger.ts`
- `bot/src/watchers/batch.ts`
- `bot/src/watchers/decrypt-relay.ts`
- `bot/src/index.ts`
- `bot/test/state.test.ts`
- `bot/test/integration.test.ts` — full end-to-end against `npx hardhat node`

---

## Task ordering rationale

Bot depends on prices being live (oracle-relayer) and on KYC users existing (compliance-backend). So:

1. Branch + shared plumbing
2. Oracle-relayer (3 tasks)
3. Compliance-backend (3 tasks)
4. Bot (5 tasks: scaffold, state, three watcher groups, decrypt-relay)
5. Integration smoke test (all three running)
6. Tier 1 audit
7. Tick + merge

---

### Task 0: Branch + shared plumbing

**Files:**
- Modify: `contracts/scripts/deploy-local.ts` — write deployment addresses to JSON
- Create: `contracts/deployments/.gitkeep` (track empty dir)
- Modify: `.gitignore` — ignore `contracts/deployments/local.json`

- [ ] **Step 1: Verify branch + baseline**

```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
```
Expected: `phase-7-offchain-services` and 287 passing.

- [ ] **Step 2: Modify `deploy-local.ts` to write `contracts/deployments/local.json`**

At the end of `main()` in `/Users/ram/Desktop/NoirPerp/contracts/scripts/deploy-local.ts`, just before the final banner log, add:

```typescript
  // Write deployment artifacts for off-chain services
  const fs = await import("fs");
  const path = await import("path");
  const deploymentDir = path.resolve(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentDir, { recursive: true });
  const deployment = {
    network: "local",
    chainId: 31337,
    deployedAt: new Date().toISOString(),
    contracts: {
      MockERC7984: await token.getAddress(),
      Compliance: await compliance.getAddress(),
      Oracle: await oracle.getAddress(),
      NoirVault: await vault.getAddress(),
      PerpEngine: await perp.getAddress(),
      AMMEngine: await amm.getAddress(),
      LimitEngine: await limit.getAddress(),
      DarkpoolEngine: await dark.getAddress(),
    },
    relayers: [relayerA.address, relayerB.address, relayerC.address],
    admin: admin.address,
  };
  fs.writeFileSync(
    path.join(deploymentDir, "local.json"),
    JSON.stringify(deployment, null, 2),
  );
  console.log("Deployment artifacts written to deployments/local.json");
```

- [ ] **Step 3: Create `contracts/deployments/.gitkeep`**

```bash
mkdir -p /Users/ram/Desktop/NoirPerp/contracts/deployments && touch /Users/ram/Desktop/NoirPerp/contracts/deployments/.gitkeep
```

- [ ] **Step 4: Add `.gitignore` rule**

Append to `/Users/ram/Desktop/NoirPerp/.gitignore`:

```
# Local deployment artifacts (regenerated per deploy-local run)
contracts/deployments/local.json
```

- [ ] **Step 5: Verify deploy script writes the file**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat run scripts/deploy-local.ts && cat deployments/local.json | head -20
```
Expected: 8 contract addresses + 3 relayers + admin.

- [ ] **Step 6: CHANGELOG + commit**

Append to `CHANGELOG.md` under a new Phase 7 in-progress section:

```markdown
### Phase 7 — Off-chain services (in progress)

- **Modified**: `contracts/scripts/deploy-local.ts` — writes
  `contracts/deployments/local.json` after deploy. Off-chain services
  read this file to get contract addresses + relayer/admin keys.
  **Files**: `contracts/scripts/deploy-local.ts`,
  `contracts/deployments/.gitkeep`, `.gitignore`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add contracts/scripts/deploy-local.ts contracts/deployments/.gitkeep .gitignore CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "chore(scripts): write deployment artifacts to deployments/local.json

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: oracle-relayer scaffold + Chainlink reader

**Files:**
- Create: `oracle-relayer/package.json`
- Create: `oracle-relayer/tsconfig.json`
- Create: `oracle-relayer/.env.example`
- Create: `oracle-relayer/src/config.ts`
- Create: `oracle-relayer/src/chainlink.ts`
- Create: `oracle-relayer/test/chainlink.test.ts`
- Create: `oracle-relayer/.gitignore`

- [ ] **Step 1: Create `package.json`**

`/Users/ram/Desktop/NoirPerp/oracle-relayer/package.json`:

```json
{
  "name": "@noirperp/oracle-relayer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "NoirPerp 2-of-3 Chainlink relayer service — submits BTC/ETH/SOL prices to Oracle.sol",
  "license": "MIT",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "ethers": "^6.13.0",
    "pino": "^9.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create `.env.example` and `.gitignore`**

`.env.example`:
```
# Sepolia RPC (or local: http://127.0.0.1:8545)
RPC_URL=http://127.0.0.1:8545

# Path to deployment artifacts JSON
DEPLOYMENT_PATH=../contracts/deployments/local.json

# Two relayer private keys — must match relayers[0] and relayers[1] in deployment.json
RELAYER_A_PRIVKEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
RELAYER_B_PRIVKEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

# How often to push prices (ms)
POLL_INTERVAL_MS=30000

# For local dev: synthetic price tick. For Sepolia: would point to Chainlink AggregatorV3 addresses.
USE_MOCK_PRICES=true
```

`.gitignore`:
```
node_modules
dist
.env
coverage
```

- [ ] **Step 4: Write failing test for `chainlink.ts`**

Create `/Users/ram/Desktop/NoirPerp/oracle-relayer/test/chainlink.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mockPrice, MARKETS } from "../src/chainlink.js";

describe("chainlink — mock price source", () => {
  it("returns a positive integer price for each market", () => {
    for (const m of MARKETS) {
      const p = mockPrice(m.id);
      expect(p).toBeGreaterThan(0n);
      expect(typeof p).toBe("bigint");
    }
  });

  it("returns deterministic prices given a seed", () => {
    const a = mockPrice(MARKETS[0].id, 42);
    const b = mockPrice(MARKETS[0].id, 42);
    expect(a).toEqual(b);
  });

  it("varies across markets", () => {
    const btc = mockPrice(MARKETS[0].id, 1);
    const eth = mockPrice(MARKETS[1].id, 1);
    const sol = mockPrice(MARKETS[2].id, 1);
    expect(btc).not.toEqual(eth);
    expect(eth).not.toEqual(sol);
  });
});
```

- [ ] **Step 5: Run test → expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/oracle-relayer && npm install && npm test
```
Expected: cannot find module `../src/chainlink.js`.

- [ ] **Step 6: Implement `src/chainlink.ts`**

```typescript
/**
 * Chainlink price source. Production targets AggregatorV3 contracts
 * on the chains documented in spec §5.4. For local dev we emit
 * synthetic prices that drift around realistic values so the bot's
 * liquidation/trigger logic exercises both directions.
 */
export type Market = { id: number; name: string; basePrice: bigint };

export const MARKETS: Market[] = [
  { id: 1, name: "BTC/USD", basePrice: 60_000n },
  { id: 2, name: "ETH/USD", basePrice: 3_000n },
  { id: 3, name: "SOL/USD", basePrice: 150n },
];

/**
 * Deterministic synthetic price. seed=undefined → uses Date.now()/1000s
 * which produces a slow drift. Tests pass an explicit seed for determinism.
 */
export function mockPrice(marketId: number, seed?: number): bigint {
  const market = MARKETS.find((m) => m.id === marketId);
  if (!market) throw new Error(`unknown marketId: ${marketId}`);
  const t = seed ?? Math.floor(Date.now() / 1000);
  // Drift by ±2% based on a sin-style cycle
  const drift = (((t + marketId * 1000) % 200) - 100) / 100; // -1.0..+1.0
  const adjusted = Number(market.basePrice) * (1 + drift * 0.02);
  return BigInt(Math.round(adjusted));
}
```

- [ ] **Step 7: Run test → expect PASS**

```bash
cd /Users/ram/Desktop/NoirPerp/oracle-relayer && npm test
```
Expected: 3 passing.

- [ ] **Step 8: Implement `src/config.ts`**

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export type Deployment = {
  network: string;
  chainId: number;
  contracts: Record<string, string>;
  relayers: string[];
  admin: string;
};

export type Config = {
  rpcUrl: string;
  deployment: Deployment;
  relayerAKey: string;
  relayerBKey: string;
  pollIntervalMs: number;
  useMockPrices: boolean;
};

export function loadConfig(): Config {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  const deploymentPath = resolve(process.cwd(), need("DEPLOYMENT_PATH"));
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as Deployment;
  return {
    rpcUrl: need("RPC_URL"),
    deployment,
    relayerAKey: need("RELAYER_A_PRIVKEY"),
    relayerBKey: need("RELAYER_B_PRIVKEY"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30000),
    useMockPrices: process.env.USE_MOCK_PRICES === "true",
  };
}
```

- [ ] **Step 9: CHANGELOG + commit**

CHANGELOG entry:
```markdown
- **Added**: `oracle-relayer/` scaffold (package.json, tsconfig,
  .env.example, .gitignore) + `chainlink.ts` mock price source +
  `config.ts` env loader. 3 vitest tests passing.
  **Files**: `oracle-relayer/package.json`, `oracle-relayer/tsconfig.json`,
  `oracle-relayer/.env.example`, `oracle-relayer/.gitignore`,
  `oracle-relayer/src/{chainlink,config}.ts`,
  `oracle-relayer/test/chainlink.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add oracle-relayer/ CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(oracle-relayer): scaffold + Chainlink mock price source

3 vitest tests for deterministic mock price.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: oracle-relayer submission loop

**Files:**
- Create: `oracle-relayer/src/relayer.ts`
- Create: `oracle-relayer/src/index.ts`
- Create: `oracle-relayer/test/relayer.test.ts`

- [ ] **Step 1: Write failing test for `relayer.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitTick } from "../src/relayer.js";
import { MARKETS } from "../src/chainlink.js";

describe("relayer — submitTick", () => {
  let oracleA: any;
  let oracleB: any;
  let logger: any;

  beforeEach(() => {
    oracleA = { submitPrice: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }) };
    oracleB = { submitPrice: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }) };
    logger = { info: vi.fn(), error: vi.fn() };
  });

  it("submits a price for each market from each relayer", async () => {
    await submitTick(oracleA, oracleB, logger, () => 1234n);
    expect(oracleA.submitPrice).toHaveBeenCalledTimes(MARKETS.length);
    expect(oracleB.submitPrice).toHaveBeenCalledTimes(MARKETS.length);
  });

  it("uses the priceFn to fetch each market's price", async () => {
    const fn = vi.fn().mockReturnValue(9999n);
    await submitTick(oracleA, oracleB, logger, fn);
    expect(fn).toHaveBeenCalledTimes(MARKETS.length);
  });

  it("does not throw if a single submission fails — logs and continues", async () => {
    oracleA.submitPrice = vi.fn()
      .mockRejectedValueOnce(new Error("nonce"))
      .mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) });
    await expect(submitTick(oracleA, oracleB, logger, () => 1234n)).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → expect FAIL** (`cannot find module ../src/relayer.js`)

- [ ] **Step 3: Implement `src/relayer.ts`**

```typescript
import { Contract } from "ethers";
import { MARKETS, mockPrice } from "./chainlink.js";

type Logger = { info: (msg: any, ...args: any[]) => void; error: (msg: any, ...args: any[]) => void };

export type PriceFn = (marketId: number) => bigint;

/**
 * One tick: for each market, fetch a price and submit from both relayers.
 * Each individual submission failure is logged but does not abort the tick.
 * Relayer B uses a +1 timestamp to satisfy Oracle.sol's "different submission"
 * rule which requires distinct (relayer, timestamp) pairs.
 */
export async function submitTick(
  oracleA: Contract,
  oracleB: Contract,
  logger: Logger,
  priceFn: PriceFn = mockPrice,
): Promise<void> {
  const t = Math.floor(Date.now() / 1000);
  for (const market of MARKETS) {
    const price = priceFn(market.id);
    try {
      const tx = await oracleA.submitPrice(market.id, price, t);
      await tx.wait();
      logger.info({ marketId: market.id, market: market.name, price: price.toString(), relayer: "A" }, "submitted");
    } catch (err) {
      logger.error({ marketId: market.id, relayer: "A", err: (err as Error).message }, "submit failed");
    }
    try {
      const tx = await oracleB.submitPrice(market.id, price, t + 1);
      await tx.wait();
      logger.info({ marketId: market.id, market: market.name, price: price.toString(), relayer: "B" }, "submitted");
    } catch (err) {
      logger.error({ marketId: market.id, relayer: "B", err: (err as Error).message }, "submit failed");
    }
  }
}
```

- [ ] **Step 4: Run → expect 3 passing**

- [ ] **Step 5: Implement `src/index.ts`**

```typescript
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import pino from "pino";
import { loadConfig } from "./config.js";
import { submitTick } from "./relayer.js";

// Minimal ABI — only what we call
const ORACLE_ABI = [
  "function submitPrice(uint8 marketId, uint64 price, uint64 timestamp) external",
];

async function main() {
  const cfg = loadConfig();
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const oracleAddr = cfg.deployment.contracts.Oracle;
  const walletA = new Wallet(cfg.relayerAKey, provider);
  const walletB = new Wallet(cfg.relayerBKey, provider);
  const oracleA = new Contract(oracleAddr, ORACLE_ABI, walletA);
  const oracleB = new Contract(oracleAddr, ORACLE_ABI, walletB);

  logger.info({ oracle: oracleAddr, A: walletA.address, B: walletB.address }, "oracle-relayer start");

  // First tick immediately
  await submitTick(oracleA, oracleB, logger);

  // Then on interval — never sleep with setTimeout in a recursion (stack);
  // use setInterval but guard re-entry with a busy flag.
  let busy = false;
  setInterval(async () => {
    if (busy) {
      logger.info({}, "previous tick still running — skipping");
      return;
    }
    busy = true;
    try {
      await submitTick(oracleA, oracleB, logger);
    } finally {
      busy = false;
    }
  }, cfg.pollIntervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: CHANGELOG + commit**

```markdown
- **Added**: `oracle-relayer/src/{relayer,index}.ts` — `submitTick`
  helper (one tick = 3 markets × 2 relayers = 6 submissions, individual
  failures logged but don't abort) + main entrypoint with interval loop
  + busy-flag re-entry guard. 3 vitest tests for relayer helper.
  **Files**: `oracle-relayer/src/{relayer,index}.ts`,
  `oracle-relayer/test/relayer.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add oracle-relayer/ CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(oracle-relayer): submission loop + main entrypoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: oracle-relayer integration test

**Files:**
- Create: `oracle-relayer/test/integration.test.ts`

- [ ] **Step 1: Write integration test**

The test spins up no servers — it uses `child_process.spawn` to launch `npx hardhat node` if needed, but for simplicity assumes the user runs `npx hardhat node` in a separate terminal. The test calls `npm run dev` indirectly via importing the relayer modules and running them against an already-deployed Hardhat node.

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { submitTick } from "../src/relayer.js";

const HARDHAT_PORT = 8545;
const RPC = `http://127.0.0.1:${HARDHAT_PORT}`;

let hardhat: ChildProcess | undefined;
let deployment: any;

const ORACLE_ABI = [
  "function submitPrice(uint8 marketId, uint64 price, uint64 timestamp) external",
  "function getPrice(uint8 marketId) external view returns (uint64 price, bool fresh)",
];

async function waitForRpc(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const p = new JsonRpcProvider(RPC);
      await p.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("hardhat node did not start in time");
}

describe("oracle-relayer — integration against hardhat node", () => {
  beforeAll(async () => {
    hardhat = spawn(
      "npx",
      ["hardhat", "node", "--port", String(HARDHAT_PORT)],
      { cwd: resolve(__dirname, "..", "..", "contracts"), stdio: "ignore" },
    );
    await waitForRpc();

    // Deploy the suite fresh
    spawn(
      "npx",
      ["hardhat", "run", "scripts/deploy-local.ts", "--network", "localhost"],
      { cwd: resolve(__dirname, "..", "..", "contracts"), stdio: "ignore" },
    );
    // Wait for deployments file
    const deploymentPath = resolve(__dirname, "..", "..", "contracts", "deployments", "local.json");
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      try {
        deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
        if (deployment.contracts.Oracle) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(deployment).toBeDefined();
  }, 60_000);

  afterAll(() => {
    hardhat?.kill();
  });

  it("submitTick commits prices that getPrice returns as fresh", async () => {
    const provider = new JsonRpcProvider(RPC);
    // Hardhat default signers 1 + 2 are relayers A + B
    const walletA = new Wallet(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      provider,
    );
    const walletB = new Wallet(
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      provider,
    );
    const oracleA = new Contract(deployment.contracts.Oracle, ORACLE_ABI, walletA);
    const oracleB = new Contract(deployment.contracts.Oracle, ORACLE_ABI, walletB);
    const logger = { info: () => {}, error: console.error };

    await submitTick(oracleA, oracleB, logger, () => 3000n);

    const oracleRO = new Contract(deployment.contracts.Oracle, ORACLE_ABI, provider);
    const [price, fresh] = await oracleRO.getPrice(2); // ETH market
    expect(fresh).toEqual(true);
    expect(price).toEqual(3000n);
  }, 60_000);
});
```

- [ ] **Step 2: Run integration test**

```bash
cd /Users/ram/Desktop/NoirPerp/oracle-relayer && npm test -- integration
```

Expected: 1 passing.

**Failure modes**:
- Hardhat node port collision — if 8545 is already in use, change `HARDHAT_PORT`.
- Deployment script timing — if `local.json` isn't written within 30s, deploy script may have failed; check `cd ../contracts && npx hardhat run scripts/deploy-local.ts --network localhost` manually.

- [ ] **Step 3: CHANGELOG + commit**

```markdown
- **Added**: `oracle-relayer/test/integration.test.ts` — spins up
  hardhat node, deploys suite, submits a price tick, verifies
  `getPrice` returns the committed price as fresh. End-to-end relayer
  proof.
  **Files**: `oracle-relayer/test/integration.test.ts`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add oracle-relayer/ CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "test(oracle-relayer): end-to-end integration against hardhat node

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: compliance-backend scaffold + Merkle tree

**Files:**
- Create: `compliance-backend/package.json`
- Create: `compliance-backend/tsconfig.json`
- Create: `compliance-backend/.env.example`
- Create: `compliance-backend/.gitignore`
- Create: `compliance-backend/data/allowlist.json` — initial `{"addresses":[]}`
- Create: `compliance-backend/src/config.ts`
- Create: `compliance-backend/src/tree.ts`
- Create: `compliance-backend/test/tree.test.ts`

- [ ] **Step 1: Create scaffold files**

`package.json`:
```json
{
  "name": "@noirperp/compliance-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "NoirPerp KYC Merkle allowlist API",
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/supertest": "^6.0.0",
    "supertest": "^7.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "@openzeppelin/merkle-tree": "^1.0.8",
    "dotenv": "^16.4.7",
    "ethers": "^6.13.0",
    "express": "^5.0.0",
    "pino": "^9.0.0",
    "pino-http": "^10.0.0"
  }
}
```

`tsconfig.json` (same as oracle-relayer's).

`.env.example`:
```
PORT=4001
ALLOWLIST_PATH=./data/allowlist.json
ADMIN_API_KEY=local-dev-secret-CHANGE-IN-PROD
LOG_LEVEL=info
```

`.gitignore`:
```
node_modules
dist
.env
coverage
```

`data/allowlist.json`:
```json
{"addresses":[]}
```

- [ ] **Step 2: Write failing test for `tree.ts`**

`test/tree.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AllowlistTree } from "../src/tree.js";

let path: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "noirperp-compliance-"));
  path = join(dir, "allowlist.json");
  writeFileSync(path, JSON.stringify({ addresses: [] }));
});

describe("AllowlistTree", () => {
  it("starts empty with ZeroHash root", async () => {
    const t = AllowlistTree.fromFile(path);
    expect(t.root).toBeDefined();
    expect(t.size).toEqual(0);
  });

  it("add() persists and rebuilds tree", async () => {
    const t = AllowlistTree.fromFile(path);
    const newRoot = t.add("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(t.size).toEqual(1);
    expect(newRoot).not.toEqual("0x" + "0".repeat(64));

    // Re-load from disk; should still have the one entry
    const t2 = AllowlistTree.fromFile(path);
    expect(t2.size).toEqual(1);
    expect(t2.root).toEqual(newRoot);
  });

  it("proof() returns a valid proof for an added address", async () => {
    const t = AllowlistTree.fromFile(path);
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    t.add(addr);
    const result = t.proof(addr);
    expect(result.allowlisted).toEqual(true);
    expect(result.proof).toBeDefined();
    expect(result.root).toEqual(t.root);
  });

  it("proof() for non-allowlisted returns allowlisted=false", () => {
    const t = AllowlistTree.fromFile(path);
    t.add("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    const result = t.proof("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
    expect(result.allowlisted).toEqual(false);
    expect(result.proof).toEqual([]);
  });

  it("remove() drops the entry and rebuilds", () => {
    const t = AllowlistTree.fromFile(path);
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    t.add(addr);
    t.remove(addr);
    expect(t.size).toEqual(0);
    expect(t.proof(addr).allowlisted).toEqual(false);
  });

  it("add() is idempotent for the same address", () => {
    const t = AllowlistTree.fromFile(path);
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    t.add(addr);
    const r1 = t.root;
    t.add(addr);
    expect(t.size).toEqual(1);
    expect(t.root).toEqual(r1);
  });
});
```

- [ ] **Step 3: Run → expect FAIL**

```bash
cd /Users/ram/Desktop/NoirPerp/compliance-backend && npm install && npm test
```

- [ ] **Step 4: Implement `src/tree.ts`**

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, ZeroHash } from "ethers";

type Persisted = { addresses: string[] };
type ProofResult = { root: string; allowlisted: boolean; proof: string[] };

/**
 * Wraps an OZ StandardMerkleTree built from `[address]` rows and persists
 * the underlying address list to a JSON file. Empty allowlist returns
 * ZeroHash as root (matches what the on-chain Compliance contract uses
 * to mean "deny everyone").
 */
export class AllowlistTree {
  private addresses: string[];
  private tree: StandardMerkleTree<[string]> | null;

  private constructor(private readonly path: string, addresses: string[]) {
    // Normalize all addresses to checksum form for consistent dedup
    this.addresses = Array.from(new Set(addresses.map((a) => getAddress(a))));
    this.tree = this.addresses.length > 0
      ? StandardMerkleTree.of(this.addresses.map((a) => [a]), ["address"])
      : null;
  }

  static fromFile(path: string): AllowlistTree {
    let data: Persisted;
    try {
      data = JSON.parse(readFileSync(path, "utf8")) as Persisted;
    } catch {
      data = { addresses: [] };
    }
    return new AllowlistTree(path, data.addresses);
  }

  get root(): string {
    return this.tree ? this.tree.root : ZeroHash;
  }

  get size(): number {
    return this.addresses.length;
  }

  add(addr: string): string {
    const checksum = getAddress(addr);
    if (this.addresses.includes(checksum)) return this.root;
    this.addresses.push(checksum);
    this.tree = StandardMerkleTree.of(this.addresses.map((a) => [a]), ["address"]);
    this.persist();
    return this.root;
  }

  remove(addr: string): string {
    const checksum = getAddress(addr);
    const idx = this.addresses.indexOf(checksum);
    if (idx === -1) return this.root;
    this.addresses.splice(idx, 1);
    this.tree = this.addresses.length > 0
      ? StandardMerkleTree.of(this.addresses.map((a) => [a]), ["address"])
      : null;
    this.persist();
    return this.root;
  }

  proof(addr: string): ProofResult {
    const checksum = getAddress(addr);
    if (!this.tree || !this.addresses.includes(checksum)) {
      return { root: this.root, allowlisted: false, proof: [] };
    }
    return {
      root: this.root,
      allowlisted: true,
      proof: this.tree.getProof([checksum]),
    };
  }

  private persist() {
    writeFileSync(this.path, JSON.stringify({ addresses: this.addresses }, null, 2));
  }
}
```

- [ ] **Step 5: Run → expect 6 passing**

- [ ] **Step 6: Implement `src/config.ts`**

```typescript
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

dotenvConfig();

export type Config = {
  port: number;
  allowlistPath: string;
  adminApiKey: string;
};

export function loadConfig(): Config {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  return {
    port: Number(process.env.PORT ?? 4001),
    allowlistPath: resolve(process.cwd(), process.env.ALLOWLIST_PATH ?? "./data/allowlist.json"),
    adminApiKey: need("ADMIN_API_KEY"),
  };
}
```

- [ ] **Step 7: CHANGELOG + commit**

```markdown
- **Added**: `compliance-backend/` scaffold + `AllowlistTree` Merkle
  builder backed by `data/allowlist.json`. Reuses
  `@openzeppelin/merkle-tree` (same as contracts' tests, so proofs
  verified by the same `StandardMerkleTree` algorithm). 6 vitest tests.
  **Files**: `compliance-backend/{package,tsconfig}.json`,
  `compliance-backend/.env.example`, `compliance-backend/.gitignore`,
  `compliance-backend/data/allowlist.json`,
  `compliance-backend/src/{config,tree}.ts`,
  `compliance-backend/test/tree.test.ts`.
```

Commit with message `feat(compliance-backend): scaffold + AllowlistTree Merkle builder`.

---

### Task 5: compliance-backend Express API

**Files:**
- Create: `compliance-backend/src/server.ts`
- Create: `compliance-backend/src/index.ts`
- Create: `compliance-backend/test/server.test.ts`

- [ ] **Step 1: Write failing test for server endpoints**

`test/server.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server.js";

const ADDR_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ADDR_B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const KEY = "test-key";

let app: any;
let path: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "compliance-"));
  path = join(dir, "allowlist.json");
  writeFileSync(path, JSON.stringify({ addresses: [] }));
  app = buildApp({ allowlistPath: path, adminApiKey: KEY });
});

describe("compliance-backend server", () => {
  it("GET /health returns root + count", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toEqual(200);
    expect(res.body.status).toEqual("ok");
    expect(res.body.count).toEqual(0);
  });

  it("GET /proof/:address returns allowlisted=false for unknown", async () => {
    const res = await request(app).get(`/proof/${ADDR_A}`);
    expect(res.status).toEqual(200);
    expect(res.body.allowlisted).toEqual(false);
    expect(res.body.proof).toEqual([]);
  });

  it("POST /admin/add without key returns 401", async () => {
    const res = await request(app).post("/admin/add").send({ address: ADDR_A });
    expect(res.status).toEqual(401);
  });

  it("POST /admin/add with key adds address and returns new root", async () => {
    const res = await request(app)
      .post("/admin/add")
      .set("x-api-key", KEY)
      .send({ address: ADDR_A });
    expect(res.status).toEqual(200);
    expect(res.body.added).toEqual(true);
    expect(res.body.newRoot).toBeDefined();
  });

  it("end-to-end: add then proof returns valid proof", async () => {
    await request(app)
      .post("/admin/add")
      .set("x-api-key", KEY)
      .send({ address: ADDR_A });
    const res = await request(app).get(`/proof/${ADDR_A}`);
    expect(res.body.allowlisted).toEqual(true);
    expect(res.body.proof.length).toBeGreaterThan(0);
  });

  it("POST /admin/remove drops entry", async () => {
    await request(app).post("/admin/add").set("x-api-key", KEY).send({ address: ADDR_A });
    await request(app).post("/admin/add").set("x-api-key", KEY).send({ address: ADDR_B });
    const res = await request(app)
      .post("/admin/remove")
      .set("x-api-key", KEY)
      .send({ address: ADDR_A });
    expect(res.status).toEqual(200);
    expect(res.body.removed).toEqual(true);
    const proof = await request(app).get(`/proof/${ADDR_A}`);
    expect(proof.body.allowlisted).toEqual(false);
  });

  it("POST /admin/add rejects invalid address", async () => {
    const res = await request(app)
      .post("/admin/add")
      .set("x-api-key", KEY)
      .send({ address: "not-an-address" });
    expect(res.status).toEqual(400);
  });
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Implement `src/server.ts`**

```typescript
import express, { Request, Response, NextFunction } from "express";
import { isAddress } from "ethers";
import { AllowlistTree } from "./tree.js";

type AppOpts = {
  allowlistPath: string;
  adminApiKey: string;
};

export function buildApp(opts: AppOpts) {
  const tree = AllowlistTree.fromFile(opts.allowlistPath);
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", root: tree.root, count: tree.size });
  });

  app.get("/proof/:address", (req, res) => {
    const addr = req.params.address;
    if (!isAddress(addr)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    res.json(tree.proof(addr));
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.header("x-api-key") !== opts.adminApiKey) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };

  app.post("/admin/add", requireAdmin, (req, res) => {
    const addr = req.body?.address;
    if (typeof addr !== "string" || !isAddress(addr)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    const newRoot = tree.add(addr);
    res.json({ added: true, newRoot, count: tree.size });
  });

  app.post("/admin/remove", requireAdmin, (req, res) => {
    const addr = req.body?.address;
    if (typeof addr !== "string" || !isAddress(addr)) {
      res.status(400).json({ error: "invalid address" });
      return;
    }
    const newRoot = tree.remove(addr);
    res.json({ removed: true, newRoot, count: tree.size });
  });

  return app;
}
```

- [ ] **Step 4: Implement `src/index.ts`**

```typescript
import pino from "pino";
import pinoHttp from "pino-http";
import { loadConfig } from "./config.js";
import { buildApp } from "./server.js";

const cfg = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = buildApp({ allowlistPath: cfg.allowlistPath, adminApiKey: cfg.adminApiKey });
app.use(pinoHttp({ logger }));

app.listen(cfg.port, () => {
  logger.info({ port: cfg.port, allowlist: cfg.allowlistPath }, "compliance-backend up");
});
```

- [ ] **Step 5: Run → expect 7 passing**

- [ ] **Step 6: CHANGELOG + commit**

```markdown
- **Added**: `compliance-backend/src/{server,index}.ts` — Express
  app with `/health`, `/proof/:address`, `/admin/add`, `/admin/remove`
  (admin gated by `x-api-key` header). 7 supertest-driven vitest tests.
  **Files**: `compliance-backend/src/{server,index}.ts`,
  `compliance-backend/test/server.test.ts`.
```

Commit with `feat(compliance-backend): Express API for proofs + admin`.

---

### Task 6: compliance-backend integration smoke

**Files:**
- Create: `compliance-backend/test/integration.test.ts`

This test verifies that an address added via the admin API gets a proof that **the on-chain Compliance contract verifies as valid**. This pins the off-chain Merkle algorithm to the on-chain one.

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { buildApp } from "../src/server.js";

const HARDHAT_PORT = 8546; // distinct from oracle-relayer's
const RPC = `http://127.0.0.1:${HARDHAT_PORT}`;
const KEY = "integration-key";

const COMPLIANCE_ABI = [
  "function verify(address user, bytes32[] calldata proof) external view returns (bool)",
  "function updateRoot(bytes32 newRoot) external",
];

let hardhat: ChildProcess | undefined;
let deployment: any;

async function waitForRpc(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const p = new JsonRpcProvider(RPC);
      await p.getBlockNumber();
      return;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error("hardhat node did not start");
}

describe("compliance-backend — on-chain proof verification", () => {
  beforeAll(async () => {
    hardhat = spawn(
      "npx", ["hardhat", "node", "--port", String(HARDHAT_PORT)],
      { cwd: resolve(__dirname, "..", "..", "contracts"), stdio: "ignore" },
    );
    await waitForRpc();
    spawn(
      "npx",
      ["hardhat", "run", "scripts/deploy-local.ts", "--network", "localhost"],
      { cwd: resolve(__dirname, "..", "..", "contracts"), stdio: "ignore" },
    );
    const deploymentPath = resolve(__dirname, "..", "..", "contracts", "deployments", "local.json");
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      try {
        deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
        if (deployment.contracts.Compliance) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(deployment).toBeDefined();
  }, 60_000);

  afterAll(() => { hardhat?.kill(); });

  it("backend-issued proof verifies on-chain after admin pushes new root", async () => {
    // Backend with empty allowlist
    const dir = mkdtempSync(join(tmpdir(), "compliance-int-"));
    const allowlistPath = join(dir, "allowlist.json");
    writeFileSync(allowlistPath, JSON.stringify({ addresses: [] }));
    const app = buildApp({ allowlistPath, adminApiKey: KEY });

    // Add an address (use Hardhat signer #4 — alice)
    const ALICE = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
    const addRes = await request(app).post("/admin/add").set("x-api-key", KEY).send({ address: ALICE });
    expect(addRes.body.added).toEqual(true);
    const newRoot = addRes.body.newRoot;

    // Admin pushes the root on-chain (Hardhat signer #0 is admin)
    const provider = new JsonRpcProvider(RPC);
    const adminWallet = new Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      provider,
    );
    const compliance = new Contract(deployment.contracts.Compliance, COMPLIANCE_ABI, adminWallet);
    await (await compliance.updateRoot(newRoot)).wait();

    // Pull the proof
    const proofRes = await request(app).get(`/proof/${ALICE}`);
    expect(proofRes.body.allowlisted).toEqual(true);

    // Verify on-chain
    const complianceRO = new Contract(deployment.contracts.Compliance, COMPLIANCE_ABI, provider);
    const ok = await complianceRO.verify(ALICE, proofRes.body.proof);
    expect(ok).toEqual(true);
  }, 60_000);
});
```

- [ ] **Step 2: Run → expect 1 passing** (this proves the off-chain Merkle algorithm matches the on-chain verifier)

- [ ] **Step 3: CHANGELOG + commit**

```markdown
- **Added**: `compliance-backend/test/integration.test.ts` — pins
  off-chain Merkle algorithm to on-chain `Compliance.verify`. Adds
  alice via admin API, pushes resulting root via the on-chain
  `updateRoot`, pulls the proof, then asserts on-chain `verify`
  returns true.
  **Files**: `compliance-backend/test/integration.test.ts`.
```

Commit with `test(compliance-backend): on-chain proof verification`.

---

### Task 7: bot scaffold + clients + state

**Files:**
- Create: `bot/package.json`
- Create: `bot/tsconfig.json`
- Create: `bot/.env.example`
- Create: `bot/.gitignore`
- Create: `bot/src/config.ts`
- Create: `bot/src/clients.ts`
- Create: `bot/src/state.ts`
- Create: `bot/test/state.test.ts`

- [ ] **Step 1: Create scaffold**

`package.json`:
```json
{
  "name": "@noirperp/bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "NoirPerp orchestrator bot — liquidator + TP/SL trigger + batch matcher + decrypt-relay",
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "@zama-fhe/relayer-sdk": "0.4.1",
    "dotenv": "^16.4.7",
    "ethers": "^6.13.0",
    "pino": "^9.0.0"
  }
}
```

`tsconfig.json`: same shape as oracle-relayer.

`.env.example`:
```
RPC_URL=http://127.0.0.1:8545
WS_URL=ws://127.0.0.1:8545
DEPLOYMENT_PATH=../contracts/deployments/local.json
BOT_PRIVKEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
TICK_INTERVAL_MS=15000
LOG_LEVEL=info
```

`.gitignore`: same as oracle-relayer.

- [ ] **Step 2: Implement `src/config.ts`**

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export type Deployment = {
  network: string;
  chainId: number;
  contracts: Record<string, string>;
  relayers: string[];
  admin: string;
};

export type Config = {
  rpcUrl: string;
  wsUrl: string;
  deployment: Deployment;
  botKey: string;
  tickIntervalMs: number;
};

export function loadConfig(): Config {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  const deploymentPath = resolve(process.cwd(), need("DEPLOYMENT_PATH"));
  return {
    rpcUrl: need("RPC_URL"),
    wsUrl: need("WS_URL"),
    deployment: JSON.parse(readFileSync(deploymentPath, "utf8")),
    botKey: need("BOT_PRIVKEY"),
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 15000),
  };
}
```

- [ ] **Step 3: Write failing test for `state.ts`**

`test/state.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { TrackedSet } from "../src/state.js";

describe("TrackedSet", () => {
  let set: TrackedSet<bigint>;

  beforeEach(() => { set = new TrackedSet<bigint>(); });

  it("starts empty", () => {
    expect(set.size).toEqual(0);
    expect(set.list()).toEqual([]);
  });

  it("add() inserts and is idempotent", () => {
    set.add(1n);
    set.add(1n);
    set.add(2n);
    expect(set.size).toEqual(2);
    expect(set.list().sort()).toEqual([1n, 2n]);
  });

  it("remove() drops entry", () => {
    set.add(1n);
    set.add(2n);
    set.remove(1n);
    expect(set.list()).toEqual([2n]);
  });

  it("has() reports membership", () => {
    set.add(1n);
    expect(set.has(1n)).toEqual(true);
    expect(set.has(2n)).toEqual(false);
  });

  it("groupBy() partitions by key", () => {
    set.add(1n);
    set.add(2n);
    set.add(3n);
    const groups = set.groupBy((id) => Number(id) % 2);
    expect(groups.get(1)).toEqual([1n, 3n]);
    expect(groups.get(0)).toEqual([2n]);
  });
});
```

- [ ] **Step 4: Run → expect FAIL**

- [ ] **Step 5: Implement `src/state.ts`**

```typescript
/**
 * Generic tracked-id set used by all watchers. In-memory only —
 * on bot restart, watchers replay events from the deployment block
 * to rebuild state. Persistence (Redis, file) is post-Phase-7 scope.
 */
export class TrackedSet<T> {
  private inner = new Set<T>();

  get size(): number { return this.inner.size; }
  has(v: T): boolean { return this.inner.has(v); }
  add(v: T): void { this.inner.add(v); }
  remove(v: T): void { this.inner.delete(v); }
  list(): T[] { return [...this.inner]; }
  groupBy<K>(keyFn: (v: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const v of this.inner) {
      const k = keyFn(v);
      const bucket = out.get(k) ?? [];
      bucket.push(v);
      out.set(k, bucket);
    }
    return out;
  }
}
```

- [ ] **Step 6: Run → expect 5 passing**

- [ ] **Step 7: Implement `src/clients.ts`**

```typescript
import { JsonRpcProvider, WebSocketProvider, Wallet, Contract } from "ethers";
import type { Deployment } from "./config.js";

// Minimal ABIs — only the methods/events the bot uses.
// Full ABIs ship with hardhat artifacts; these are hand-curated to keep
// the bot independent of hardhat compile state.
const PERP_ABI = [
  "event PositionOpened(uint256 indexed positionId, address indexed owner)",
  "event Liquidated(uint256 indexed positionId, address indexed keeper)",
  "event LiquidationChecked(uint256 indexed positionId)",
  "event LiquidationRequested(uint256 indexed requestId, uint256 indexed positionId, bytes32 handle)",
  "function requestLiquidation(uint256 positionId) external returns (uint256 requestId)",
  "function _onLiquidationDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
];

const LIMIT_ABI = [
  "event OrderPlaced(uint256 indexed orderId, address indexed owner, uint8 marketId, uint8 orderType)",
  "event OrderTriggered(uint256 indexed orderId)",
  "event OrderMissed(uint256 indexed orderId)",
  "event TriggerRequested(uint256 indexed requestId, uint256 indexed orderId, bytes32 handle)",
  "function requestTrigger(uint256 orderId) external returns (uint256 requestId)",
  "function _onTriggerDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
];

const DARK_ABI = [
  "event OrderSubmitted(uint256 indexed orderId, address indexed owner, uint8 marketId)",
  "event OrderCancelled(uint256 indexed orderId, address indexed owner)",
  "event BatchMatchRequested(uint256 indexed requestId, address indexed keeper, uint256[] orderIds, bytes32[] handles)",
  "event BatchSettled(uint256 indexed requestId, uint256[] orderIds, uint256[] shouldFires)",
  "function requestBatchMatch(uint256[] orderIds) external returns (uint256 requestId)",
  "function _onBatchDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
  "function getOrder(uint256 orderId) view returns (tuple(address owner, uint8 marketId, bool isLong, bool active, bytes32 size, bytes32 collateral, bytes32 limitPrice))",
];

const AMM_ABI = [
  "event WithdrawRequested(uint256 indexed requestId, address indexed user, bytes32 handle)",
  "function _onWithdrawDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
];

export type Clients = {
  rpc: JsonRpcProvider;
  ws: WebSocketProvider;
  signer: Wallet;
  perpRO: Contract; perpRW: Contract;
  limitRO: Contract; limitRW: Contract;
  darkRO: Contract; darkRW: Contract;
  ammRO: Contract; ammRW: Contract;
};

export function makeClients(rpcUrl: string, wsUrl: string, botKey: string, deployment: Deployment): Clients {
  const rpc = new JsonRpcProvider(rpcUrl);
  const ws = new WebSocketProvider(wsUrl);
  const signer = new Wallet(botKey, rpc);
  return {
    rpc, ws, signer,
    perpRO:   new Contract(deployment.contracts.PerpEngine,     PERP_ABI,  ws),
    perpRW:   new Contract(deployment.contracts.PerpEngine,     PERP_ABI,  signer),
    limitRO:  new Contract(deployment.contracts.LimitEngine,    LIMIT_ABI, ws),
    limitRW:  new Contract(deployment.contracts.LimitEngine,    LIMIT_ABI, signer),
    darkRO:   new Contract(deployment.contracts.DarkpoolEngine, DARK_ABI,  ws),
    darkRW:   new Contract(deployment.contracts.DarkpoolEngine, DARK_ABI,  signer),
    ammRO:    new Contract(deployment.contracts.AMMEngine,      AMM_ABI,   ws),
    ammRW:    new Contract(deployment.contracts.AMMEngine,      AMM_ABI,   signer),
  };
}
```

**Note on ABIs**: the events `LiquidationRequested`, `TriggerRequested`, `WithdrawRequested` may not exist with these exact names in the current contracts. Step 8 verifies that the contract emits an event whose `args.handle` (or similar) carries the ciphertext handle to decrypt. If the actual event name/shape differs, update the ABI here AND the watcher in Tasks 8/9/10. **Inspect** `contracts/contracts/engines/{PerpEngine,LimitEngine,AMMEngine}.sol` for the actual event names.

- [ ] **Step 8: Verify event names match contracts**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && grep -n "event " contracts/engines/PerpEngine.sol contracts/engines/LimitEngine.sol contracts/engines/AMMEngine.sol contracts/engines/DarkpoolEngine.sol | grep -i -E "request|decrypt"
```

If event names differ, update PERP_ABI / LIMIT_ABI / AMM_ABI in `clients.ts` to match. Document what was found in the CHANGELOG.

- [ ] **Step 9: CHANGELOG + commit**

```markdown
- **Added**: `bot/` scaffold + `src/{config,clients,state}.ts`.
  `TrackedSet` generic helper used by all watchers. `makeClients`
  wires WS provider for event subscriptions + JSON-RPC provider for
  reads + signer for writes; minimal ABIs hand-curated. Event names
  verified against {Perp,Limit,AMM,Darkpool}Engine.sol in Step 8.
  5 vitest tests for TrackedSet.
  **Files**: `bot/{package,tsconfig}.json`, `bot/.env.example`,
  `bot/.gitignore`, `bot/src/{config,clients,state}.ts`,
  `bot/test/state.test.ts`.
```

Commit `feat(bot): scaffold + clients + tracked-state helper`.

---

### Task 8: bot — liquidation watcher

**Files:**
- Create: `bot/src/watchers/liquidation.ts`
- Create: `bot/test/liquidation.test.ts`

**Behavior:** subscribe to `PositionOpened`, add positionId to tracked set. On each tick, call `requestLiquidation(positionId)` for each tracked id. On `Liquidated` or `LiquidationChecked`, remove from set.

- [ ] **Step 1: Write failing test**

`test/liquidation.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLiquidationTick } from "../src/watchers/liquidation.js";
import { TrackedSet } from "../src/state.js";

describe("liquidation watcher — runLiquidationTick", () => {
  let perpRW: any;
  let logger: any;
  let tracked: TrackedSet<bigint>;

  beforeEach(() => {
    perpRW = { requestLiquidation: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }) };
    logger = { info: vi.fn(), error: vi.fn() };
    tracked = new TrackedSet<bigint>();
  });

  it("calls requestLiquidation for each tracked positionId", async () => {
    tracked.add(1n);
    tracked.add(2n);
    await runLiquidationTick(perpRW, tracked, logger);
    expect(perpRW.requestLiquidation).toHaveBeenCalledTimes(2);
  });

  it("does nothing when tracked is empty", async () => {
    await runLiquidationTick(perpRW, tracked, logger);
    expect(perpRW.requestLiquidation).not.toHaveBeenCalled();
  });

  it("logs and continues on individual failure", async () => {
    tracked.add(1n);
    tracked.add(2n);
    perpRW.requestLiquidation = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) });
    await runLiquidationTick(perpRW, tracked, logger);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(perpRW.requestLiquidation).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Implement `src/watchers/liquidation.ts`**

```typescript
import type { Contract } from "ethers";
import type { TrackedSet } from "../state.js";

type Logger = { info: (msg: any, ...a: any[]) => void; error: (msg: any, ...a: any[]) => void };

/**
 * Subscribes to PositionOpened / Liquidated / LiquidationChecked.
 * Tracked positionIds are kept in a TrackedSet; each tick calls
 * requestLiquidation for every tracked id. Engine evaluates underwater
 * on ciphertexts and either fires (Liquidated) or no-ops (LiquidationChecked);
 * the listener prunes either way.
 */
export function subscribeLiquidation(
  perpRO: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): () => void {
  const onOpened = (positionId: bigint) => {
    tracked.add(positionId);
    logger.info({ positionId: positionId.toString() }, "tracked position opened");
  };
  const onLiq = (positionId: bigint) => {
    tracked.remove(positionId);
    logger.info({ positionId: positionId.toString() }, "untracked: liquidated");
  };
  const onChecked = (positionId: bigint) => {
    // Position survived this check; KEEP tracked (the bot keeps
    // probing it on subsequent ticks).
    logger.info({ positionId: positionId.toString() }, "liquidation checked, kept");
  };

  perpRO.on("PositionOpened", onOpened);
  perpRO.on("Liquidated", onLiq);
  perpRO.on("LiquidationChecked", onChecked);

  return () => {
    perpRO.off("PositionOpened", onOpened);
    perpRO.off("Liquidated", onLiq);
    perpRO.off("LiquidationChecked", onChecked);
  };
}

export async function runLiquidationTick(
  perpRW: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): Promise<void> {
  for (const positionId of tracked.list()) {
    try {
      const tx = await perpRW.requestLiquidation(positionId);
      await tx.wait();
      logger.info({ positionId: positionId.toString() }, "requestLiquidation sent");
    } catch (err) {
      logger.error({ positionId: positionId.toString(), err: (err as Error).message }, "requestLiquidation failed");
    }
  }
}
```

- [ ] **Step 4: Run → expect 3 passing**

- [ ] **Step 5: CHANGELOG + commit**

```markdown
- **Added**: `bot/src/watchers/liquidation.ts` — subscribes to
  PositionOpened / Liquidated / LiquidationChecked. Each tick calls
  requestLiquidation for every tracked positionId; engine evaluates
  underwater on ciphertexts. 3 vitest tests.
  **Files**: `bot/src/watchers/liquidation.ts`,
  `bot/test/liquidation.test.ts`.
```

Commit `feat(bot): liquidation watcher`.

---

### Task 9: bot — trigger watcher (LimitEngine)

**Files:**
- Create: `bot/src/watchers/trigger.ts`
- Create: `bot/test/trigger.test.ts`

**Behavior:** subscribe to `OrderPlaced` (LimitEngine) for TP/SL/LIMIT orders. Tick calls `requestTrigger(orderId)` per tracked id. Prune on `OrderTriggered` / `OrderMissed` / `OrderCancelled`. Verify `OrderCancelled` is emitted by LimitEngine — if not, drop that prune branch and rely on `OrderTriggered`/`OrderMissed`.

- [ ] **Step 1: Write failing test**

`bot/test/trigger.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTriggerTick } from "../src/watchers/trigger.js";
import { TrackedSet } from "../src/state.js";

describe("trigger watcher — runTriggerTick", () => {
  let limitRW: any;
  let logger: any;
  let tracked: TrackedSet<bigint>;

  beforeEach(() => {
    limitRW = { requestTrigger: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }) };
    logger = { info: vi.fn(), error: vi.fn() };
    tracked = new TrackedSet<bigint>();
  });

  it("calls requestTrigger for each tracked orderId", async () => {
    tracked.add(1n);
    tracked.add(2n);
    await runTriggerTick(limitRW, tracked, logger);
    expect(limitRW.requestTrigger).toHaveBeenCalledTimes(2);
  });

  it("does nothing when tracked is empty", async () => {
    await runTriggerTick(limitRW, tracked, logger);
    expect(limitRW.requestTrigger).not.toHaveBeenCalled();
  });

  it("logs and continues on individual failure", async () => {
    tracked.add(1n);
    tracked.add(2n);
    limitRW.requestTrigger = vi.fn()
      .mockRejectedValueOnce(new Error("oracle stale"))
      .mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) });
    await runTriggerTick(limitRW, tracked, logger);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(limitRW.requestTrigger).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Implement `src/watchers/trigger.ts`**

```typescript
import type { Contract } from "ethers";
import type { TrackedSet } from "../state.js";

type Logger = { info: (msg: any, ...a: any[]) => void; error: (msg: any, ...a: any[]) => void };

export function subscribeTrigger(
  limitRO: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): () => void {
  const onPlaced = (orderId: bigint) => {
    tracked.add(orderId);
    logger.info({ orderId: orderId.toString() }, "tracked limit order placed");
  };
  const onTriggered = (orderId: bigint) => {
    tracked.remove(orderId);
    logger.info({ orderId: orderId.toString() }, "untracked: triggered");
  };
  const onMissed = (orderId: bigint) => {
    // Order survived this check; KEEP tracked (the bot keeps probing).
    logger.info({ orderId: orderId.toString() }, "trigger missed, kept");
  };
  const onCancelled = (orderId: bigint) => {
    tracked.remove(orderId);
    logger.info({ orderId: orderId.toString() }, "untracked: cancelled");
  };

  limitRO.on("OrderPlaced", onPlaced);
  limitRO.on("OrderTriggered", onTriggered);
  limitRO.on("OrderMissed", onMissed);
  limitRO.on("OrderCancelled", onCancelled);

  return () => {
    limitRO.off("OrderPlaced", onPlaced);
    limitRO.off("OrderTriggered", onTriggered);
    limitRO.off("OrderMissed", onMissed);
    limitRO.off("OrderCancelled", onCancelled);
  };
}

export async function runTriggerTick(
  limitRW: Contract,
  tracked: TrackedSet<bigint>,
  logger: Logger,
): Promise<void> {
  for (const orderId of tracked.list()) {
    try {
      const tx = await limitRW.requestTrigger(orderId);
      await tx.wait();
      logger.info({ orderId: orderId.toString() }, "requestTrigger sent");
    } catch (err) {
      logger.error({ orderId: orderId.toString(), err: (err as Error).message }, "requestTrigger failed");
    }
  }
}
```

- [ ] **Step 4: Run → expect 3 passing**

- [ ] **Step 5: CHANGELOG + commit**

```markdown
- **Added**: `bot/src/watchers/trigger.ts` — same shape as liquidation
  but for LimitEngine TP/SL/LIMIT orders. 3 vitest tests.
  **Files**: `bot/src/watchers/trigger.ts`, `bot/test/trigger.test.ts`.
```

Commit `feat(bot): LimitEngine trigger watcher`.

---

### Task 10: bot — batch matcher (DarkpoolEngine)

**Files:**
- Create: `bot/src/watchers/batch.ts`
- Create: `bot/test/batch.test.ts`

**Behavior:** subscribe to `OrderSubmitted` (DarkpoolEngine). Track `(orderId, marketId)` pairs. Tick groups by marketId, sends one `requestBatchMatch(orderIds)` per group. **Cap each batch at 10** (HCU budget — see Phase 6 audit fix). Prune on `BatchSettled` (using the orderIds from the event payload) and on `OrderCancelled`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runBatchTick, MAX_BATCH_SIZE } from "../src/watchers/batch.js";
import { TrackedSet } from "../src/state.js";

describe("batch matcher — runBatchTick", () => {
  let darkRW: any;
  let logger: any;
  let tracked: TrackedSet<{ orderId: bigint; marketId: number }>;

  beforeEach(() => {
    darkRW = { requestBatchMatch: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }) };
    logger = { info: vi.fn(), error: vi.fn() };
    tracked = new TrackedSet<{ orderId: bigint; marketId: number }>();
  });

  it("groups by marketId and sends one call per group", async () => {
    tracked.add({ orderId: 1n, marketId: 1 });
    tracked.add({ orderId: 2n, marketId: 2 });
    tracked.add({ orderId: 3n, marketId: 1 });
    await runBatchTick(darkRW, tracked, logger);
    expect(darkRW.requestBatchMatch).toHaveBeenCalledTimes(2);
  });

  it("caps batch size at MAX_BATCH_SIZE", async () => {
    for (let i = 0; i < MAX_BATCH_SIZE + 5; i++) {
      tracked.add({ orderId: BigInt(i), marketId: 1 });
    }
    await runBatchTick(darkRW, tracked, logger);
    // 15 items / 10 per batch = 2 calls
    expect(darkRW.requestBatchMatch).toHaveBeenCalledTimes(2);
  });

  it("does nothing when tracked is empty", async () => {
    await runBatchTick(darkRW, tracked, logger);
    expect(darkRW.requestBatchMatch).not.toHaveBeenCalled();
  });

  it("logs and continues on per-batch failure", async () => {
    tracked.add({ orderId: 1n, marketId: 1 });
    tracked.add({ orderId: 2n, marketId: 2 });
    darkRW.requestBatchMatch = vi.fn()
      .mockRejectedValueOnce(new Error("oracle stale"))
      .mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) });
    await runBatchTick(darkRW, tracked, logger);
    expect(logger.error).toHaveBeenCalled();
    expect(darkRW.requestBatchMatch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Implement `src/watchers/batch.ts`**

```typescript
import type { Contract } from "ethers";
import type { TrackedSet } from "../state.js";

type Logger = { info: (msg: any, ...a: any[]) => void; error: (msg: any, ...a: any[]) => void };

export const MAX_BATCH_SIZE = 10; // per Phase 6 HCU audit — 5M sequential cap

export type DarkOrderRef = { orderId: bigint; marketId: number };

export function subscribeBatch(
  darkRO: Contract,
  tracked: TrackedSet<DarkOrderRef>,
  logger: Logger,
): () => void {
  const onSubmitted = (orderId: bigint, _owner: string, marketId: number) => {
    tracked.add({ orderId, marketId: Number(marketId) });
    logger.info({ orderId: orderId.toString(), marketId: Number(marketId) }, "tracked dark order");
  };
  const onSettled = (_requestId: bigint, orderIds: bigint[]) => {
    for (const oid of orderIds) {
      // We don't have marketId on the settle event — remove all matching orderIds
      for (const ref of tracked.list()) {
        if (ref.orderId === oid) tracked.remove(ref);
      }
    }
  };
  const onCancelled = (orderId: bigint) => {
    for (const ref of tracked.list()) {
      if (ref.orderId === orderId) tracked.remove(ref);
    }
  };

  darkRO.on("OrderSubmitted", onSubmitted);
  darkRO.on("BatchSettled", onSettled);
  darkRO.on("OrderCancelled", onCancelled);

  return () => {
    darkRO.off("OrderSubmitted", onSubmitted);
    darkRO.off("BatchSettled", onSettled);
    darkRO.off("OrderCancelled", onCancelled);
  };
}

export async function runBatchTick(
  darkRW: Contract,
  tracked: TrackedSet<DarkOrderRef>,
  logger: Logger,
): Promise<void> {
  const groups = tracked.groupBy((ref) => ref.marketId);
  for (const [marketId, refs] of groups) {
    // Chunk into MAX_BATCH_SIZE
    for (let i = 0; i < refs.length; i += MAX_BATCH_SIZE) {
      const chunk = refs.slice(i, i + MAX_BATCH_SIZE).map((r) => r.orderId);
      try {
        const tx = await darkRW.requestBatchMatch(chunk);
        await tx.wait();
        logger.info({ marketId, count: chunk.length }, "requestBatchMatch sent");
      } catch (err) {
        logger.error({ marketId, count: chunk.length, err: (err as Error).message }, "requestBatchMatch failed");
      }
    }
  }
}
```

**TrackedSet caveat**: object-equality on `{orderId,marketId}` doesn't work with the default Set semantics — adding the same object twice creates two entries. For this watcher we'll add a per-orderId dedupe by overriding `add` semantics in this watcher's state. Simpler: track with `Map<bigint, number>` instead of `TrackedSet`. **Pivot during implementation if needed**.

- [ ] **Step 4: Run → expect 4 passing**
- [ ] **Step 5: CHANGELOG + commit**

```markdown
- **Added**: `bot/src/watchers/batch.ts` — DarkpoolEngine batch matcher.
  Tracks (orderId, marketId) refs from OrderSubmitted; tick groups by
  marketId and chunks at MAX_BATCH_SIZE=10 (Phase 6 HCU audit cap).
  Prunes on BatchSettled / OrderCancelled. 4 vitest tests.
  **Files**: `bot/src/watchers/batch.ts`, `bot/test/batch.test.ts`.
```

Commit `feat(bot): DarkpoolEngine batch matcher`.

---

### Task 11: bot — decrypt-relay (single subscriber for 4 engines)

**Files:**
- Create: `bot/src/watchers/decrypt-relay.ts`
- Create: `bot/test/decrypt-relay.test.ts`

**Behavior:** subscribe to all 4 decrypt-request events. On each, call `relayerSDK.publicDecrypt(handles)` then call back the appropriate engine's `_onXDecided`. This is the single most novel piece — it's the **production analog** of what tests do via `hre.fhevm.publicDecrypt(...)`.

- [ ] **Step 1: Inspect actual event signatures**

The events emitted by the engines on decrypt requests are:
- `PerpEngine.LiquidationRequested(uint256 requestId, uint256 positionId, bytes32 handle)` — verify name + arg shape
- `LimitEngine.TriggerRequested(uint256 requestId, uint256 orderId, bytes32 handle)` — verify
- `DarkpoolEngine.BatchMatchRequested(uint256 requestId, address keeper, uint256[] orderIds, bytes32[] handles)` — confirmed Phase 6
- `AMMEngine.WithdrawRequested(uint256 requestId, address user, bytes32 handle)` — verify

**Run grep:**
```bash
cd /Users/ram/Desktop/NoirPerp/contracts && grep -nE "event.*Request" contracts/engines/*.sol
```

Update ABIs in `bot/src/clients.ts` if names/shapes differ. Document in commit.

- [ ] **Step 2: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSingleDecrypt, handleBatchDecrypt } from "../src/watchers/decrypt-relay.js";

describe("decrypt-relay", () => {
  let logger: any;
  let engine: any;
  let publicDecrypt: any;

  beforeEach(() => {
    logger = { info: vi.fn(), error: vi.fn() };
    engine = {
      _onLiquidationDecided: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
      _onBatchDecided: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
    };
    publicDecrypt = vi.fn().mockResolvedValue({
      abiEncodedClearValues: "0xabc",
      decryptionProof: "0xdef",
    });
  });

  it("single-handle: pulls publicDecrypt then calls _onXDecided with [handle]", async () => {
    const handle = "0x" + "1".repeat(64);
    await handleSingleDecrypt(
      { engine, callbackName: "_onLiquidationDecided", requestId: 7n, handle, publicDecrypt, logger },
    );
    expect(publicDecrypt).toHaveBeenCalledWith([handle]);
    expect(engine._onLiquidationDecided).toHaveBeenCalledWith(7n, [handle], "0xabc", "0xdef");
  });

  it("batch: pulls publicDecrypt with all handles then calls _onBatchDecided", async () => {
    const handles = ["0x" + "1".repeat(64), "0x" + "2".repeat(64)];
    await handleBatchDecrypt(
      { engine, requestId: 7n, handles, publicDecrypt, logger },
    );
    expect(publicDecrypt).toHaveBeenCalledWith(handles);
    expect(engine._onBatchDecided).toHaveBeenCalledWith(7n, handles, "0xabc", "0xdef");
  });

  it("single: logs and rethrows on publicDecrypt failure", async () => {
    publicDecrypt = vi.fn().mockRejectedValue(new Error("kms 503"));
    await expect(handleSingleDecrypt({
      engine, callbackName: "_onLiquidationDecided", requestId: 7n,
      handle: "0x" + "1".repeat(64), publicDecrypt, logger,
    })).rejects.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run → expect FAIL**

- [ ] **Step 4: Implement `src/watchers/decrypt-relay.ts`**

```typescript
import type { Contract } from "ethers";

type Logger = { info: (msg: any, ...a: any[]) => void; error: (msg: any, ...a: any[]) => void };

export type PublicDecryptFn = (handles: string[]) => Promise<{ abiEncodedClearValues: string; decryptionProof: string }>;

type SingleDecryptArgs = {
  engine: Contract;
  callbackName: string;
  requestId: bigint;
  handle: string;
  publicDecrypt: PublicDecryptFn;
  logger: Logger;
};

type BatchDecryptArgs = {
  engine: Contract;
  requestId: bigint;
  handles: string[];
  publicDecrypt: PublicDecryptFn;
  logger: Logger;
};

/**
 * Single-handle decrypt path: liquidation, trigger, withdraw all use it.
 * Engine callback signature is `(requestId, bytes32[] handles, bytes cleartexts, bytes proof)`.
 * For single-handle we wrap the handle in a 1-element array.
 */
export async function handleSingleDecrypt(args: SingleDecryptArgs): Promise<void> {
  const { engine, callbackName, requestId, handle, publicDecrypt, logger } = args;
  try {
    const { abiEncodedClearValues, decryptionProof } = await publicDecrypt([handle]);
    const tx = await (engine as any)[callbackName](requestId, [handle], abiEncodedClearValues, decryptionProof);
    await tx.wait();
    logger.info({ requestId: requestId.toString(), callbackName }, "decrypt-relay completed");
  } catch (err) {
    logger.error({ requestId: requestId.toString(), callbackName, err: (err as Error).message }, "decrypt-relay failed");
    throw err;
  }
}

/**
 * Batch decrypt path: DarkpoolEngine BatchMatchRequested with N handles.
 */
export async function handleBatchDecrypt(args: BatchDecryptArgs): Promise<void> {
  const { engine, requestId, handles, publicDecrypt, logger } = args;
  try {
    const { abiEncodedClearValues, decryptionProof } = await publicDecrypt(handles);
    const tx = await (engine as any)._onBatchDecided(requestId, handles, abiEncodedClearValues, decryptionProof);
    await tx.wait();
    logger.info({ requestId: requestId.toString(), n: handles.length }, "batch decrypt-relay completed");
  } catch (err) {
    logger.error({ requestId: requestId.toString(), err: (err as Error).message }, "batch decrypt-relay failed");
    throw err;
  }
}

/**
 * Wires all four engines' decrypt-request events to the appropriate handler.
 * Returns an unsubscribe function.
 */
export function subscribeDecryptRelay(
  perpRO: Contract, perpRW: Contract,
  limitRO: Contract, limitRW: Contract,
  ammRO: Contract, ammRW: Contract,
  darkRO: Contract, darkRW: Contract,
  publicDecrypt: PublicDecryptFn,
  logger: Logger,
): () => void {
  const onLiq = async (requestId: bigint, _positionId: bigint, handle: string) => {
    await handleSingleDecrypt({ engine: perpRW, callbackName: "_onLiquidationDecided", requestId, handle, publicDecrypt, logger }).catch(() => {});
  };
  const onTrig = async (requestId: bigint, _orderId: bigint, handle: string) => {
    await handleSingleDecrypt({ engine: limitRW, callbackName: "_onTriggerDecided", requestId, handle, publicDecrypt, logger }).catch(() => {});
  };
  const onWithdraw = async (requestId: bigint, _user: string, handle: string) => {
    await handleSingleDecrypt({ engine: ammRW, callbackName: "_onWithdrawDecided", requestId, handle, publicDecrypt, logger }).catch(() => {});
  };
  const onBatch = async (requestId: bigint, _keeper: string, _orderIds: bigint[], handles: string[]) => {
    await handleBatchDecrypt({ engine: darkRW, requestId, handles: [...handles], publicDecrypt, logger }).catch(() => {});
  };

  perpRO.on("LiquidationRequested", onLiq);
  limitRO.on("TriggerRequested", onTrig);
  ammRO.on("WithdrawRequested", onWithdraw);
  darkRO.on("BatchMatchRequested", onBatch);

  return () => {
    perpRO.off("LiquidationRequested", onLiq);
    limitRO.off("TriggerRequested", onTrig);
    ammRO.off("WithdrawRequested", onWithdraw);
    darkRO.off("BatchMatchRequested", onBatch);
  };
}
```

**Production publicDecrypt**: in production this comes from `@zama-fhe/relayer-sdk`'s `createInstance()` — see relayer-sdk docs. For local dev we can stub it via the hardhat plugin's mock; for Sepolia we wire the real SDK. Document the wire-up in `index.ts` (Task 12).

- [ ] **Step 5: Run → expect 3 passing**
- [ ] **Step 6: CHANGELOG + commit**

```markdown
- **Added**: `bot/src/watchers/decrypt-relay.ts` — single + batch
  decrypt-relay handlers. Subscribes to 4 decrypt-request events
  (Liquidation, Trigger, Withdraw, BatchMatch), pulls cleartexts via
  publicDecrypt(handles), calls back the engine's _onXDecided. This
  is the production analog of `hre.fhevm.publicDecrypt(...)` used in
  unit tests. 3 vitest tests.
  **Files**: `bot/src/watchers/decrypt-relay.ts`,
  `bot/test/decrypt-relay.test.ts`.
```

Commit `feat(bot): unified decrypt-relay across 4 engines`.

---

### Task 12: bot — main entrypoint + replay-on-start

**Files:**
- Create: `bot/src/index.ts`

**Behavior:** wires everything together.
1. Load config + clients.
2. Replay events from chain genesis (or a configured `START_BLOCK`) to rebuild tracked state.
3. Subscribe to all watchers.
4. Start tick loop.

For Phase 7 MVP we use the **hardhat-plugin's publicDecrypt for local** (importable via `import { fhevm } from "hardhat"` — won't work outside hardhat). For Sepolia we use the relayer-sdk: `await createInstance({ chainId: 11155111, networkUrl: rpcUrl }).publicDecrypt(handles)`. Phase 7 indexes both paths behind a `getPublicDecrypt(network)` factory; real Sepolia wiring lands in Phase 9.

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
import { JsonRpcProvider } from "ethers";
import pino from "pino";
import { loadConfig } from "./config.js";
import { makeClients } from "./clients.js";
import { TrackedSet } from "./state.js";
import { subscribeLiquidation, runLiquidationTick } from "./watchers/liquidation.js";
import { subscribeTrigger, runTriggerTick } from "./watchers/trigger.js";
import { subscribeBatch, runBatchTick, type DarkOrderRef } from "./watchers/batch.js";
import { subscribeDecryptRelay, type PublicDecryptFn } from "./watchers/decrypt-relay.js";

/**
 * For local hardhat: stub publicDecrypt that returns an empty payload.
 * The real implementation comes from `@zama-fhe/relayer-sdk` on Sepolia
 * (Phase 9). For local integration testing, the hardhat plugin's
 * fhevm.publicDecrypt is invoked from inside hardhat-runtime tests, not
 * from this stand-alone bot process — the bot's local mode is tested
 * via the integration smoke test where the hardhat node is a peer.
 */
async function makePublicDecrypt(network: string): Promise<PublicDecryptFn> {
  if (network === "local") {
    // Local stand-alone bot: cannot use hardhat plugin from here. Use the
    // relayer-sdk pointed at the local mock relayer URL if configured;
    // otherwise this branch is a no-op stub for now.
    return async (handles) => ({
      abiEncodedClearValues: "0x",
      decryptionProof: "0x",
    });
  }
  // Sepolia / mainnet: lazy-load relayer-sdk (heavy)
  const { createInstance } = await import("@zama-fhe/relayer-sdk");
  const instance = await createInstance({
    chainId: 11155111,
    networkUrl: process.env.RPC_URL!,
  });
  return async (handles) => {
    const result = await (instance as any).publicDecrypt(handles);
    return {
      abiEncodedClearValues: result.abiEncodedClearValues ?? result.cleartexts,
      decryptionProof: result.decryptionProof ?? result.proof,
    };
  };
}

async function main() {
  const cfg = loadConfig();
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  const clients = makeClients(cfg.rpcUrl, cfg.wsUrl, cfg.botKey, cfg.deployment);

  const liquidations = new TrackedSet<bigint>();
  const triggers = new TrackedSet<bigint>();
  const batches = new TrackedSet<DarkOrderRef>();

  // Replay from genesis (or START_BLOCK) — use the JSON-RPC provider
  // (queryFilter on WS providers is iffy in ethers v6).
  const fromBlock = Number(process.env.START_BLOCK ?? 0);
  await replayEvents(clients, fromBlock, liquidations, triggers, batches, logger);

  // Live subscriptions
  const unsubLiq = subscribeLiquidation(clients.perpRO, liquidations, logger);
  const unsubTrig = subscribeTrigger(clients.limitRO, triggers, logger);
  const unsubBatch = subscribeBatch(clients.darkRO, batches, logger);

  const publicDecrypt = await makePublicDecrypt(cfg.deployment.network);
  const unsubRelay = subscribeDecryptRelay(
    clients.perpRO, clients.perpRW,
    clients.limitRO, clients.limitRW,
    clients.ammRO, clients.ammRW,
    clients.darkRO, clients.darkRW,
    publicDecrypt, logger,
  );

  process.on("SIGTERM", () => { unsubLiq(); unsubTrig(); unsubBatch(); unsubRelay(); process.exit(0); });

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await Promise.all([
        runLiquidationTick(clients.perpRW, liquidations, logger),
        runTriggerTick(clients.limitRW, triggers, logger),
        runBatchTick(clients.darkRW, batches, logger),
      ]);
    } finally { busy = false; }
  }, cfg.tickIntervalMs);

  logger.info({ tick: cfg.tickIntervalMs }, "bot up");
}

async function replayEvents(
  clients: ReturnType<typeof makeClients>,
  fromBlock: number,
  liquidations: TrackedSet<bigint>,
  triggers: TrackedSet<bigint>,
  batches: TrackedSet<DarkOrderRef>,
  logger: any,
) {
  // PositionOpened
  const opened = await clients.perpRO.queryFilter("PositionOpened", fromBlock);
  const liquidated = await clients.perpRO.queryFilter("Liquidated", fromBlock);
  const liqIds = new Set(liquidated.map((e: any) => e.args.positionId.toString()));
  for (const ev of opened) {
    const id: bigint = (ev as any).args.positionId;
    if (!liqIds.has(id.toString())) liquidations.add(id);
  }

  // Limit OrderPlaced
  const placed = await clients.limitRO.queryFilter("OrderPlaced", fromBlock);
  const triggered = await clients.limitRO.queryFilter("OrderTriggered", fromBlock);
  const missed = await clients.limitRO.queryFilter("OrderMissed", fromBlock);
  const dropIds = new Set([...triggered, ...missed].map((e: any) => e.args.orderId.toString()));
  for (const ev of placed) {
    const id: bigint = (ev as any).args.orderId;
    if (!dropIds.has(id.toString())) triggers.add(id);
  }

  // Dark OrderSubmitted
  const submitted = await clients.darkRO.queryFilter("OrderSubmitted", fromBlock);
  const settled = await clients.darkRO.queryFilter("BatchSettled", fromBlock);
  const cancelled = await clients.darkRO.queryFilter("OrderCancelled", fromBlock);
  const dropDarkIds = new Set<string>();
  for (const ev of settled) {
    for (const oid of (ev as any).args.orderIds as bigint[]) dropDarkIds.add(oid.toString());
  }
  for (const ev of cancelled) dropDarkIds.add((ev as any).args.orderId.toString());
  for (const ev of submitted) {
    const id: bigint = (ev as any).args.orderId;
    if (!dropDarkIds.has(id.toString())) {
      batches.add({ orderId: id, marketId: Number((ev as any).args.marketId) });
    }
  }

  logger.info(
    { liquidations: liquidations.size, triggers: triggers.size, batches: batches.size },
    "replay complete",
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Build sanity check**

```bash
cd /Users/ram/Desktop/NoirPerp/bot && npm run build 2>&1 | tail -10
```

Expected: clean compile (no type errors). If errors, fix imports / types.

- [ ] **Step 3: CHANGELOG + commit**

```markdown
- **Added**: `bot/src/index.ts` — main entrypoint. Replays
  PositionOpened / OrderPlaced / OrderSubmitted (minus their
  termination events) from chain genesis to rebuild tracked state on
  startup. Wires all 4 watchers + decrypt-relay. Tick loop runs all
  three sync watchers in parallel with busy-flag re-entry guard.
  SIGTERM unwiring. Stub publicDecrypt for local; lazy-loads
  relayer-sdk on Sepolia.
  **Files**: `bot/src/index.ts`.
```

Commit `feat(bot): main entrypoint with event replay + tick loop`.

---

### Task 13: Phase 7 integration smoke test

**Files:**
- Create: `bot/test/integration.test.ts`

**Goal:** prove the bot can drive liquidation end-to-end against a hardhat node. This is the only test that exercises the FHEVM mock + the bot together.

The challenge: `publicDecrypt` from a stand-alone Node process can't easily call `hre.fhevm.publicDecrypt` (that requires the hardhat runtime). So this integration test runs **inside hardhat's runtime** — i.e., as a hardhat test in `contracts/test/`, NOT in `bot/test/`. It imports the bot's pure helpers (`runLiquidationTick`, `subscribeLiquidation`, etc.) and orchestrates them against the hardhat-deployed contracts.

- [ ] **Step 1: Write `contracts/test/Bot.Integration.test.ts`** that:
  1. Deploys the suite (same pattern as other tests).
  2. Opens a position that's borderline-underwater.
  3. Calls `runLiquidationTick` (imported from `../../bot/src/watchers/liquidation.js` — bot must be built first).
  4. Reads the emitted `LiquidationRequested` event.
  5. Calls `hre.fhevm.publicDecrypt([handle])` directly.
  6. Calls `perp._onLiquidationDecided(requestId, [handle], cleartexts, proof)`.
  7. Asserts position is closed (or LiquidationChecked emitted depending on price).

```typescript
import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { NoirVault, MockERC7984, Oracle, Compliance, PerpEngine } from "../typechain-types";
import { TrackedSet } from "../../bot/src/state.js";
import { runLiquidationTick } from "../../bot/src/watchers/liquidation.js";

describe("Phase 7 integration — bot drives liquidation", () => {
  // Standard test setup similar to Phase 3 PerpEngine tests
  // ... deploy contracts, set up alice with KYC, commit price, open position ...
  // ... move price to make position underwater via second commitPrice ...
  // ... call runLiquidationTick(perp, tracked, silentLogger) ...
  // ... receipt has LiquidationRequested event ...
  // ... use hre.fhevm.publicDecrypt + manual callback to complete async cycle ...
  // ... assert Liquidated event fired ...
});
```

The full test body follows the established hardhat-test pattern from `contracts/test/PerpEngine.Liquidation.test.ts` — copy that file's setup and substitute the manual `requestLiquidation(...)` call with `runLiquidationTick(perp, tracked, silentLogger)`. The test asserts that the bot's helper produces the same result as a direct call.

- [ ] **Step 2: Build the bot first so the import resolves**

```bash
cd /Users/ram/Desktop/NoirPerp/bot && npm run build
```

- [ ] **Step 3: Update `contracts/hardhat.config.ts` if needed** so that `import { runLiquidationTick } from "../../bot/src/watchers/liquidation.js"` resolves. Likely needs:
- `paths: { tests: "./test" }` (already set)
- `include: ["./test/**/*", "../bot/dist/**/*"]` in tsconfig.json — check current contracts/tsconfig.json and add as needed.

- [ ] **Step 4: Run integration test**

```bash
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test test/Bot.Integration.test.ts
```

Expected: 1 passing.

- [ ] **Step 5: CHANGELOG + commit**

```markdown
- **Added**: `contracts/test/Bot.Integration.test.ts` — runs inside
  hardhat runtime, imports bot's pure helpers (`runLiquidationTick`,
  state trackers) and asserts they produce the same result as direct
  `requestLiquidation` calls. Proves bot's helpers are correctly
  wiring against the FHEVM mock end-to-end.
  **Files**: `contracts/test/Bot.Integration.test.ts`.
```

Commit `test: Phase 7 integration — bot helpers drive liquidation`.

---

### Task 14: Tier 1 audit (mandatory phase gate)

Per `PROGRESS.md`, can't tick complete until both reviewers pass.

- [ ] **Step 1: Spec compliance reviewer (parallel, read-only)**

Use Agent tool, subagent_type=general-purpose, model=sonnet. Prompt:
> Review Phase 7 (off-chain services) against `/Users/ram/Desktop/NoirPerp/docs/plans/2026-04-25-phase-7-offchain-services.md` and `/Users/ram/Desktop/NoirPerp/docs/specs/2026-04-24-noirperp-design.md` §3, §5.4, §5.5. Plan documents 4 deviations: KYC stubbed, single-process bot (no queue), 2-of-3 quorum from A+B (C offline), no $ZAMA fee handling. Verify all 4 are explicitly in place. Verify the bot's decrypt-relay correctly translates the production `@zama-fhe/relayer-sdk` `publicDecrypt` API into the engine callback signatures `(requestId, handles[], cleartexts, proof)` matching the contracts. Verify env keys never get logged. Verify admin API key is required on /admin/* endpoints. Report ✅ compliant or ❌ issues with file:line.

- [ ] **Step 2: Code quality reviewer (parallel, read-only)**

> Code-quality review of Phase 7. Check: TypeScript strict mode, no `any` leaks in public APIs, dotenv keys never in commit history, custom errors / explicit status codes (Express), busy-flag re-entry guards on tick loops, WebSocket cleanup on SIGTERM, no unawaited promises. The decrypt-relay is the highest-risk piece — verify error handling can't drop a decrypted callback silently (replay safety on the contract side helps, but the bot should still log every failure). For the compliance backend: verify path traversal can't read other JSON files; verify CORS is sane (probably none needed since admin uses key, but document). Report APPROVED / APPROVED_WITH_MINOR_FIXES / NEEDS_REWORK.

- [ ] **Step 3: Address any critical/important findings inline**

- [ ] **Step 4: Re-run all tests**

```bash
cd /Users/ram/Desktop/NoirPerp/oracle-relayer && npm test &&
cd /Users/ram/Desktop/NoirPerp/compliance-backend && npm test &&
cd /Users/ram/Desktop/NoirPerp/bot && npm test &&
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -5
```

---

### Task 15: Phase 7 tick + merge

- [ ] **Step 1: Tick Phase 7 in PROGRESS.md**

Replace:
```markdown
- [ ] **Phase 7 — Off-chain services (bot, oracle-relayer, compliance-backend)**
  Plan: *(not yet written)*
```
with:
```markdown
- [x] **Phase 7 — Off-chain services** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-25-phase-7-offchain-services.md`
  Completion criteria met: 3 services live (oracle-relayer,
  compliance-backend, bot). Oracle-relayer: 2-of-3 quorum (A+B in-
  process, C offline) submits BTC/ETH/SOL prices on a tick.
  Compliance-backend: Express API for Merkle proofs + admin add/remove
  with on-chain root verification proven by integration test.
  Bot: 4 watchers (liquidation / trigger / batch / decrypt-relay) in
  one Node process; replays events on startup; tick loop with
  busy-flag re-entry guard. Tier 1 audit passed. 4 documented
  deviations from spec §3/§5.4/§5.5: KYC provider stubbed, single-
  process bot, 2-of-3 quorum without C, no $ZAMA fee handling.
  Test counts: oracle-relayer 7 (3 unit + 3 unit + 1 int);
  compliance-backend 14 (6 + 7 + 1 int); bot 18 (5 + 3 + 3 + 4 + 3);
  contracts: 288 (one new Bot.Integration.test).
```

- [ ] **Step 2: CHANGELOG complete entry**

```markdown
### Phase 7 complete ✅ (2026-04-XX)

- **Three off-chain services live** (local mock):
  - `oracle-relayer/` — 2-of-3 Chainlink relayer service. Tick loop
    submits BTC/ETH/SOL prices from relayers A+B.
  - `compliance-backend/` — Express + Merkle allowlist API. Off-chain
    Merkle algorithm pinned to on-chain `Compliance.verify` via
    integration test.
  - `bot/` — orchestrator. 4 watchers in one Node process:
    liquidation (PerpEngine), trigger (LimitEngine), batch
    (DarkpoolEngine), decrypt-relay (all 4 engines).
- **Spec deviations** (documented):
  1. KYC provider stubbed (JSON file allowlist, real KYC post-launch)
  2. Single-process bot (no Redis/queue)
  3. 2-of-3 quorum from A+B; C offline (rotation drill in Phase 9)
  4. No $ZAMA fee handling (testnet free tier)
- **Tier 1 audit**: passed.
- **Test counts**: 39 new (oracle-relayer 7, compliance 14, bot 18) +
  1 hardhat integration = 288 total contracts test pass.
- **Ready for Phase 8** (frontend).
```

- [ ] **Step 3: Commit + merge**

```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 7 complete — off-chain services live

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" && git checkout master && git merge --ff-only phase-7-offchain-services
```

---

## Appendix A — Why no service-to-service RPC

Each service ONLY talks to chain — never to each other directly. This means:
- Bot doesn't fetch prices from oracle-relayer over HTTP; it reads `Oracle.getPrice` on-chain.
- Bot doesn't ask compliance-backend to validate users; the on-chain `Compliance.verify` is the source of truth.

**Why:** simpler deploy/restart story (each service is independent), matches spec's threat model (each service is a *liveness* contributor, not a trust root), and easier to spin up partial sets for testing.

## Appendix B — Bot publicDecrypt wiring on Sepolia

Phase 7 stubs publicDecrypt for the `network: "local"` branch. For Sepolia (Phase 9):
1. Set `RPC_URL` to a Sepolia provider.
2. The bot's `makePublicDecrypt("sepolia")` lazy-imports `@zama-fhe/relayer-sdk` and constructs an instance with `chainId: 11155111`.
3. Configure relayer-sdk env (`RELAYER_URL`, etc) per Zama docs.

Real wiring lives in Phase 9, where Sepolia deployment + Slither/Mythril runs happen.

## Appendix C — Troubleshooting

**WebSocketProvider drops connection mid-tick**: ethers v6 attempts auto-reconnect. If reconnects fail, log it; the bot keeps polling-tick which still works against JSON-RPC. Production-grade requires a reconnect supervisor — out of scope for Phase 7.

**Replay-on-start is slow if chain has many blocks**: cap with `START_BLOCK` env. Phase 9 wires this to deployment block of the contracts.

**`tx.wait()` hangs in tests**: vitest test timeouts are 5s by default; integration tests bump to 60s. If still hangs, the contract reverted silently — turn on `tx.wait().catch(console.error)` and inspect.

**Service A starts before Service B is up**: services are independent and tolerate each other's downtime. The compliance-backend can be down without breaking the bot. Document in deploy/render.yaml comment.
