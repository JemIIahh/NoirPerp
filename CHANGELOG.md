# NoirPerp — Changelog

Every change documented BEFORE commit. Entry format:
- **What changed / added**
- **Why** (ticket, decision reference, or inline reason)
- **Root cause** (for bug fixes)
- **What was tried** (for bug fixes — including things that didn't work)
- **Files touched**

Purpose: prevent re-fixing already-fixed bugs; prevent re-visiting
solved design decisions; give future agents full context.

---

## 2026-04-25

### Phase 8 — Frontend (Tier 1 audit fixes)

- **Fixed (Important)**: Empty-input submit-button guards on Trade and Darkpool pages.
  - **Why**: Clicking "Open position" or "Submit dark order" with blank fields would pass empty-string state through `BigInt("")` conversion, causing a runtime throw inside the encrypt call. The button is now disabled until all required fields are non-empty.
  - **What changed**: `Trade.tsx` button: added `|| !size || !collateral`. `Darkpool.tsx` button: added `|| !size || !collateral || !limitPrice`. Liquidity already had equivalent guards; no change needed there.
  - **Files**: `frontend/src/pages/Trade.tsx`, `frontend/src/pages/Darkpool.tsx`.

- **Fixed (Important)**: Removed `LIMIT_ABI` dead export and `LimitEngine` from the `Deployment.contracts` type.
  - **Why**: Phase 8 scope is Trade, Liquidity, Darkpool, Portfolio, Compliance — no Limit Orders page. Per CLAUDE.md "no half-finished implementations", the unused ABI was removed. The `Deployment` type no longer references `LimitEngine`; the runtime deployment JSON still contains the key, but TypeScript's structural subtyping means extra properties are safely ignored.
  - **Grep confirmed**: `grep -rn "LIMIT_ABI\|LimitEngine" src/` returns empty — no remaining references.
  - **Files**: `frontend/src/lib/abis.ts`, `frontend/src/lib/types.ts`.

- **Fixed (Minor)**: Added explanatory comments on `as any` casts in `usePositions` and `useDarkOrders`.
  - **Why**: Audit flag — unexplained `as any` casts look suspicious. Comment clarifies that viem infers `unknown` for JSON-ABI tuple results and that the cast is safe because the fields are narrowed immediately below.
  - **Files**: `frontend/src/hooks/usePositions.ts`, `frontend/src/hooks/useDarkOrders.ts`.

- **Fixed (Minor)**: Added spec §6 staleness-check deferral TODO comment in `Compliance.tsx`.
  - **Why**: Spec §6 error-handling table requires warning users when the merkleRoot is older than 7 days. Implementation requires either extending the compliance-backend `/health` response with `rootUpdatedAt` or adding an on-chain read for `Compliance.rootUpdatedAt()`. Deferred to Phase 9; comment documents the deferral and the two implementation paths.
  - **Files**: `frontend/src/pages/Compliance.tsx`.

### Phase 8 — Frontend (in progress)

- **Added**: `frontend/` Vite + React 18 + TypeScript + Tailwind scaffold. Dependencies pinned: wagmi 2, viem 2, @tanstack/react-query 5, @rainbow-me/rainbowkit 2, @zama-fhe/relayer-sdk 0.4.1 (EXACT pin), react-router-dom 6. Tailwind theme `noir-{black,gray,line,mute,white,accent,green,red}` matches the dark-pool brand. Build clean, dev server boots on 127.0.0.1:5173.
  - **Files**: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/tailwind.config.js`, `frontend/postcss.config.js`, `frontend/index.html`, `frontend/.gitignore`, `frontend/.env.example`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`.

- **Added**: `frontend/src/lib/` shared utilities (Task 1). Deployment artifacts loaded via Vite alias `@deployments` (build-time) with runtime `fetch` fallback. Minimal hand-curated ABIs (8 contracts: MockERC7984, Compliance, Oracle, NoirVault, PerpEngine, AMMEngine, LimitEngine, DarkpoolEngine) keep the bundle small and surface auditable. Local mock for relayer SDK keeps UI clickable in dev; real SDK lazy-loads on Sepolia via `@zama-fhe/relayer-sdk/web` (confirmed export path at 0.4.1 — `createInstance` takes `FhevmInstanceConfig` with `network` string + preset spread from `SepoliaConfig`/`MainnetConfig`). `tsconfig.json` updated to add `"types": ["vite/client"]` for `import.meta.env`.
  - **Deviations from plan**: (1) `@zama-fhe/relayer-sdk/web` is the correct browser path (plan's text said "try root if /web doesn't resolve" — /web resolved fine). (2) `createInstance` takes `network` (EIP-1193 provider or URL string) + contract addresses spread from a preset, not `{chainId, networkUrl}` as sketched in plan Step 6. (3) `DARK_ABI.submitOrder` uses JSON ABI object form (not human-readable string) because viem's parser rejects nested tuple input syntax — all other 7 entries remain human-readable strings. (4) `tsconfig.json` gained `"types": ["vite/client"]` — missing from Task 0 scaffold, required for `import.meta.env` to type-check.
  - **Files**: `frontend/src/lib/markets.ts`, `frontend/src/lib/types.ts`, `frontend/src/lib/deployment.ts`, `frontend/src/lib/abis.ts`, `frontend/src/lib/wagmi.ts`, `frontend/src/lib/relayer.ts`, `frontend/src/lib/format.ts`, `frontend/tsconfig.json`.

- **Added**: `frontend/src/{App,providers}.tsx`, `frontend/src/components/{Header,Layout,WalletGate}.tsx`, 6 page stubs (`Home,Trade,Liquidity,Darkpool,Portfolio,Compliance.tsx`). wagmi + RainbowKit + react-router wired. Header with sticky nav + ConnectButton. Dark theme via Tailwind `noir-*` palette. `Providers` wraps WagmiProvider + QueryClientProvider + RainbowKitProvider with darkTheme. `Layout` renders Header + `<Outlet />` + footer. `WalletGate` blocks unauthenticated access with ConnectButton prompt. `App.tsx` uses BrowserRouter + nested Routes under Layout. Build clean; dev server boots on 127.0.0.1:5173.
  - **Files**: `frontend/src/App.tsx`, `frontend/src/providers.tsx`, `frontend/src/components/Header.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/components/WalletGate.tsx`, `frontend/src/pages/Home.tsx`, `frontend/src/pages/Trade.tsx`, `frontend/src/pages/Liquidity.tsx`, `frontend/src/pages/Darkpool.tsx`, `frontend/src/pages/Portfolio.tsx`, `frontend/src/pages/Compliance.tsx`.

- **Added**: `frontend/src/pages/Portfolio.tsx` + 3 hooks (`useDeployment`, `useEncryptedBalance`, `usePositions`) + `EncryptedValue` component (one-click reveal via userDecrypt). Portfolio shows a 3-col stat grid (wallet token plaintext, vault balance encrypted, AMM shares encrypted) and an open-positions table with per-row encrypted reveals for size, entry price, and collateral. Position enumeration: reads `nextPositionId`, fetches up to 50 most-recent positions in one `useReadContracts` multicall, filters by owner + active flag.
  - **Deviations from plan**: `parseAbi(VAULT_ABI)` fails at compile time for `getPosition` because viem's human-readable ABI parser does not support named-component tuple syntax (`tuple(address owner, uint8 marketId, ...)`). Fix: `usePositions` uses `SIMPLE_ABI = parseAbi(["function nextPositionId() view returns (uint256)"])` for the ID read, and defines `GET_POSITION_ABI` as an inline JSON ABI object with explicit `components` array for the tuple. The `getRelayerInstance` return type is untyped (`unknown`) from `relayer.ts`; `EncryptedValue` casts via `as any` to call `inst.userDecrypt(handle, contractAddr, walletClient)` — same workaround used in DarkPool page. Local mock `userDecrypt` ignores extra args safely.
  - **Files**: `frontend/src/pages/Portfolio.tsx`, `frontend/src/hooks/useDeployment.ts`, `frontend/src/hooks/useEncryptedBalance.ts`, `frontend/src/hooks/usePositions.ts`, `frontend/src/components/EncryptedValue.tsx`.

- **Added**: `frontend/src/pages/Darkpool.tsx`, `frontend/src/hooks/useDarkOrders.ts` (Task 7). Submit dark order form with 3 encrypted inputs (size, collateral, limitPrice) wrapped in the `SubmitOrderInputs` struct — one `encrypt()` call yields 3 handles from a single `inputProof`, same proof referenced in all 3 proof slots. Two-column layout: left = submit form (market select, long/short toggle, 3 labeled encrypted fields, allowlist guard); right = "My active orders" list with cancel button + per-row `EncryptedValue` reveals for size, collateral, and limit price. `useDarkOrders` mirrors `usePositions` pattern: `SIMPLE_ABI` for `nextOrderId`, `GET_ORDER_ABI` as inline JSON ABI for `getOrder` (viem parser rejects named-component tuple in human-readable form — same deviation as Task 4). Index access fallback retained alongside named-key access for viem edge cases. Build clean.
  - **Deviations from plan**: Plan's `useDarkOrders` draft used `parseAbi(DARK_ABI)` directly for `getOrder`; this fails at TS compile because viem's `parseAbi` cannot parse named-component tuple returns. Fix: split into `SIMPLE_ABI` (parseAbi) + `GET_ORDER_ABI` (JSON ABI) — identical pattern to `GET_POSITION_ABI` in `usePositions.ts`. Plan also showed all 3 encrypted-value reveals (size, collateral, limit) in the order row; implemented with the same collateral reveal added that plan's snippet omitted (minor UI enhancement). `parseAbi(DARK_ABI as unknown as string[])` cast used in `Darkpool.tsx` to feed the mixed string/object array through viem (the JSON `submitOrder` entry is preserved as-is and passes through).

- **Added**: `frontend/README.md` runbook (Task 8). 3-terminal local-stack bring-up (Hardhat node + deploy / compliance-backend / vite dev server) + 7-step click-through demo flow + Sepolia env wiring for Phase 9 + troubleshooting section. Scripted smoke verified: contracts build clean (288 tests passing), `deploy-local.ts` writes `local.json`, compliance-backend boots + `/health` responds with empty `count: 0` + `ZeroHash` root, vite dev server serves with `<title>NoirPerp` at 127.0.0.1:5173, vite production build clean (881kB main + 798kB web bundle, gzipped to 271kB + 163kB — chunk size warnings are pre-existing wagmi/RainbowKit bulk).
  - **Local-mode caveat documented**: `userDecrypt` returns `0n` against the local mock (FHEVM mock plugin is in-process to Hardhat; stand-alone browser can't access). Real FHE round-trip lights up on Sepolia (Phase 9). UI/transaction flows still fully testable in local mode.
  - **Deferred**: actual browser click-through requires a UI session (Claude can't drive a real browser). README provides exact 7-step demo flow for human or Phase 9 video recording.
  - **Files**: `frontend/README.md`.
  - **Files**: `frontend/src/pages/Darkpool.tsx`, `frontend/src/hooks/useDarkOrders.ts`.

- **Added**: `frontend/src/pages/Liquidity.tsx` (Task 6). Pool stats (plaintext `totalShares` + `totalReserveUsdcx`, both Phase 4 hybrid-privacy state). `addLiquidity(uint64)` sync form + `requestWithdraw(uint64)` async form (bot completes settlement). User's encrypted share balance (`bytes32` handle) with `EncryptedValue` reveal button. 3-col stat grid + 2-col form layout. `AMM_ABI` has only simple types so `parseAbi(AMM_ABI)` works cleanly. Build clean.
  - **Files**: `frontend/src/pages/Liquidity.tsx`.

- **Added**: `frontend/src/pages/Trade.tsx`, `frontend/src/hooks/useEncrypt.ts`, `frontend/src/components/Form.tsx` (Task 5). Open-position form with FHE encryption of size + collateral via relayer SDK; `openPosition` tx signed via wagmi `useWriteContract`. Right pane: live positions list with one-click close + per-row encrypted-value reveal (reuses `EncryptedValue` and `usePositions` from Task 4). Allowlist guard prevents submit when not KYC'd (button disabled + red warning). `useEncryptInput` calls `inst.createEncryptedInput(contractAddr, address).add64(v1).add64(v2).encrypt()` — one `inputProof` covers both handles. Local mock path preserved. `Form.tsx` provides minimal `Field`, `Input`, `Select`, `Button` primitives.
  - **Deviations from plan**: `inst` cast to `as any` before calling `createEncryptedInput` (same pattern as `EncryptedValue`; `getRelayerInstance` returns `unknown`).
  - **Files**: `frontend/src/pages/Trade.tsx`, `frontend/src/hooks/useEncrypt.ts`, `frontend/src/components/Form.tsx`.

### Phase 7 — Tier 1 audit fixes (4 Important + 3 Minor + 1 Observation)

- **Fix 1 (Important) — Bot replay misses `PositionClosed`**
  - Root cause: `replayEvents` in `bot/src/index.ts` only excluded liquidated positions
    from the live-tracking set; positions closed normally (via `PositionClosed` on NoirVault)
    were still enqueued and the bot would keep probing them.
  - Fix: added parallel `queryFilter("PositionClosed", fromBlock)` on `clients.vaultRO` and
    built a union dropset from both `Liquidated` and `PositionClosed` events.
  - `bot/src/clients.ts` already had `event PositionClosed(uint256 indexed positionId)` in
    `VAULT_ABI` — no change needed there.
  - Files: `bot/src/index.ts`

- **Fix 2 (Important) — pino-http registered AFTER routes in compliance-backend**
  - Root cause: `compliance-backend/src/index.ts` called `buildApp(...)` then called
    `app.use(pinoHttp(...))`, registering the HTTP logger after all routes were already
    mounted — requests matched before the logger middleware ran.
  - Fix: `buildApp` extended to accept an optional `logger` param (`AppOpts.logger?: any`).
    Static import of `pino-http` added to `server.ts`. When `opts.logger` is truthy,
    `pinoHttp({ logger })` is registered as the FIRST middleware before `express.json()`.
    `index.ts` now passes `logger` into `buildApp`; separate `app.use(pinoHttp(...))` call
    removed. Tests omit `logger` — conditional skips the middleware safely.
  - Files: `compliance-backend/src/server.ts`, `compliance-backend/src/index.ts`

- **Fix 3 (Important) — Document race window in bot replay**
  - Added comment immediately after `await replayEvents(...)` call explaining the MVP
    race window between replay tip and WS subscription start, why it is acceptable
    (idempotent on-chain calls, tick loop catchup), and when it will be addressed
    (Phase 9 WS-then-replay pattern).
  - Files: `bot/src/index.ts`

- **Fix 4 (Important) — oracle-relayer SIGTERM handler**
  - Root cause: oracle-relayer had no SIGTERM handler; `process.exit()` would only fire
    naturally (no cleanup / graceful shutdown logging).
  - Fix: added `process.on("SIGTERM", ...)` inside `main()` after the `setInterval` block,
    logging `"shutting down"` then exiting cleanly.
  - Files: `oracle-relayer/src/index.ts`

- **Fix 5 (Minor) — Logger type consistency**
  - `bot/src/watchers/decrypt-relay.ts`: replaced inline `type Logger = { info, error }`
    with `import type { Logger } from "pino"`.
  - `bot/src/index.ts`: `replayEvents` param changed from `logger: any` to `logger: Logger`;
    added `import type { Logger } from "pino"` at top.
  - Files: `bot/src/watchers/decrypt-relay.ts`, `bot/src/index.ts`

- **Fix 6 (Minor) — console.error → structured logger in fatal catch handlers**
  - Root cause: both `oracle-relayer/src/index.ts` and `bot/src/index.ts` ended with
    `main().catch((err) => { console.error(err); ... })`, bypassing the structured pino
    logger for fatal errors.
  - Fix: hoisted `logger` to module scope in both files (removed re-declaration inside
    `main()`). Updated catch handlers to `logger.fatal({ err: err?.message }, "fatal")`.
  - Files: `oracle-relayer/src/index.ts`, `bot/src/index.ts`

- **Fix 7 (Minor) — Add /admin/remove 401 test**
  - Added test `"POST /admin/remove without key returns 401"` before the existing remove
    test in `compliance-backend/test/server.test.ts`. Compliance tests: 13 → 14 passing.
  - Files: `compliance-backend/test/server.test.ts`

- **Fix 8 (Observation) — Document rethrow in decrypt-relay catch blocks**
  - Added comment before `throw err` in both `handleSingleDecrypt` and `handleBatchDecrypt`
    catch blocks explaining: rethrowing enables unit-test assertions on failure paths;
    `subscribeDecryptRelay` swallows via `.catch(() => {})` to keep the subscriber alive.
  - Files: `bot/src/watchers/decrypt-relay.ts`

Test results after all fixes:
- bot: 18 passing (unchanged)
- oracle-relayer: 6 passing (unchanged)
- compliance-backend: 14 passing (was 13, +1 from Fix 7)
- contracts: 288 passing (unchanged)
- All three packages build cleanly with `tsc` (zero errors).

### Phase 7 complete ✅ (2026-04-25)

- **Three off-chain services live** (local mock):
  - `oracle-relayer/` — 2-of-3 Chainlink relayer service (A+B active,
    C offline). Tick loop submits BTC/ETH/SOL prices.
  - `compliance-backend/` — Express + Merkle allowlist API
    (`/health`, `/proof/:address`, `/admin/{add,remove}` gated by
    `x-api-key`). Reuses `@openzeppelin/merkle-tree` so off-chain
    algorithm matches on-chain verifier.
  - `bot/` — orchestrator with 4 watchers in one Node process:
    liquidation (via NoirVault.PositionOpened + PerpEngine.Liquidated
    / LiquidationChecked), trigger (LimitEngine OrderPlaced /
    Triggered / TriggerNotMet / OrderCancelled), batch
    (DarkpoolEngine OrderSubmitted / BatchSettled / OrderCancelled),
    decrypt-relay (4 engines: Liquidation/Trigger/Withdraw/BatchMatch
    Requested events → publicDecrypt → engine._onXDecided callback).
    Replay-on-startup (queries PositionClosed too, post-audit fix).
    Busy-flag tick loop. SIGTERM cleanup in both bot + oracle-relayer.
- **Spec deviations** (documented):
  1. KYC provider stubbed (JSON file allowlist; real KYC post-launch)
  2. Single-process bot (no Redis/queue)
  3. 2-of-3 quorum from A+B (C offline; rotation drill in Phase 9)
  4. No $ZAMA fee handling (testnet free tier)
  5. Task 3 spawn-based integration test skipped — FHEVM hardhat
     plugin requires in-process precompile setup; standalone
     `npx hardhat node` + `--network localhost` deploy is
     fundamentally incompatible. Coverage via Phase 2 Oracle tests.
  6. Task 6 spawn-based on-chain proof verification skipped — same
     root cause. Coverage via Phase 2 Compliance tests which already
     pin the off-chain Merkle algorithm.
- **Tier 1 audit**: passed — 1 spec compliance Important finding
  (replay missing PositionClosed) + 7 code quality findings
  (4 Important: pino-http registered after routes, replay-to-subscribe
  race window undocumented, oracle-relayer SIGTERM missing, Logger
  type drift; 3 Minor + 1 Observation). All 8 fixed pre-merge.
- **Test counts**: 326 total = 38 off-chain (oracle 6 + compliance 14
  + bot 18) + 288 contracts (287 prior + 1 new
  `Bot.Integration.test.ts`).
- **Cross-package CJS/ESM bridge**: `contracts/` (CJS) imports from
  `bot/dist/` (ESM) via dynamic `import()` with `path.resolve` for
  absolute paths. Pattern documented in `Bot.Integration.test.ts`.
- **Key operational lesson**: any "spawn hardhat node + deploy
  externally" pattern won't work for this project. Off-chain
  integration tests must run inside the hardhat runtime via
  `contracts/test/*.ts`.
- **Ready for Phase 8** (frontend).

### Phase 7 — Off-chain services (in progress)

- **Added**: `contracts/test/Bot.Integration.test.ts` — Task 13 of Phase 7 plan.
  Single cross-service integration smoke test that proves `runLiquidationTick` (Task 8)
  drives a full liquidation flow end-to-end against the real PerpEngine in the FHEVM
  hardhat mock runtime. Deploys MockERC7984, NoirVault, Oracle, Compliance, PerpEngine;
  opens a 10-ETH long for Alice at price 3000 with 1000 collateral; crashes price to 2990
  (10% loss > 5% maintenance threshold); creates a `TrackedSet` with position 0; calls
  `runLiquidationTick(engineAsKeeper, tracked, silentLogger)` which invokes
  `requestLiquidation(0)` on-chain; reads `LiquidationRequested` event via
  `engine.queryFilter`; calls `hre.fhevm.publicDecrypt([underwaterHandle])` to get
  `{abiEncodedClearValues, decryptionProof}`; calls `_onLiquidationDecided` callback; and
  asserts position is inactive and `Liquidated` event was emitted.
  Result: 1 passing (142ms). Full suite: 288 passing (287 prior + 1 new). No regressions.

  Cross-package wiring:
  - bot/ is ESM; contracts/ is CJS. Dynamic `import()` used to load bot's pre-built dist.
  - TypeScript (CJS tsconfig) choked on `(import as any)` syntax — not valid TS.
  - Resolved by using `await import(...) as Record<string, unknown>` type assertion
    with a `/* webpackIgnore: true */` comment to silence bundler warnings.
  - Absolute path to `bot/dist/` derived via `path.resolve(__dirname, "../../bot/dist")`
    to avoid CWD ambiguity at test invocation time.
  - Tasks 3 + 6 spawn-based variants were dropped (FHEVM-spawn incompatibility);
    this in-process dynamic import approach succeeded cleanly.

  **Files**: `contracts/test/Bot.Integration.test.ts`, `CHANGELOG.md`.

- **Added**: `bot/src/index.ts` — main bot entrypoint (Task 12 of Phase 7 plan).
  Wires `loadConfig`, `makeClients`, `TrackedSet`, all four watcher subscribe/tick
  functions, and `makePublicDecrypt`. Includes `replayEvents` that bootstraps tracked
  state from historical on-chain events before live subscription starts.
  Key corrections vs. plan applied:
  - `replayEvents` queries `PositionOpened` from `vaultRO` (NoirVault), NOT `perpRO`.
  - `replayEvents` for LimitEngine prunes via `Triggered` + `OrderCancelled` (not
    `OrderTriggered`/`OrderMissed`); `TriggerNotMet` keeps the order tracked.
  - `subscribeLiquidation` called with 4 args: `(vaultRO, perpRO, tracked, logger)`.
  - `makePublicDecrypt` stubs local network; uses `@zama-fhe/relayer-sdk` via deferred
    dynamic import (bypasses tsc module resolution for optional Sepolia-only dep).
  - Logger typed as `any` in entrypoint to bridge pino generic mismatch between
    `Logger<never>` (watcher signatures) and `Logger<string>` (pino() return); no
    watcher files modified.
  Build: clean tsc compile. Tests: 18/18 passing (no regressions).
  **Files**: `bot/src/index.ts`.



- **Added**: `bot/` scaffold — Task 7 of Phase 7 plan.
  `package.json` (`@noirperp/bot`, type=module, deps: `@zama-fhe/relayer-sdk@0.4.1` exact,
  `dotenv@^16.4`, `ethers@^6.13`, `pino@^9`; devDeps: `@types/node@^22`,
  `tsx@^4.7`, `typescript@^5.5`, `vitest@^2`).
  `tsconfig.json` (ES2022/ESNext/Bundler/strict — same shape as oracle-relayer).
  `.env.example` (RPC_URL, WS_URL, DEPLOYMENT_PATH, BOT_PRIVKEY, TICK_INTERVAL_MS=15000, LOG_LEVEL=info).
  `.gitignore` (node_modules, dist, .env, coverage).
  `src/config.ts` — `loadConfig()` reads env + parses deployment JSON; `Deployment` type
  matches local.json shape (network, chainId, contracts, relayers, admin).
  `src/state.ts` — `TrackedSet<T>` generic (size, has, add, remove, list, groupBy).
  `src/clients.ts` — `makeClients(rpcUrl, wsUrl, botKey, deployment)` returns
  `{ rpc, ws, signer, vaultRO, perpRO, perpRW, limitRO, limitRW, ammRO, ammRW, darkRO, darkRW }`.
  `test/state.test.ts` — 5 vitest tests (empty / add idempotent / remove / has / groupBy), all passing.
  **ABI corrections vs. plan** (verified against actual contracts — future tasks MUST use these):
  - `PositionOpened(uint256 positionId, address owner, uint8 marketId)` and
    `PositionClosed(uint256 positionId)` are emitted by **NoirVault**, not PerpEngine.
    Bot exposes `vaultRO` (not in plan) to subscribe to these events.
  - `LimitEngine.OrderPlaced`: arg order is `orderType` BEFORE `marketId`
    (plan had them reversed). Correct: `OrderPlaced(uint256 orderId, address owner, uint8 orderType, uint8 marketId)`.
  - `LimitEngine` termination events are `Triggered(uint256 orderId, address user)` and
    `TriggerNotMet(uint256 orderId)` — NOT `OrderTriggered` / `OrderMissed` as the plan stated.
  - `LimitEngine.TriggerRequested` fourth arg is `bytes32 shouldTriggerHandle`
    (plan had `bytes32 handle`).
  - `AMMEngine.WithdrawRequested` has 4 args including plaintext `uint64 claimedShares`
    before `bytes32 matchHandle` (plan omitted claimedShares).
    Correct: `WithdrawRequested(uint256 requestId, address user, uint64 claimedShares, bytes32 matchHandle)`.
  - `AMMEngine` fulfillment events are `LiquidityRemoved(uint256 requestId, address user, uint64 shares, uint64 payout)`
    and `WithdrawRejected(uint256 requestId, address user)` (plan did not name these).
  - `PerpEngine.LiquidationRequested` fourth arg is `bytes32 underwaterHandle`
    (plan had `bytes32 handle`).
  **Files**: `bot/package.json`, `bot/tsconfig.json`, `bot/.env.example`, `bot/.gitignore`,
  `bot/src/config.ts`, `bot/src/state.ts`, `bot/src/clients.ts`, `bot/test/state.test.ts`.

- **Added**: `bot/src/watchers/liquidation.ts` + `bot/test/liquidation.test.ts` — Task 8 of Phase 7 plan.
  `subscribeLiquidation(vaultRO, perpRO, tracked, logger)` subscribes to three on-chain events:
  - `vaultRO.on("PositionOpened", ...)` → `tracked.add(positionId)` (position is live; uses NoirVault per ABI correction)
  - `perpRO.on("Liquidated", ...)` → `tracked.remove(positionId)` (position gone)
  - `perpRO.on("LiquidationChecked", ...)` → keeps in tracked, logs "kept" (position survived check, keep probing)
  Returns an unsubscribe function that removes all three listeners.
  `runLiquidationTick(perpRW, tracked, logger)` iterates `tracked.list()`, calls
  `perpRW.requestLiquidation(positionId)` + `await tx.wait()` per position, with per-call
  try/catch that logs the error and continues to the next position.
  3 vitest tests added (calls for each tracked id / does nothing when empty / logs and continues on failure).
  All 8 bot tests pass.
  **Files**: `bot/src/watchers/liquidation.ts`, `bot/test/liquidation.test.ts`, `CHANGELOG.md`.

- **Added**: `bot/src/watchers/batch.ts` + `bot/test/batch.test.ts` — Task 10 of Phase 7 plan.
  `subscribeBatch(darkRO, tracked, logger)` subscribes to three DarkpoolEngine events:
  - `darkRO.on("OrderSubmitted", (orderId, owner, marketId) => tracked.add({ orderId, marketId: Number(marketId) }))`
    — stores both orderId and marketId so the tick can group by market
  - `darkRO.on("BatchSettled", (requestId, orderIds, shouldFires) => ...)` — iterates `orderIds`
    from the event payload, finds all matching refs in tracked by orderId, and removes each
  - `darkRO.on("OrderCancelled", (orderId, owner) => ...)` — same scan-and-remove by orderId
  Returns an unsubscribe function that removes all three listeners.
  `runBatchTick(darkRW, tracked, logger)` calls `tracked.groupBy(ref => ref.marketId)` to get a
  `Map<marketId, DarkOrderRef[]>`, then for each (marketId, refs) pair chunks the refs array at
  `MAX_BATCH_SIZE=10` and calls `darkRW.requestBatchMatch(chunk.map(r => r.orderId))` per chunk.
  Per-chunk try/catch logs error and continues to next chunk/market (no abort on failure).
  `MAX_BATCH_SIZE=10` enforced per Phase 6 HCU audit (5M sequential FHE op cap).
  4 vitest tests added: groups by marketId (3 orders → 2 markets → 2 calls); caps at MAX_BATCH_SIZE
  (15 orders → 2 calls of 10 + 5); does nothing when empty; logs and continues on per-batch failure.
  All 15 bot tests pass.
  **Files**: `bot/src/watchers/batch.ts`, `bot/test/batch.test.ts`, `CHANGELOG.md`.

- **Added**: `bot/src/watchers/decrypt-relay.ts` + `bot/test/decrypt-relay.test.ts` — Task 11 of Phase 7 plan.
  `handleSingleDecrypt({ engine, callbackName, requestId, handle, publicDecrypt, logger })` — wraps
  single handle in a 1-element array, calls `publicDecrypt([handle])` to get
  `{ abiEncodedClearValues, decryptionProof }` from KMS, then calls `engine[callbackName](requestId,
  [handle], abiEncodedClearValues, decryptionProof)`. Logs and rethrows on any failure.
  `handleBatchDecrypt({ engine, requestId, handles, publicDecrypt, logger })` — same flow but with N
  handles; always calls `engine._onBatchDecided(requestId, handles, cleartexts, proof)`.
  `subscribeDecryptRelay(perpRO, perpRW, limitRO, limitRW, ammRO, ammRW, darkRO, darkRW, publicDecrypt, logger)`
  — wires all four engines' decrypt-request events to the appropriate handler; returns unsubscribe fn.
  **Event-signature corrections applied** (4-arg events, corrected from plan's wrong 3-arg signatures):
  - `PerpEngine.LiquidationRequested(requestId, positionId, keeper, underwaterHandle)` — keeper is 3rd
    arg, handle is 4th (plan had 3 args with handle as 3rd). `onLiq` callback takes `_keeper` then
    `underwaterHandle`.
  - `LimitEngine.TriggerRequested(requestId, orderId, keeper, shouldTriggerHandle)` — same pattern.
    `onTrig` callback takes `_keeper` then `shouldTriggerHandle`.
  - `AMMEngine.WithdrawRequested(requestId, user, claimedShares, matchHandle)` — plaintext
    `claimedShares` is 3rd arg, handle is 4th (plan had 3 args). `onWithdraw` callback takes
    `_claimedShares: bigint` then `matchHandle`.
  - `DarkpoolEngine.BatchMatchRequested(requestId, keeper, orderIds, handles)` — unchanged; matches plan.
  3 vitest tests added: single-handle path calls publicDecrypt with [handle] then engine callback;
  batch path calls publicDecrypt with all handles then _onBatchDecided; single path logs and rethrows
  on publicDecrypt failure.
  All 18 bot tests pass.
  **Files**: `bot/src/watchers/decrypt-relay.ts`, `bot/test/decrypt-relay.test.ts`, `CHANGELOG.md`.

- **Added**: `bot/src/watchers/trigger.ts` + `bot/test/trigger.test.ts` — Task 9 of Phase 7 plan.
  `subscribeTrigger(limitRO, tracked, logger)` subscribes to four on-chain events using corrected
  ABI event names and arg orders (documented in Task 7/8):
  - `limitRO.on("OrderPlaced", (orderId, owner, orderType, marketId) => tracked.add(orderId))`
    — 4 args with `orderType` BEFORE `marketId` (corrected from plan)
  - `limitRO.on("Triggered", (orderId, user) => tracked.remove(orderId))`
    — NOT `OrderTriggered` (corrected from plan)
  - `limitRO.on("TriggerNotMet", (orderId) => log.info("kept"))`
    — NOT `OrderMissed` (corrected from plan); order survived check, bot keeps probing
  - `limitRO.on("OrderCancelled", (orderId, owner) => tracked.remove(orderId))`
  Returns an unsubscribe function that removes all four listeners.
  `runTriggerTick(limitRW, tracked, logger)` iterates `tracked.list()`, calls
  `limitRW.requestTrigger(orderId)` + `await tx.wait()` per order, with per-call
  try/catch that logs the error and continues to the next order.
  3 vitest tests added (calls for each tracked orderId / does nothing when empty / logs and continues on failure).
  All 11 bot tests pass.
  **Files**: `bot/src/watchers/trigger.ts`, `bot/test/trigger.test.ts`, `CHANGELOG.md`.

- **Modified**: `contracts/scripts/deploy-local.ts` — writes
  `contracts/deployments/local.json` after deploy. Off-chain services
  (oracle-relayer, compliance-backend, bot) read this file to get
  contract addresses + relayer/admin keys. `.gitignore` excludes the
  generated file (regenerated per deploy).
  **Files**: `contracts/scripts/deploy-local.ts`,
  `contracts/deployments/.gitkeep`, `.gitignore`.

- **Added**: `oracle-relayer/` scaffold (package.json, tsconfig,
  .env.example, .gitignore) + `chainlink.ts` mock price source +
  `config.ts` env loader. 3 vitest tests passing.
  **Files**: `oracle-relayer/package.json`, `oracle-relayer/tsconfig.json`,
  `oracle-relayer/.env.example`, `oracle-relayer/.gitignore`,
  `oracle-relayer/src/chainlink.ts`, `oracle-relayer/src/config.ts`,
  `oracle-relayer/test/chainlink.test.ts`.

- **Added**: `oracle-relayer/src/relayer.ts` — `submitTick(oracleA, oracleB, logger, priceFn?)` iterates all 3 markets, calls `submitPrice` on both Contract instances, per-call try/catch logs error and continues without aborting the tick. Relayer B uses `t + 1` timestamp to satisfy Oracle.sol's distinct (relayer, timestamp) constraint. `oracle-relayer/src/index.ts` — main entrypoint: loads config, creates JsonRpcProvider + 2 Wallets + 2 Contract instances with minimal ORACLE_ABI, runs first tick immediately then `setInterval` with busy-flag re-entry guard to skip overlapping ticks.
  3 new vitest tests (6 total) — all passing.
  **Files**: `oracle-relayer/src/relayer.ts`, `oracle-relayer/src/index.ts`,
  `oracle-relayer/test/relayer.test.ts`.

- **Skipped (deviation from plan Task 3)**: oracle-relayer
  spawn-based integration test.
  **Why**: FHEVM hardhat plugin provisions mock precompiles via
  in-process hooks; running `deploy-local.ts` against a standalone
  `npx hardhat node` fails inside `providerExtender` with
  `ECONNREFUSED 127.0.0.1:8545` regardless of `--network localhost`
  arg — the plugin hardcodes the default port and assumes the FHEVM
  precompiles are reachable in the same VM. The spawn pattern is
  fundamentally incompatible with FHEVM mock.
  **What was tried**: Manual repro confirmed: `npx hardhat node --port 8547`
  starts cleanly, but `npx hardhat run scripts/deploy-local.ts --network localhost`
  errors out at `getSigners` because providerExtender's KMS wiring
  attempt to 8545 (not 8547) fails.
  **Alternative coverage**: Node-side `submitTick` logic covered by
  3 mocked-Contract unit tests; on-chain 2-of-3 quorum covered by
  `contracts/test/Oracle.test.ts` (23 tests, Phase 2). Cross-service
  integration deferred to Task 13 (bot integration in hardhat runtime).
  **Root cause for future plans**: any "spawn hardhat node + deploy
  externally" pattern won't work for this project. Off-chain service
  integration tests must run inside the hardhat runtime via
  `contracts/test/*.ts` files.

- **Added**: `compliance-backend/src/{server,index}.ts` — Express app
  with `/health`, `/proof/:address`, `/admin/add`, `/admin/remove`
  (admin routes gated by `x-api-key` header). `buildApp` factory takes
  `{ allowlistPath, adminApiKey }` and returns the app without listening,
  so supertest can drive it directly. Address validation uses
  `ethers.isAddress`; invalid input returns 400; missing/wrong key returns
  401. 7 supertest-driven vitest tests all passing (13 total).
  **Deviation from plan**: end-to-end proof test pre-seeds ADDR_B before
  ADDR_A so the tree has 2 leaves — OZ StandardMerkleTree returns `proof=[]`
  for a single-leaf tree (leaf IS the root, no siblings), making the
  `proof.length > 0` assertion unprovable with a single address.
  **Files**: `compliance-backend/src/server.ts`, `compliance-backend/src/index.ts`,
  `compliance-backend/test/server.test.ts`.

- **Added**: `compliance-backend/` scaffold + `AllowlistTree` Merkle
  builder backed by `data/allowlist.json`. Reuses
  `@openzeppelin/merkle-tree` (same as contracts' tests, so proofs
  verified by the same `StandardMerkleTree` algorithm). 6 vitest tests
  all passing. Empty allowlist returns `ZeroHash` root (matches on-chain
  Compliance contract "deny everyone" semantics). All addresses
  normalized to checksum form via `getAddress` for dedup. `add` is
  idempotent; `proof` for unknown address returns `allowlisted: false`
  without throwing.
  **Files**: `compliance-backend/package.json`,
  `compliance-backend/tsconfig.json`, `compliance-backend/.env.example`,
  `compliance-backend/.gitignore`, `compliance-backend/data/allowlist.json`,
  `compliance-backend/src/config.ts`, `compliance-backend/src/tree.ts`,
  `compliance-backend/test/tree.test.ts`.

- **Skipped (deviation from plan Task 6)**: compliance-backend
  spawn-based on-chain proof verification test.
  **Why**: Same root cause as Task 3 deviation — FHEVM hardhat plugin
  is incompatible with the spawn-based pattern.
  **Alternative coverage**: `contracts/test/Compliance.test.ts`
  (Phase 2, 16 tests) already verifies that the on-chain
  `Compliance.verify` accepts proofs from
  `@openzeppelin/merkle-tree`'s `StandardMerkleTree.of([[addr]], ["address"])`
  — the same library + same call shape that `compliance-backend/src/tree.ts`
  uses. Off-chain ↔ on-chain algorithm pinning is therefore proven by
  the existing Phase 2 test, not by re-running it through a stand-alone
  backend instance.
  **What this means in practice**: Phase 9's Sepolia deploy will issue
  proofs from compliance-backend's API + assert they pass on-chain via
  `Compliance.verify`. That's the real cross-system smoke; a synthetic
  one in Phase 7 would add no signal.

### Phase 6 complete ✅ (2026-04-25)

- **DarkpoolEngine live** on local mock:
  - `submitOrder(SubmitOrderInputs, marketId, isLong, complianceProof)`
    — locks collateral as escrow
  - `cancelOrder(orderId)` — refunds escrow
  - `requestBatchMatch(uint256[])` — async, single Gateway decrypt for
    N orders (~10 max per HCU budget)
  - `_onBatchDecided(...)` — replay-guarded callback; settles fillable
    orders via `perp.openPositionAsExecutor`, refunds non-fillable
- **Spec deviations** (documented):
  1. No volume matching across counterparties (each order independent)
  2. No partial fills (binary fill per order)
  3. Clearing price = oracle price (per spec §11 deferred decision)
  4. Settlement via PerpEngine executor (perp position open)
- **Test count**: 287 total (257 prior + 30 new).
- **Coverage**: DarkpoolEngine 100% stmts / 86.21% branches / 100%
  funcs / 100% lines.
- **Tier 1 audit**: passed — 1 important (cross-market batch
  silent mis-pricing) + 3 minor/observation findings fixed pre-merge.
- **Key lesson**: multi-handle public decrypt encodes cleartexts as
  `abi.encode(uint256, uint256, ...)` flat tuple, NOT
  `abi.encode(uint256[])`. Decoded via assembly word extraction.
- **Ready for Phase 7** (off-chain services: bot, oracle relayer,
  compliance backend).

### Phase 6 — DarkpoolEngine (in progress)

- **Added**: `contracts/contracts/engines/DarkpoolEngine.sol` (Task 1
  scaffold — admin + struct + view accessor). Inherits `DecryptQueue`
  for batch-match async callbacks. `DarkOrder` struct stores 3
  encrypted fields (size, collateral, limitPrice) + plaintext metadata.
  ~14 unit tests.
  **Files**: `contracts/contracts/engines/DarkpoolEngine.sol`,
  `contracts/test/DarkpoolEngine.Admin.test.ts`.

- **Added**: `DarkpoolEngine.submitOrder` + `cancelOrder`. Submit
  imports 3 encrypted inputs (size, collateral, limitPrice) via
  `SubmitOrderInputs` struct (stack-too-deep avoidance). Locks
  collateral as escrow. Cancel refunds. Pattern mirrors
  LimitEngine.placeLimit. 9 unit tests.
  **Files**: `contracts/contracts/engines/DarkpoolEngine.sol`,
  `contracts/test/DarkpoolEngine.Submit.test.ts`.

- **Added**: `DarkpoolEngine.requestBatchMatch` + `_onBatchDecided`
  async batch-match flow. Phase 1: per-order `ebool wouldFill`
  computed against oracle price (long: le, short: ge), all marked
  publicly decryptable, handles emitted. Phase 2: callback verifies
  KMS sigs, dequeues, decodes N booleans from cleartexts, settles
  each (refund escrow + optionally `perp.openPositionAsExecutor` if
  fillable). Single decrypt round-trip resolves entire batch.
  7 unit tests including mixed-fill batch.
  **Cleartext decode note**: FHEVM mock returns `abi.encode(uint256,
  uint256, ...)` (flat N-tuple, NOT `uint256[]`). Decoded via assembly
  word-extraction loop (32 bytes per element at offset i*32 from data
  start). Extracted `_dispatchBatch` helper to avoid stack-too-deep
  in `_onBatchDecided`.
  **Files**: `contracts/contracts/engines/DarkpoolEngine.sol`,
  `contracts/test/DarkpoolEngine.BatchMatch.test.ts`.

- **Modified**: `contracts/scripts/deploy-local.ts` — deploys
  DarkpoolEngine + wires oracle/perp/compliance + authorizes as
  executor on PerpEngine. Banner bumped to Phase 6.
  **Files**: `contracts/scripts/deploy-local.ts`.

- **Fixed (Tier 1 audit)**: 4 findings addressed before phase tick:
  1. **Cross-market batch correctness bug** (Important): keeper could
     submit a batch with orders from different markets and only the
     first order's market price was used — silently mis-settling other
     markets' orders. Added `CrossMarketBatch` error + per-order
     `marketId == batchMarket` check inside `requestBatchMatch` loop.
     New unit test: `requestBatchMatch reverts on cross-market batch`.
  2. **`require`-with-string in `_decodeBatch`** (Minor): replaced with
     custom error `CleartextLengthMismatch()` for consistency + gas.
  3. **Mixed-batch test missing escrow-refund balance assertion**
     (Minor, but most critical user-safety invariant): added explicit
     `decrypt(vault.getBalance(alice))` assertion after settlement
     verifying 3 escrows refunded + 2 perp opens debited (final 18_000n
     vs 20_000n initial deposit).
  4. **Max batch size undocumented** (Observation): added NatSpec
     comment on `requestBatchMatch` documenting ~10 orders cap from
     5M HCU sequential limit (~489k HCU/order: 152k le/ge + 337k
     safeAdd refund).
  **Files**: `contracts/contracts/engines/DarkpoolEngine.sol`,
  `contracts/test/DarkpoolEngine.BatchMatch.test.ts`.

---

## 2026-04-23

### Phase 5 — LimitEngine (in progress)

- **Modified**: `contracts/contracts/engines/PerpEngine.sol` — added
  authorized-executor pattern (`authorizedExecutors` mapping,
  `setExecutor` admin, `onlyAuthorizedExecutor` modifier),
  `openPositionAsExecutor`, `closePositionAsExecutor`. Refactored
  `_computeFinals` to take `owner` as arg (was `msg.sender`). Extracted
  `_executeClose` internal helper from inlined `closePosition` body;
  `closePosition` and `closePositionAsExecutor` both delegate to it.
  Existing `openPosition`/`closePosition` pass `msg.sender` and remain
  functionally unchanged. Phase 3 test suite (33 tests) all pass — no
  regressions. 10 new executor tests.
  **Why**: Phase 5 LimitEngine needs to open/close positions on behalf
  of users at trigger time. The executor pattern provides authorization
  without breaking msg.sender semantics for direct user calls.
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Executor.test.ts`.

- **Added**: `contracts/contracts/engines/LimitEngine.sol` — Task 2
  scaffold. Contract skeleton with admin pattern, `LimitOrder` struct
  (encrypted `triggerPrice`, `size`, `collateral` fields), order-type
  constants (`ORDER_TYPE_TP=1`, `ORDER_TYPE_SL=2`, `ORDER_TYPE_LIMIT=3`),
  `getOrder` view, and admin functions (`transferAdmin`, `setOracle`,
  `setPerp`). Inherits `DecryptQueue, ZamaEthereumConfig`. Constructor
  rejects zero vault or zero admin. No order placement or trigger logic
  yet (Tasks 3-5).
  **Why**: Establish the contract scaffold and admin surface before
  adding FHE order placement and async trigger flows.
  **Files**: `contracts/contracts/engines/LimitEngine.sol`,
  `contracts/test/LimitEngine.Admin.test.ts`.
  13 new admin tests; full suite 228 passing.

- **Added**: `LimitEngine.requestTrigger` + `_onTriggerDecided` async
  callback for all 3 order types (Task 5). `requestTrigger` validates
  oracle/perp set, order active, oracle freshness; trivially-encrypts
  the oracle price; computes `ebool shouldTrigger` via
  `_shouldTrigger(orderType, isLong, ePrice, triggerPrice)` with
  direction formula `useGe = (TP&&long) || (SL&&short) || (LIMIT&&short)`;
  marks publicly decryptable; enqueues with orderId-encoded context;
  emits `TriggerRequested`. `_onTriggerDecided` callback: `FHE.checkSignatures`
  first, then `_dequeue` (replay guard) BEFORE external calls, marks
  order inactive (single-use), decodes cleartext bool, dispatches via
  `_dispatchTrigger` helper (extracted to avoid stack-too-deep): TP/SL →
  `perp.closePositionAsExecutor(positionId)`; LIMIT → `_refundLimitCollateral`
  then `FHE.allowTransient` on size+collateral then `perp.openPositionAsExecutor`.
  On miss: LIMIT escrow still refunded; emits `TriggerNotMet`. On fire:
  emits `Triggered`. New errors: `OracleNotSet`, `PerpNotSet`,
  `OraclePriceStale`. New events: `TriggerRequested`, `Triggered`,
  `TriggerNotMet`. New imports: `Oracle`, `PerpEngine`. 7 unit tests
  covering all 3 types + miss path + guards. Full suite: 251 passing.
  **Files**: `contracts/contracts/engines/LimitEngine.sol`,
  `contracts/test/LimitEngine.Trigger.test.ts`.

- **Modified**: `deploy-local.ts` — deploys LimitEngine, registers it
  on vault, wires oracle/perp/compliance, authorizes it as executor
  on PerpEngine.

- **Added**: `LimitEngine.placeStopOrTake` (TP=1 / SL=2) +
  `cancelOrder` (works for all types). TP/SL placements verify
  caller owns the position via `vault.allowPositionAccess`,
  inherit isLong + marketId from the position, store encrypted
  trigger price (via `FHE.fromExternal` + `isSenderAllowed` guard +
  `FHE.allowThis`). Zero handles (`FHE.asEuint64(0)`) used for
  size/collateral unused fields. Cancel marks order inactive; checks
  owner first then active (double-cancel from same owner reverts
  `OrderNotActive`). Stub `_refundLimitCollateral` for Task 4.
  New errors: `NotPositionOwner`, `PositionNotActive`,
  `InvalidOrderType`, `NotOrderOwner`, `OrderNotActive`, `NotAllowed`.
  New events: `OrderPlaced`, `OrderCancelled`. 10 unit tests;
  full suite 238 passing.
  **Files**: `contracts/contracts/engines/LimitEngine.sol`,
  `contracts/test/LimitEngine.PlaceStopOrTake.test.ts`.

---

## 2026-04-24

### Phase 4 — AMMEngine (in progress)

- **Added**: `contracts/contracts/engines/AMMEngine.sol` (Task 1
  scaffold — admin + swap fee config + pool-state accessors). Inherits
  `DecryptQueue` for upcoming async-withdraw work. Hybrid privacy:
  plaintext `totalShares` + `totalReserveUsdcx`, encrypted `_userShares`.
  12 unit tests.
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.Admin.test.ts`.

- **Added**: `AMMEngine.addLiquidity(uint64 amount)` — sync deposit.
  Plaintext amount; encrypted LP share credit. Fair-ratio math via
  plaintext `totalShares` + `totalReserveUsdcx` counters. Debits user's
  vault USDCx balance, credits AMM's vault balance, credits user's
  encrypted share. 5 unit tests (bootstrap, fair-ratio, accumulation,
  zero-amount guard).
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.AddLiquidity.test.ts`.

- **Added**: `AMMEngine.requestWithdraw` + `_onWithdrawDecided` —
  async 2-phase withdrawal. Phase 1: engine compares user's encrypted
  shares to plaintext claim via `FHE.le(eClaim, userBal)`, marks result
  publicly decryptable, emits `WithdrawRequested` + enqueues. Phase 2
  (relayer callback): verify KMS sigs (`FHE.checkSignatures`), dequeue
  pre-external-call (replay guard per CLAUDE.md rule #6), if valid
  compute pro-rata payout via plaintext math
  (`payout = claimedShares × totalReserveUsdcx / totalShares`), debit
  AMM vault, credit user vault, decrement encrypted shares via
  `FHESafeMath.safeSub`. On mismatch (claim > encrypted balance):
  emit `WithdrawRejected` no-op.
  **Deviation from plan**: plan specified `FHE.eq` (exact match only),
  but that would reject all partial withdrawals. Switched to `FHE.le`
  (claim ≤ encrypted balance) to support partial withdrawals while still
  rejecting claims that exceed actual balance. The mismatch test was
  updated accordingly — it now uses a second depositor (Bob) to raise
  `totalShares` above Alice's balance, allowing Alice to claim more than
  she owns without hitting the Phase 1 `ClaimExceedsPoolTotal` guard.
  6 unit tests (full / partial / mismatch-reject / guards).
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.Withdraw.test.ts`.

- **Added**: `AMMEngine.swap` — synchronous oracle-pegged USDCx →
  synthetic-asset swap. Fee (30 bps default, admin-settable) stays in
  the pool as stranded reserves (same MVP limitation as liquidation
  forfeits — not reflected in plaintext `totalReserveUsdcx`).
  `setOracle(address)` admin function wires the oracle reference.
  Supports 3 markets (BTC=1, ETH=2, SOL=3). Per-user per-market
  encrypted synthetic balance tracked in `_syntheticBalance` mapping.
  FHE ops: `safeMul` + scalar `FHE.div` for fee, scalar `FHE.div` for
  price conversion — all per fhe-primitives.md §3.
  `isSenderAllowed` guard on external ciphertext input per CLAUDE.md
  rule #4. Internal `_executeSwap` helper split out to avoid
  stack-too-deep (anticipatory — compiler was clean but pattern is
  consistent with Phase 3 Task 2). 5 unit tests (2 happy-path, 3 guards).
  **Files**: `contracts/contracts/engines/AMMEngine.sol`,
  `contracts/test/AMMEngine.Swap.test.ts`.

- **Added**: `contracts/test/Integration.PerpAmmLiq.test.ts` —
  cross-engine integration test verifying PerpEngine liquidation
  forfeit lands in AMM's vault balance. Confirms the documented
  MVP limitation: `totalReserveUsdcx` plaintext counter is NOT
  incremented (forfeits stranded). Phase 5+ adds resync flow.

- **Modified**: `deploy-local.ts` — includes AMM deploy, oracle wiring,
  and PerpEngine.setLiquidationPool(AMM) repoint.

### Phase 4 Tier 1 audit findings (2026-04-24)

Ran spec-compliance + code-quality reviewers in parallel before tick.
Spec: ✅ Compliant (only stale deploy-local.ts header comment). Quality:
NEEDS_REWORK — 1 critical (debatable), 3 important, minor nits. All
addressed in commit `97a5104`:

**Critical (defensive fix)**:
- `_executeSwap` ACL ordering refactored so all ciphertext derivations
  + `allowTransient` grants happen BEFORE any `vault.adjustBalance`
  call. The reviewer noted that FHEVM v0.11.1 `allowTransient` is
  additive (AMM keeps access after vault call), so the original code
  was correct — but the new ordering isolates us from hypothetical
  future ACL-semantics changes. Defensive hardening.

**Important**:
- `Swapped` event: changed `amountInUsdcx: uint64` (always-0 placeholder)
  to `amountInHandle: bytes32`. Emits the ciphertext handle for off-chain
  indexing — privacy preserved (handle requires ACL to decrypt).
- Swap happy-path test: now explicitly asserts `synth == 0n` for the
  floor-rounded case (price=3000, amountIn=3000 → amountOut=0).
  Documents the integer-division edge case rather than skipping.
- `deploy-local.ts`: updated stale "Phase 3 local deploy" header
  comment + enumerated items 1-5 to include item 6 (AMMEngine).

**Deferred (Phase 9 or later)**:
- HCU optimization: swap uses ct×ct safeMul (596k HCU) instead of
  potential scalar ct×plaintext mul (365k). Saves ~230k HCU/swap
  if we add `FHESafeMath.safeMulScalar`. Phase 9 perf pass.
- Forfeit accounting drift (`totalReserveUsdcx` doesn't auto-sync with
  encrypted vault-balance increments) — documented MVP limitation;
  Phase 5+ adds decrypt-based resync flow.
- `_onWithdrawDecided` has no access control beyond `FHE.checkSignatures`
  — same pattern as `PerpEngine._onLiquidationDecided` (Phase 3);
  KMS sigs are the auth. Documented across phases.

### Phase 5 Tier 1 audit findings (2026-04-25)

Spec-compliance + code-quality reviewers ran in parallel before tick.
Spec: ✅ compliant except for missing 3 short-direction trigger tests.
Quality: NEEDS_REWORK — 1 critical (defensive) + 3 important findings.
All addressed in commit `db5e24a`:

**Critical** (defensive hardening):
- `_dispatchTrigger` TP/SL path now reads the position via
  `vault.getPosition(positionId)` and asserts `p.owner == order.owner`
  before calling `closePositionAsExecutor`. Currently safe because
  positionIds aren't recycled in NoirVault, but explicit check guards
  against future storage refactors.

**Important** (test coverage — both reviewers flagged):
- Added 3 short-direction trigger tests filling out the 6-direction
  matrix: TP-short, SL-short, LIMIT-short. Each exercises the
  `!isLong` branches of `_shouldTrigger` that were previously
  uncovered.

**Minor**:
- Added 3 `setCompliance` admin tests (happy path + non-admin + zero
  address) — coverage gap noted by spec reviewer.

**Deferred (documented)**:
- "Double-handle reuse" in `_refundLimitCollateral` — speculative
  ("if vault ever invalidates..."). Same pattern Phase 4 ships and
  244+ tests pass on. Not a current bug.
- requestId collision (same keeper, same block) — mitigated by order
  marking inactive after first callback; second call hits dequeue
  revert. Brittle UX, not exploitable.
- Keeper field unused in callback emit — Phase 6 fee-logic concern,
  not a Phase 5 bug.
- HCU optimization on `_lockCollateral` `safeAdd(x, 0)` (133k HCU
  identity op) — Phase 9 perf pass.
- TP/SL `FHE.allow(triggerPrice, msg.sender)` — minor usability
  (user can't decrypt their own trigger after place); not a spec
  violation.
- `openPositionAsExecutor` direct unit tests — exercised through
  LIMIT-fire integration; PerpEngine isn't a "new" contract in
  Phase 5 so 80% branch threshold doesn't strictly apply.

### Phase 5 complete ✅ (2026-04-25)

- **PerpEngine executor pattern**: `setExecutor`,
  `openPositionAsExecutor`, `closePositionAsExecutor`. Refactored
  `_computeFinals` to take `owner` arg; extracted `_executeClose`
  from inlined `closePosition` body. Phase 3 backwards-compat
  preserved (33 tests still pass).
- **LimitEngine live**:
  - `placeStopOrTake(positionId, eTrigger, proof, orderType)` —
    TP=1 / SL=2 placements on existing positions
  - `placeLimit(PlaceLimitInputs, marketId, isLong, complianceProof)` —
    Limit-Open with collateral escrow (struct param works around
    EVM 16-slot stack limit; viaIR rejected because it breaks 18
    other tests)
  - `cancelOrder(orderId)` — works for all types; LIMIT refunds escrow
  - `requestTrigger(orderId)` + `_onTriggerDecided` — async 2-phase
    via pull-based public decrypt (fhe-primitives.md §5)
  - All 6 trigger directions covered: TP/SL × long/short and
    LIMIT × long/short
- **Test count**: 257 total (244 prior + 13 new across Tasks 1-5
  plus 6 audit-fix tests).
- **Coverage**: LimitEngine 100% stmts / 87.5% branches / 100% funcs
  / 100% lines. PerpEngine modifications kept Phase 3's 33 tests
  green; new executor branches exercised through LimitEngine
  integration.
- **Tier 1 audit**: passed.
- **Ready for Phase 6** (DarkpoolEngine): batch auction with
  encrypted order matching.

### Phase 4 complete ✅ (2026-04-24)

- **AMMEngine live** on local mock:
  - `addLiquidity(uint64)` — sync, fair-ratio share math via plaintext
    pool counters, encrypted per-user share credit
  - `requestWithdraw(uint64)` + `_onWithdrawDecided` — async 2-phase via
    pull-based public-decrypt pattern (fhe-primitives.md §5).
    `FHE.le(eClaim, userBal)` gate supports partial withdrawals.
  - `swap(externalEuint64, bytes, uint8)` — sync oracle-pegged, 30bps
    fee, single-direction (USDCx → synthetic), 3 markets.
- **PerpEngine integration**: `liquidationPool` repointed to AMM;
  forfeits land in AMM's vault balance (encrypted increment,
  plaintext counter not auto-synced — documented limitation).
- **5 spec deviations** (documented, accepted):
  1. No UniV3 concentrated liquidity (FHE lacks sqrt + ct/ct div)
  2. Plaintext pool totals (LP-share privacy preserved; TVL visible)
  3. Stranded forfeits (Phase 5+ resync)
  4. No TickMath usage (Phase 1 lib stays pre-positioned)
  5. LP state in AMM, not Vault (YAGNI)
- **Test count**: 205 total (176 prior + 29 new: 12 Admin + 5
  AddLiquidity + 6 Withdraw + 5 Swap + 1 Integration).
- **Coverage**: AMMEngine 100% stmts / 89.47% branches / 100% funcs
  / 100% lines. All targets cleared on first pass.
- **Tier 1 audit**: passed (all critical + important findings
  fixed pre-merge).
- **Key plan bug caught**: subagent switched `FHE.eq` → `FHE.le` in
  `requestWithdraw` to support partial withdrawals (original spec
  contradicted itself on exact-match vs partial flow).
- **Ready for Phase 5** (LimitEngine): TP/SL + resting limit orders.

### Phase 0 scaffolding (in progress)

- **Added**: Design spec `docs/specs/2026-04-24-noirperp-design.md` —
  approved by CTO after full brainstorming session.
  **Why**: source-of-truth document for the rebuild; written before any
  code to prevent scope drift.
  **Files**: `docs/specs/2026-04-24-noirperp-design.md`.

- **Added**: Phase 0 implementation plan
  `docs/plans/2026-04-24-phase-0-scaffolding.md`.
  **Why**: bite-sized TDD task list for Phase 0 scaffolding + smoke test.
  **Files**: `docs/plans/2026-04-24-phase-0-scaffolding.md`.

- **Added**: Root `.gitignore`.
  **Why**: exclude node_modules, build artifacts, env files, IDE cruft.
  **Files**: `.gitignore`.

- **Added**: `CLAUDE.md` — pinned agent rules (Pillar 1).
  **Why**: anti-hallucination guardrail; locks FHEVM primitive
  assumptions, change-management rules, testing rules.
  **Files**: `CLAUDE.md`.

- **Added**: `PROGRESS.md` — phase tracker (Pillar 3).
  **Why**: anti-hallucination guardrail; single source of truth for
  phase state; enforces phase-gate discipline.
  **Files**: `PROGRESS.md`.

- **Added**: `CHANGELOG.md` — this file (Pillar 2).
  **Why**: anti-hallucination guardrail; every change logged before
  commit; Predictoor-pattern.
  **Files**: `CHANGELOG.md`.

- **Added**: `docs/fhe-primitives.md` (Pillar 4) — living FHEVM
  primitives reference, pinned package versions, Sepolia addresses,
  full op table with HCU costs, ACL model, async decryption pattern,
  known footguns.
  **Files**: `docs/fhe-primitives.md`.

- **Added**: `.claude/settings.local.json` — permission allowlist for
  Claude Code sessions (Pillar 4).
  **Files**: `.claude/settings.local.json`.

- **Added**: `contracts/package.json` + `package-lock.json` with pinned
  Hardhat + FHEVM + OZ toolchain.
  **Why**: Hardhat workspace scaffolding for the contracts module.
  **Files**: `contracts/package.json`, `contracts/package-lock.json`.

- **Added**: `contracts/hardhat.config.ts` + `contracts/tsconfig.json`.
  **Why**: Solidity 0.8.27 + cancun EVM + Sepolia network config.
  **Files**: `contracts/hardhat.config.ts`, `contracts/tsconfig.json`.

- **Added**: `contracts/.env.example`.
  **Files**: `contracts/.env.example`.

- **Added**: `contracts/contracts/Smoke.sol` + `contracts/test/Smoke.test.ts`.
  **Why**: FHEVM toolchain smoke test — deploys contract, trivially
  encrypts `uint64(42)`, grants ACL, mock-decrypts, compares to 42.
  Proves @fhevm/solidity + @fhevm/hardhat-plugin + typechain + mock
  decrypt all wired correctly.
  **Files**: `contracts/contracts/Smoke.sol`, `contracts/test/Smoke.test.ts`.

- **Corrected**: `docs/fhe-primitives.md` and `CLAUDE.md` both
  referenced a `SepoliaConfig` class from `@fhevm/solidity`. The
  actual v0.11.1 API exports `ZamaEthereumConfig` (auto-dispatches by
  chain ID). `SepoliaConfig` does not exist in the installed version.
  Discovered while writing Smoke.sol.
  **Root cause**: docs recon (2026-04-23) referenced an older API name
  from Zama docs; the installed package uses the newer unified name.
  **What was tried**: `import { SepoliaConfig } from
  "@fhevm/solidity/config/ZamaConfig.sol"` — import succeeded but no
  such symbol exists; switched to `ZamaEthereumConfig` which is
  exported and correctly handles Hardhat (31337) and Sepolia (11155111).
  **Files**: `docs/fhe-primitives.md` §2, `CLAUDE.md` Token/library rules.

- **Corrected**: `docs/fhe-primitives.md` pinned
  `@zama-fhe/relayer-sdk` to `^0.4.2`. Actual requirement is exact
  `0.4.1` — `@fhevm/hardhat-plugin@0.4.2` enforces strict version
  match at startup and errors otherwise.
  **Root cause**: docs recon reported SDK version `^0.4.2`; hardhat
  plugin version `^0.4.2` — assumed they'd be version-aligned.
  They're not; plugin insists on SDK `0.4.1` even though plugin itself
  is `0.4.2`.
  **What was tried**: installed `^0.4.2` → plugin threw version-check
  error; downgraded to `0.4.1` → works.
  **Files**: `docs/fhe-primitives.md` §1, `contracts/package.json`
  (via npm install downgrade).

- **Accommodation** (non-blocking): `contracts/package.json` gained
  `@nomicfoundation/hardhat-ignition`, `hardhat-ignition-ethers`,
  `hardhat-verify`, `ignition-core` as explicit devDependencies —
  these are standard Hardhat Toolbox peer deps that were missing from
  the plan's package.json. Also `@zama-fhe/relayer-sdk` moved from
  Phase 8 production to Phase 0 devDep (required at plugin init).
  Installed with `--legacy-peer-deps` due to toolbox expecting
  `hardhat-gas-reporter@^1` while we pin `^2` (tooling-only, no
  effect on FHE behavior).
  **Files**: `contracts/package.json`.

- **Note**: Node.js v25 is not officially supported by Hardhat v2
  (supports v20–v22 LTS). Smoke test passes despite the warning.
  If future phases fail with Node-related issues, downgrading Node
  to v22 LTS is the mitigation.

### Phase 0 complete ✅ (2026-04-24)

- **Scaffolding**: monorepo structure created (contracts/, frontend/,
  bot/, oracle-relayer/, compliance-backend/, docs/, assets/).
- **Guardrails (all 4 pillars populated)**:
  - `CLAUDE.md` — pinned agent rules
  - `CHANGELOG.md` — this file
  - `PROGRESS.md` — phase tracker
  - `docs/fhe-primitives.md` — verified FHEVM primitives reference
  - `.claude/settings.local.json` — permission allowlist
- **Contracts workspace**: Hardhat + FHEVM plugin + OZ confidential
  contracts + TypeScript + typechain installed; `hardhat.config.ts`
  and `tsconfig.json` written; Solidity 0.8.27 locked.
- **Toolchain smoke test**: `Smoke.sol` + `Smoke.test.ts` prove
  `FHE.asEuint64` + storage + ACL + mock decrypt all work
  end-to-end. `npx hardhat test` → 1 passing.
- **Why**: Phase 1 (shared libs) cannot start without a working
  FHEVM toolchain and the guardrail docs in place.
- **Files**: see individual commits in the `git log`
  (commit range `86103a6..HEAD` on branch `phase-0-scaffolding`).

### Phase 0 post-review fixes (2026-04-24)

Two independent reviewers (spec compliance + code quality) ran after
the phase-complete tick. Their findings, all addressed in one commit:

- **Fix (CRITICAL)**: `contracts/package.json` had an uncommitted
  local modification bumping `@zama-fhe/relayer-sdk` from `^0.4.2` to
  `^0.4.1`. Tests passed locally because `node_modules/` had the right
  version, but a fresh `git clone` + `npm install` would have
  re-installed `^0.4.2` and broken plugin init. Committed the pin,
  also tightened `^0.4.1` to exact `0.4.1` (plugin enforces exact).
  **Files**: `contracts/package.json`, `contracts/package-lock.json`.

- **Fix**: Added `fhevmTemp/` to `.gitignore`. `@fhevm/hardhat-plugin`
  creates this directory during compile/test as a working dir; was
  showing up as untracked noise in `git status`.
  Also removed duplicate `out/` entry that appeared under both
  "Build" and "Foundry (future)" sections.
  **Files**: `.gitignore`.

- **Fix**: `hardhat.config.ts` previously passed an empty-string
  `ETHERSCAN_API_KEY` to the etherscan config even when unset,
  producing misleading auth errors on `hardhat verify`. Now passes
  the config only when the key is set.
  **Files**: `contracts/hardhat.config.ts`.

- **Fix**: Removed `deploy:local` and `deploy:sepolia` scripts from
  `contracts/package.json` — they pointed at files that don't exist
  yet (Phase 2/3 adds real deploy scripts). Keeping them now would
  violate CLAUDE.md rule #4 ("no placeholder code").
  **Files**: `contracts/package.json`.

- **Fix**: Added explicit in-body comment on `Smoke.sol:setValue`
  marking it as TOOLCHAIN SMOKE TEST ONLY to prevent future agents
  from copy-pasting the open-setter pattern into real engines.
  **Files**: `contracts/contracts/Smoke.sol`.

- **Fix**: `docs/fhe-primitives.md` §9 referenced the smoke test file
  as `contracts/test/smoke.test.ts` (lowercase) — actual file is
  `Smoke.test.ts`. Matters on case-sensitive filesystems (Linux CI).
  **Files**: `docs/fhe-primitives.md`.

- **Added**: `docs/fhe-primitives.md` §10 — "Hardhat plugin
  integration notes" documenting the `import * as hre from "hardhat"`
  + `FhevmType from "@fhevm/hardhat-plugin"` API pattern we
  discovered. The `{ ethers, fhevm } from "hardhat"` pattern in the
  Phase 0 plan does NOT work; this note prevents future agents from
  re-tripping on it.
  **Files**: `docs/fhe-primitives.md`.

- **Deferred** (noted, not fixed in this commit): `tsconfig.json`
  does not `include` the `contracts/` directory. Low risk today
  (Solidity files don't go through tsc), but if we ever place `.ts`
  files under `contracts/contracts/` they'd be silently ignored.
  Will revisit when needed.

- **Deferred** (intentional historical artifact): `docs/specs/2026-04-24-noirperp-design.md`
  still references `SepoliaConfig` (should be `ZamaEthereumConfig`)
  and `@zama-fhe/relayer-sdk ^0.4.2` (should be exact `0.4.1`). The
  design spec is a point-in-time approved document; corrections live
  in `docs/fhe-primitives.md` (the LIVING DOC). Per CLAUDE.md
  priority, `fhe-primitives.md` overrides the spec for FHE primitive
  details.

### Phase 1 — Shared libs (in progress)

- **Added**: `contracts/contracts/lib/FHESafeMath.sol` — select-guarded
  `safeSub`, `safeAdd` (saturating), `absDiff` on `euint64`. Prevents
  silent underflow / overflow wraparound per OZ FHEVM security guide.
  **Why**: every engine's margin/PnL math runs through this lib; raw
  `FHE.sub` / `FHE.add` are banned outside of it (per CLAUDE.md rule #3).
  **Files**: `contracts/contracts/lib/FHESafeMath.sol`,
  `contracts/contracts/test-harness/FHESafeMathHarness.sol`,
  `contracts/test/FHESafeMath.test.ts`.

- **Added**: `contracts/contracts/lib/TickMath.sol` — ported from
  Uniswap v3-core (MIT). Pure math, no FHE. Used by AMMEngine
  (Phase 4) for concentrated-liquidity tick calculations.
  Exposes `getSqrtRatioAtTick`, `getTickAtSqrtRatio`, and bound
  constants `MIN_TICK`, `MAX_TICK`, `MIN_SQRT_RATIO`, `MAX_SQRT_RATIO`.
  13 unit tests passing.
  **Files**: `contracts/contracts/lib/TickMath.sol`,
  `contracts/contracts/test-harness/TickMathHarness.sol`,
  `contracts/test/TickMath.test.ts`.
  **Fix (plan bug resolved)**: the plan's symmetry test used `1n << 16n`
  as absolute tolerance for `sqrtPrice(-tick) * sqrtPrice(+tick) ≈ 2^192`.
  At tick ±1000 each `sqrtPrice` is ~2^96, so the product's ULP rounding
  drift propagates to ~2^95 absolute (relative error ~3e-30). The
  `2^16` bound was mathematically impossible. Corrected to `1n << 112n`
  which corresponds to relative precision better than 2^-80 — still a
  rigorous symmetry guarantee, just at the correct scale. Contract code
  unchanged (it's a verbatim UniV3 port and all 12 other tests verify
  correctness). All 13 TickMath tests now pass.
  **Root cause**: plan author confused absolute vs relative tolerance
  when writing the test.

- **Added**: `contracts/contracts/lib/DecryptQueue.sol` — abstract
  contract that every engine calling `FHE.requestDecryption` inherits.
  Tracks pending requests with replay-guarded `_dequeue` (deletes
  entry before returning, preventing double-fulfill attacks). Stale
  entries past 10-minute timeout can be swept by anyone via
  `cleanupStale`. 13 unit tests: enqueue/pendingInfo, dequeue replay
  guard, cleanup-stale semantics + auth.
  **Files**: `contracts/contracts/lib/DecryptQueue.sol`,
  `contracts/contracts/test-harness/DecryptQueueConsumer.sol`,
  `contracts/test/DecryptQueue.test.ts`.

- **Added**: `contracts/contracts/lib/MarginMath.sol` —
  multiplication-only margin / PnL / liquidation math. No `FHE.div`
  (ciphertext ÷ ciphertext does not exist); all ratio checks
  reformulated as multiplications. Depends on `FHESafeMath`.
  Functions: `notional`, `marginOK`, `pnlLong`, `pnlShort`,
  `shouldLiquidate`. 16 unit tests covering happy paths, boundaries,
  and zero-price-change edge cases.
  **Note**: `userDecryptEbool` IS available on
  `@fhevm/hardhat-plugin@0.4.2` as a first-class method
  (`hre.fhevm.userDecryptEbool(handle, contractAddress, signer)`).
  No fallback was needed; used directly as in the plan's primary path.
  **Files**: `contracts/contracts/lib/MarginMath.sol`,
  `contracts/contracts/test-harness/MarginMathHarness.sol`,
  `contracts/test/MarginMath.test.ts`.

### Phase 1 complete ✅ (2026-04-24)

- **All 4 shared libraries live**:
  - `FHESafeMath` — select-guarded arithmetic (safeSub, safeAdd, absDiff)
  - `TickMath` — UniV3 tick math (MIT port, pure)
  - `DecryptQueue` — async-decrypt state machine with replay guard
  - `MarginMath` — multiplication-only margin/PnL/liquidation math
- **Test count**: 57 passing (1 Smoke + 14 FHESafeMath + 13 TickMath +
  13 DecryptQueue + 16 MarginMath).
- **Coverage** (via `SOLIDITY_COVERAGE=true npx hardhat coverage`):
  - FHESafeMath: 100% / 100% / 100% / 100% (stmt/branch/func/line)
  - MarginMath:  100% / 100% / 100% / 100%
  - DecryptQueue: 100% / 100% / 100% / 100%
  - TickMath:   100% / 85.71% / 100% / 100% (branch coverage lower
    because UniV3 boundary revert paths are hard to exercise through
    the normal test surface; still above 80% threshold)
- **Note**: `hardhat coverage` requires `SOLIDITY_COVERAGE=true` env
  var for FHEVM plugin compatibility. Without it, the plugin errors
  with "Wrong Hardhat Network Config for Solidity Coverage". Future
  phases should use the same env var.
- **Plan bug caught + fixed**: TickMath symmetry test originally used
  `1n << 16n` absolute tolerance, which was mathematically impossible
  (products of ~2^96 operands have ~2^95 rounding drift). Tolerance
  corrected to `1n << 112n` (relative precision > 2^-80). Contract
  code unchanged — UniV3 port verified correct.
- **Why**: Phase 2 (Vault + services) and all subsequent engine phases
  depend on these libs. Every margin check, PnL calc, and async
  decrypt callback will flow through them.
- **Ready for Phase 2**: NoirVault, Oracle, Compliance services.

### Phase 2 — Task 1: MockERC7984 test fixture (2026-04-23)

- **Added**: `contracts/contracts/test-harness/MockERC7984.sol` — minimal
  ERC-7984 token mock for local Hardhat vault tests. Extends OZ's `ERC7984`
  base (openzeppelin/confidential-contracts v0.4.0). Exposes two mint
  entry points:
  - `mint(address, externalEuint64, bytes)` — proof-based mint (exercises
    the full `FHE.fromExternal` path).
  - `mintPlaintext(address, uint64)` — trivial-encrypt mint for tests that
    don't need the proof path.
  Both are open to any caller (test-only; NOT production-safe).
  **Why**: Vault tests in Task 5 need a locally deployable ERC-7984 token.
  On Sepolia the pre-deployed `cUSDCMock @ 0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
  is used instead.
  **Files**: `contracts/contracts/test-harness/MockERC7984.sol`.

- **OZ API verified** (no deviations from plan template):
  - Constructor: `ERC7984(string name_, string symbol_, string contractURI_)`
    — three args as expected; mock passes `""` for contractURI.
  - Internal mint: `_mint(address to, euint64 amount) internal returns (euint64)`
    — exact signature assumed by the plan.
  - `ERC7984` is a concrete (non-abstract) base extending only `ERC165`.
    No abstract methods to implement.
  - The plan's template was used verbatim with one cosmetic fix: the
    NatSpec `@openzeppelin/...` package reference in the dev comment was
    changed to remove the leading `@` (Solidity's docstring parser
    interpreted it as an unknown NatSpec tag and threw `DocstringParsingError`).
    This is a doc-comment-only change; no logic was altered.

### Phase 2 — Vault + services (in progress)

- **Added**: `contracts/contracts/services/Compliance.sol` — Merkle-tree
  KYC allowlist. Admin-controlled root + per-address revocation.
  Uses OZ `MerkleProof` with StandardMerkleTree leaf format
  (double-hashed). 14 unit tests covering verify, updateRoot, revoke,
  transferAdmin.
  **Files**: `contracts/contracts/services/Compliance.sol`,
  `contracts/test/Compliance.test.ts`.
- **Added**: `@openzeppelin/merkle-tree` dev dependency for JS-side
  Merkle tree construction in tests.
- **Added**: `contracts/contracts/services/Oracle.sol` — 2-of-3
  Chainlink relayer consensus for per-market price feeds (BTC=1,
  ETH=2, SOL=3). First submission stores pending; second submission
  from a different relayer within deviation tolerance + staleness
  window commits. Trivial-encrypts the committed price for FHE ops
  via `getEncryptedPrice`. 17 unit tests covering access control,
  quorum state machine (same-relayer, deviation-exceed, stale-pending,
  new-cycle-after-commit), freshness, encryption, admin rotation.
  **Files**: `contracts/contracts/services/Oracle.sol`,
  `contracts/test/Oracle.test.ts`.
- **Added**: `contracts/contracts/NoirVault.sol` (Task 4 scaffold —
  admin + engine authorization + pause). Subsequent tasks add balance
  ops and position storage. Uses OZ ERC-7984 interface for cUSDC
  reference (actual token address set at construction; zero-address
  allowed for admin-only tests). 15 unit tests covering construction,
  engine register/deregister, pause/unpause, admin transfer, zero-
  address guards. IERC7984 import path matches plan exactly:
  `openzeppelin/confidential-contracts/interfaces/IERC7984.sol`.
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/test/NoirVault.Admin.test.ts`.
- **Modified**: `contracts/contracts/NoirVault.sol` (Task 5 addition) —
  encrypted balance state + deposit/withdraw (user-facing) +
  adjustBalance (engine-only). Uses FHESafeMath for both safeAdd
  (deposits) and safeSub (withdrawals / debits). Saturating semantics
  on underflow prevent silent loss. 11 unit tests covering all three
  functions including pause gating and engine-only access control.
  **Deviation from plan**: `setOperator` called with `2n ** 48n - 1n`
  (uint48 max) rather than `2n ** 48n` (which overflows uint48 by 1);
  plan had an off-by-one in the far-future timestamp. `getBalance` is a
  view function returning the raw `euint64` handle; ACL grants issued at
  each mutation allow the user to decrypt client-side. Test count is 11
  (not 12) — plan's stated target matched a 12th test not included in
  the test file spec.
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/test/NoirVault.Balance.test.ts`.
- **Modified**: `contracts/contracts/NoirVault.sol` (Task 6 addition) —
  `Position` struct + `positions` mapping + `nextPositionId` counter +
  `writePosition` (engine-only) + `closePosition` (engine-only) +
  `getPosition` view. Positions store encrypted size / entryPrice /
  collateral plus plaintext isLong / marketId / owner / active. ACL:
  vault gets persistent `allowThis` per ciphertext; owner gets
  persistent `allow` to decrypt client-side. 9 unit tests via new
  `MockEngine` harness (plan target was ~10; 9 passing covers all paths).
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/contracts/test-harness/MockEngine.sol`,
  `contracts/test/NoirVault.Positions.test.ts`.
- **Added**: `contracts/scripts/deploy-local.ts` — one-shot Phase 2
  deploy script for the Hardhat local chain. Deploys MockERC7984,
  Compliance (empty root), Oracle (3 relayers = signers[1..3],
  staleness 90s, deviation 50bps), NoirVault. Template for Phase 3+
  engine deploys.
  **Files**: `contracts/scripts/deploy-local.ts`.

- **Added**: 6 Oracle coverage-gap tests (post-Task-6 review found
  the plan's Oracle test set missed `transferAdmin` entirely and
  didn't exercise the engine-facing `getEncryptedPrice` or the edge
  reverts `BadIndex` / `ZeroAddress` in `rotateRelayer`). Oracle
  coverage now 100% stmts / 100% funcs / 100% lines / 86.11% branches.
  **Files**: `contracts/test/Oracle.test.ts`.

- **Plan bug fixed inline**: Task 5's test used `2n ** 48n` as a
  far-future timestamp for `setOperator`. uint48 max is `2**48 - 1`;
  passing `2**48` overflows. Subagent corrected to `2n ** 48n - 1n`.

- **Plan test-count undercounting pattern**: Tasks 2, 3, 4, 6 all
  had actual test counts 1-2 higher than the plan estimated. No
  tests were skipped; plan author consistently undercounted leaf
  `it()` blocks. Final Phase 2 test totals: Compliance 16, Oracle
  23, Vault.Admin 15, Vault.Balance 11, Vault.Positions 9 = 74 new.

### Phase 2 complete ✅ (2026-04-24)

- **3 services + 1 vault live on local mock**:
  - `services/Compliance.sol` — Merkle allowlist w/ admin-controlled
    root + per-address revocation (OZ StandardMerkleTree convention)
  - `services/Oracle.sol` — 2-of-3 Chainlink relayer quorum, deviation
    tolerance (50bps), staleness window (90s), trivial-encrypts
    committed price for FHE downstream use
  - `NoirVault.sol` — sole owner of ciphertext state; encrypted
    balance mapping + deposit/withdraw (ERC-7984) + engine-gated
    adjustBalance + position storage + writePosition/closePosition
  - `test-harness/MockERC7984.sol` — local-test-only ERC-7984 mock
  - `test-harness/MockEngine.sol` — authorized-engine stand-in for
    vault mutator tests
- **Test count**: 131 total passing (57 prior + 74 Phase 2).
- **Coverage** (via `SOLIDITY_COVERAGE=true npx hardhat coverage`):
  - Compliance: 100% stmts / 100% branches / 100% funcs / 100% lines
  - Oracle:     100% stmts /  86.11% branches / 100% funcs / 100% lines
  - NoirVault:  100% stmts /  90.91% branches / 100% funcs / 100% lines
  - All ≥ 90% stmts/funcs/lines; all ≥ 80% branches (targets met).
- **Local deploy verified**: `npx hardhat run scripts/deploy-local.ts`
  prints 4 addresses cleanly. Script is the template for Phase 3+.
- **Sepolia deploy**: deferred to Phase 9 (needs funded key + real RPC).
- **Why**: Phase 3 PerpEngine can now call `vault.writePosition`,
  `vault.adjustBalance`, `oracle.getEncryptedPrice`, `compliance.verify`
  — all interfaces are live + tested.
- **Ready for Phase 3** (PerpEngine): open/close/liquidate for 3
  markets (BTC/ETH/SOL).

### Phase 1+2 retroactive Tier 1 audit (2026-04-24)

Ran spec-compliance + code-quality reviewer agents on Phases 1 and 2
before merging. Findings (2 critical, 5 important, several minor) all
addressed in follow-up commits. See CHANGELOG commits tagged
`fix(audit):` for details.

**Critical fixes**:
1. `NoirVault.writePosition` missing `FHE.isSenderAllowed` guards — CLAUDE.md
   rule #4 violation, real inference-attack vector.
2. `NoirVault.adjustBalance` took plaintext `uint64` instead of `euint64
   delta` — spec deviation that would have leaked engine-computed amounts
   to calldata and blocked Phase 3's PerpEngine.openPosition flow.

**Important fixes**:
3. `FHESafeMath.safeMul` added. `MarginMath` now routes every `FHE.mul`
   through it. Prevents silent-wrap in `shouldLiquidate` at
   `unrealizedLoss > 2^64 / 10_000 ≈ $1.8B USDC` (would have masked
   liquidation of deeply insolvent positions).
4. Oracle admin setters (`setStalenessSeconds`, `setDeviationBps`) now
   emit events (`StalenessChanged`, `DeviationBpsChanged`).
5. `DecryptQueue.cleanupStale` griefing vector documented (by-design,
   10x safety margin vs Gateway latency).
6. `NoirVault.withdraw` silent-zero ERC-7984 footgun documented.
7. `FHESafeMath.absDiff` select-guard pattern documented (raw `FHE.sub`
   safety rationale).

**Process fix** (the actual root cause): `PROGRESS.md` now mandates Tier 1
audit as a phase-completion criterion. Phase 0 had it; Phases 1-2 skipped
it; result was 2 critical + 5 important findings detected only on
retroactive review. Going forward every phase must pass Tier 1 before tick.

**Deferred (Phase 9 scope)**:
- `safeAdd` redundant `asEuint64(MAX_U64)` optimization
- Oracle ECDSA `sig` verification (msg.sender-as-attestation accepted for MVP)
- Test strengthening (pause-positive path, over-withdraw token delta check)

**Final Phase 2 test count**: 138 passing.

### Phase 3 — PerpEngine (in progress)

- **Added**: `NoirVault.allowBalanceAccess(user)` and
  `NoirVault.allowPositionAccess(positionId)` — engine-gated functions
  that grant `msg.sender` (authorized engine) transient ACL on the
  vault-stored ciphertexts and return the handles. Satisfies design
  spec §4.1's `grantTransient` contract. Enables PerpEngine to read
  vault state and compute FHE ops on it.
  Also added access-grant helpers to MockEngine harness for tests.
  5 unit tests (balance access + position access + non-engine guards).
  **Files**: `contracts/contracts/NoirVault.sol`,
  `contracts/contracts/test-harness/MockEngine.sol`,
  `contracts/test/NoirVault.AccessGrants.test.ts`.

- **Added**: `contracts/contracts/engines/PerpEngine.sol` — perpetual
  futures engine (Task 2 scaffold: admin + openPosition). Inherits
  `DecryptQueue` for later async-liquidation work. Config locked at
  construction: MAX_LEVERAGE=20, MAINT_MARGIN=500bps, LIQ_FEE=50bps.
  `openPosition` synchronous: compliance gate, oracle freshness, then
  FHE-guarded balance + margin check with silent-zero on failure.
  7 unit tests.
  **Deviation**: `whenNotPaused` uses local `error VaultPaused()` on
  PerpEngine rather than `NoirVault.VaultPaused()` cross-contract
  reference. Solidity ^0.8.27 supports the cross-contract syntax but
  the local error is cleaner and avoids tight coupling. Stack-too-deep
  resolved by splitting `openPosition` into `_computeFinals` +
  `_settle` internal helpers (no viaIR needed).
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Open.test.ts`.

- **Added**: `PerpEngine.closePosition(positionId)` — synchronous close.
  Fetches position via `vault.allowPositionAccess`, computes encrypted
  PnL via `MarginMath.pnlLong/pnlShort` (profit/loss branches), pays
  out `safeAdd(safeSub(collateral, loss), profit)` to user's vault
  balance, marks position inactive. Saturating throughout — loss
  exceeding collateral produces 0 payout. 7 unit tests (profitable,
  losing, max-loss-saturation, flat, ownership, double-close, stale oracle).
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Close.test.ts`.

- **Added**: `PerpEngine.requestLiquidation(positionId)` +
  `_onLiquidationDecided(reqId, handlesList, cleartexts, proof)` callback.
  Two-phase async state machine: (1) compute `shouldLiquidate` ebool on
  ciphertexts via `MarginMath.shouldLiquidate`, call
  `FHE.makePubliclyDecryptable(underwater)`, store handle + keeper in
  DecryptQueue; (2) callback verifies KMS signatures, dequeues (replay
  guard), conditionally liquidates. On liquidation: keeper fee (50bps
  via `FHE.div(safeMul(coll, feeBps), BPS_DIVISOR)`) credited to caller,
  remainder forfeited to `liquidationPool`. Position marked closed.
  **Deviations from plan**:
  - `FHE.requestDecryption` does NOT exist in @fhevm/solidity@0.11.1.
    Used `FHE.makePubliclyDecryptable(underwater)` instead; relayer reads
    the handle and calls back manually with KMS-signed proof.
  - `FHE.checkSignatures` takes `(bytes32[] handlesList, bytes cleartexts,
    bytes proof)` NOT `(uint256 requestId, bytes cleartexts, bytes proof)`.
    fhe-primitives.md §4 had the wrong signature — corrected in implementation.
  - `hre.fhevm.awaitDecryptionOracle()` does not exist. Tests use
    `hre.fhevm.publicDecrypt([handle])` to get `abiEncodedClearValues` +
    `decryptionProof`, then call `_onLiquidationDecided` manually.
  - `LiquidationRequested` event includes `underwaterHandle` (bytes32) so
    off-chain relayers know which handle to decrypt.
  - Cleartext encoding: `uint256` ABI decode used in callback (KMS encodes
    ebool as uint256 0/1), not `bool`.
  4 unit tests: underwater→liquidate (fee=7, pool=1493), healthy→no-op,
  already-closed guard, stale oracle guard.
  **Files**: `contracts/contracts/engines/PerpEngine.sol`,
  `contracts/test/PerpEngine.Liquidation.test.ts`.

- **Added**: `test/PerpEngine.MultiMarket.test.ts` — open+close cycle
  for all 3 markets (BTC=1, ETH=2, SOL=3) verifying marketId dispatch
  + oracle routing. 3 tests.
  **Files**: `contracts/test/PerpEngine.MultiMarket.test.ts`.

- **Modified**: `contracts/scripts/deploy-local.ts` — includes
  PerpEngine deploy + auto-registration on vault.
  **Files**: `contracts/scripts/deploy-local.ts`.

- **Added**: `frontend/src/pages/Compliance.tsx` +
  `frontend/src/hooks/useCompliance.ts`. TanStack-Query-backed
  fetch of compliance-backend `/proof/:address` and `/health`.
  Status pill (green/red), proof JSON for allowlisted users, backend
  health summary. Mailto stub for "request access".
  **Files**: `frontend/src/pages/Compliance.tsx`,
  `frontend/src/hooks/useCompliance.ts`.
