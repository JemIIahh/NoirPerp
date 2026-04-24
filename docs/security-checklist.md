# NoirPerp — Security Checklist

Filled in during Phase 9 (Integration + audit). Phase-gate rule:
every checkbox below must be ticked before submission.

Source: [OpenZeppelin FHEVM Security Guide (Feb 2026)](https://www.openzeppelin.com/news/a-developers-guide-to-fhevm-security).

---

## Category A — FHE arithmetic hygiene

- [ ] No raw `FHE.sub` or `FHE.add` outside `lib/FHESafeMath.sol`
- [ ] Every arithmetic path that might underflow uses `safeSub` / `safeAdd`
- [ ] Overflow cases explicitly tested (collateral, payout, balance paths)

## Category B — ACL discipline

- [ ] Every engine entry function calls `require(FHE.isSenderAllowed(ct))`
      on every ciphertext input
- [ ] No engine grants persistent `allow` — only `allowTransient`
- [ ] Vault is the only contract granting persistent `allow` on state it owns
- [ ] Multi-contract call chains explicitly chain `allowTransient`

## Category C — Async decryption callbacks

- [ ] Every `_on*Decided` callback calls `FHE.checkSignatures` first
- [ ] Every callback calls `DecryptQueue.dequeue(reqId)` BEFORE any
      external call (replay guard)
- [ ] 3-block finality delay on liquidation callbacks (reorg protection)
- [ ] Timeout sweep: stale pending entries are cleaned up

## Category D — ERC-7984 interaction

- [ ] Post-transfer, verify encrypted delta via `FHE.select` and reject
      if 0 (silent-zero protection)
- [ ] No assumption that `confidentialTransfer(...)` transfers the full amount

## Category E — Oracle freshness

- [ ] Every price-dependent op calls `require(oracle.isFresh(marketId))`
- [ ] Staleness window documented and conservative
- [ ] 2-of-3 quorum enforced; no single-relayer price commit

## Category F — Admin + pause

- [ ] All admin functions gated by multisig (Safe 2-of-3)
- [ ] `NoirVault.emergencyPause` cascades to all engines
- [ ] Engine registration + deregistration via multisig only

## Category G — Tooling

- [ ] Slither run clean (or all warnings triaged)
- [ ] Mythril run clean (or all warnings triaged)
- [ ] HCU budget tests green (no op > 5M sequential, 20M global)
- [ ] Invariant tests (Foundry) green for 10,000+ runs
- [ ] Full Sepolia E2E walkthrough documented

## Per-contract sign-off

- [ ] `NoirVault.sol`
- [ ] `engines/PerpEngine.sol`
- [ ] `engines/AMMEngine.sol`
- [ ] `engines/DarkpoolEngine.sol`
- [ ] `engines/LimitEngine.sol`
- [ ] `services/Oracle.sol`
- [ ] `services/Compliance.sol`
- [ ] `lib/FHESafeMath.sol`
- [ ] `lib/MarginMath.sol`
- [ ] `lib/TickMath.sol`
- [ ] `lib/DecryptQueue.sol`
