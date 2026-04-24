# NoirPerp — Agent Instructions (PINNED)

This file loads automatically into every Claude Code session in this repo.
These rules override defaults. Violations block commits.

## What NoirPerp is
Privacy-preserving perpetual-futures DEX on Zama FHEVM (Sepolia, v0.12.1).
Ground-up rewrite of ZKPerp (Aleo → FHE). Design spec:
`docs/specs/2026-04-24-noirperp-design.md` — read it before any work.

## FHEVM primitive rules (the load-bearing ones)

1. **Namespace is `FHE.*`** — never `TFHE.*`. The old API was deprecated in
   FHEVM v0.9. If you see `TFHE.` in any code, it's wrong, migrate it.

2. **`FHE.div(euint64, euint64)` does not exist.** Ciphertext ÷ ciphertext
   is unsupported. Reformulate every ratio check as multiplication:
   `a × MAX >= b × price` instead of `b × price / a <= 1/MAX`.

3. **FHE arithmetic is UNCHECKED.** `FHE.sub(a, b)` wraps silently on
   underflow. Always use `FHESafeMath.safeSub` / `safeAdd` from `lib/`.
   Raw `FHE.sub` / `FHE.add` are banned outside the lib.

4. **Every engine entry requires `require(FHE.isSenderAllowed(ct))`.**
   Skipping this enables inference attacks where a caller routes a
   ciphertext they shouldn't have access to through our engine.

5. **ACL discipline**: engines use `allowTransient` only. Persistent
   `allow` lives inside the Vault for state it owns. Never grant
   persistent `allow` to an engine — it becomes a disclosure oracle.

6. **Decrypt callbacks**: every `_on*Decided` callback must call
   `DecryptQueue.dequeue(reqId)` BEFORE any external call. Replay guard.
   Also must call `FHE.checkSignatures(reqId, cleartexts, proof)` first.

7. **HCU budget is 5M sequential / 20M global per tx.** Deep FHE
   multiplication chains (>~10 muls deep) will blow the sequential
   limit. Batch operations across txs when necessary.

## Token / library rules

- Token standard is **ERC-7984** via `@openzeppelin/confidential-contracts@0.4.0`.
  Not `ConfidentialERC20` (renamed symbol, gone).
- USDCx on Sepolia: use the pre-deployed `cUSDCMock @ 0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`.
  Do not deploy your own wrapper.
- Contracts inherit `ZamaEthereumConfig` from `@fhevm/solidity/config/ZamaConfig.sol`
  to auto-wire KMS + coprocessor addresses. (`SepoliaConfig` does NOT
  exist in v0.11.1 — that was an older API name.)

## Change management rules

1. **`CHANGELOG.md` entry BEFORE commit.** No commit without the
   corresponding entry. Format: what changed, why, files touched.

2. **`PROGRESS.md` updated on phase completion.** A phase is "complete"
   only when its checkbox is ticked, tests are green, and CHANGELOG has
   the entry. Phase N+1 may not start otherwise.

3. **Never change FHE primitive assumptions without re-verifying
   `docs/fhe-primitives.md`.** If something in that doc seems wrong,
   re-fetch the Zama docs, update the primitives doc, then proceed.

4. **No placeholder code.** Never write `// TODO`, `// implement later`,
   or stub functions that revert. Complete the task or don't claim it
   done.

5. **No new files unless the plan says so.** If a file isn't listed in
   the current phase's implementation plan, don't create it. If you
   need one that isn't planned, propose the addition and wait.

## Testing rules

- Every new Solidity function ships with at least one unit test (Hardhat
  + FHEVM mock). Coverage target per engine: ≥90%.
- Failing tests block commits. Do not push around a failing test by
  commenting it out; fix the root cause or mark it `.skip` with a
  CHANGELOG entry explaining why.
- Invariant + fuzz tests (Foundry) run in Phase 9. Don't write them
  earlier; they need the full contract surface to be useful.

## What NOT to do

- Don't add error handling, retries, or fallbacks for scenarios the
  design spec doesn't call out. Trust the spec's error-handling table
  in Section 6.
- Don't refactor unrelated code while making a targeted change.
- Don't write new docs unless the current phase's plan says so. The
  spec is the source of truth for design; CHANGELOG tracks history;
  PROGRESS tracks state. Don't proliferate.
- Don't invent FHEVM primitives. If it's not in `docs/fhe-primitives.md`
  or the Zama docs, it doesn't exist.
- Don't skip the `FHE.isSenderAllowed` guard. Ever. Even for internal
  helpers. It's cheap and load-bearing.

## Reference resources (authoritative, in priority order)

1. `docs/specs/2026-04-24-noirperp-design.md` — design spec (this project)
2. `docs/fhe-primitives.md` — verified FHEVM primitives (this project)
3. `docs/security-checklist.md` — OZ FHEVM security guide applied here
4. https://docs.zama.org/protocol — Zama Protocol canonical docs
5. https://github.com/zama-ai/fhevm — FHEVM source
6. https://github.com/OpenZeppelin/openzeppelin-confidential-contracts — ERC-7984 source
