# FHEVM Primitives Reference (LIVING DOC)

**Source**: Zama Protocol docs, verified 2026-04-23.
**FHEVM version**: v0.12.1 (deployed Sepolia 2026-04-14).
**Re-verify this doc** whenever the main Zama docs ship a new major
version, OR whenever any agent is tempted to assume a primitive works
differently from what's written here.

---

## 1. Package pins (DO NOT BUMP without re-verification)

| Package | Version |
|---------|---------|
| `@fhevm/solidity` | `^0.11.1` |
| `@fhevm/hardhat-plugin` | `^0.4.2` |
| `@fhevm/mock-utils` | `^0.4.2` |
| `@zama-fhe/relayer-sdk` | `^0.4.2` |
| `@openzeppelin/confidential-contracts` | `0.4.0` (pinned, not ^) |
| `@openzeppelin/contracts` | `^5.2.0` |
| `hardhat` | `^2.22.0` |
| Solidity pragma | `^0.8.27` |

## 2. Sepolia addresses

| Contract | Address |
|----------|---------|
| KMS | `0x0309b4308A6AC121B9b3A960aC7Bc9bd8256cf38` |
| Coprocessor | `0xc22E393D2A1C1BD65c88d34a3bE4DD77e8952E71` |
| HCULimit | `0xa10998783c8CF88D886Bc30307e631D6686F0A22` |
| cUSDCMock (USDCx) | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` |
| cUSDTMock | `0x4E7B06D78965594eB5EF5414c357ca21E1554491` |

Contracts inherit `SepoliaConfig` from
`@fhevm/solidity/config/ZamaConfig.sol` to auto-wire these.

## 3. Supported operations on `euint64`

HCU costs from Zama's protocol docs. "Scalar" = ct op plaintext; "Non-scalar" = ct op ct.

| Op | Scalar HCU | Non-scalar HCU | Notes |
|----|-----------|----------------|-------|
| `add` | 133,000 | 162,000 | UNCHECKED — use `FHESafeMath.safeAdd` |
| `sub` | 133,000 | 162,000 | UNCHECKED — use `FHESafeMath.safeSub` |
| `mul` | 365,000 | 596,000 | ~8–15 deep fits in 5M sequential |
| `div` | 715,000 | **unsupported** | **CT ÷ CT does not exist**. Reformulate as mul. |
| `rem` | 1,153,000 | **unsupported** | Same as `div` |
| `and` / `or` / `xor` | 34,000 | 34,000 | |
| `shl` / `shr` | 34,000 | ~209,000 | |
| `rotl` / `rotr` | 34,000 | ~209,000 | |
| `eq` | 83,000 | 120,000 | |
| `ne` | 84,000 | 118,000 | |
| `ge` | 116,000 | 152,000 | |
| `gt` | 117,000 | 152,000 | |
| `le` | 119,000 | 149,000 | |
| `lt` | 118,000 | 146,000 | |
| `min` | 150,000 | 219,000 | |
| `max` | 149,000 | 218,000 | |
| `neg` | — | 131,000 | non-scalar only |
| `not` | — | 63 | non-scalar only |
| `select(ebool, ct, ct)` | — | 55,000 | non-scalar only |
| `randEuint64` | 24,000 | — | |
| `asEuint64(uint64)` | 32 | — | "trivial encrypt" — effectively free |

### Global limits per transaction
- **20,000,000 HCU** total (any op combination)
- **5,000,000 HCU** sequential depth
- Plus normal EVM gas (30M Sepolia block limit)

## 4. ACL functions

| Function | Purpose | Persistence |
|----------|---------|-------------|
| `FHE.allow(ct, addr)` | Grant decrypt/use permission | Persistent (storage) |
| `FHE.allowTransient(ct, addr)` | Grant for current tx only | Transient (EIP-1153) |
| `FHE.allowThis(ct)` | Shorthand for `allow(ct, address(this))` | Persistent |
| `FHE.isSenderAllowed(ct)` | Check sender permission on a ct | Read-only |
| `FHE.checkSignatures(reqId, cleartexts, proof)` | Verify KMS decrypt proof | Read-only |

**ACL rules (load-bearing):**
- Every engine entry must call `require(FHE.isSenderAllowed(ct))` on
  each ciphertext input. Inference-attack guard.
- `allowTransient` does NOT auto-propagate through call chains.
  Explicitly chain: `ct.allowTransient(addr1).allowTransient(addr2)`.
- Engines use `allowTransient` only. Persistent `allow` lives inside
  Vault for state it owns.

## 5. Async decryption

Synchronous decryption does NOT exist on FHEVM. All reveals are async:

```solidity
// Request decrypt (payable — $ZAMA fee)
uint256 reqId = FHE.requestDecryption(
    bytes32[] memory ctHandles,
    bytes4 callbackSelector
);

// Callback (called by Gateway 15–60s later)
function _onDecided(
    uint256 reqId,
    bytes memory cleartexts,
    bytes memory decryptionProof
) external {
    FHE.checkSignatures(reqId, cleartexts, decryptionProof);
    // ALWAYS delete pending entry BEFORE external calls — replay guard
    delete pending[reqId];
    bool decoded = abi.decode(cleartexts, (bool));
    // ... act on decoded
}
```

**Fees** (published, paid in $ZAMA pegged to USD):
- Decryption: $0.001–$0.1 per ciphertext (subscription discounts available)
- ZKPoK verification (on encrypted input): $0.005–$0.5 per encrypted input
- Bridge: $0.01–$1

Fees can be paid by end user, frontend, or relayer — user need not hold $ZAMA.

**User-side decrypt** (for "show me my balance" flows): uses Relayer
SDK's `userDecrypt` — requires user signature; self-relaying model
since v0.9. Not the same as contract-requested decryption.

## 6. External encrypted inputs

Users encrypt client-side via `@zama-fhe/relayer-sdk`. Function
signatures receive inputs as:

```solidity
function foo(externalEuint64 eValue, bytes calldata inputProof) external {
    euint64 value = FHE.fromExternal(eValue, inputProof);
    require(FHE.isSenderAllowed(value), "not allowed");
    // ... use value
}
```

`inputProof` is a ZK proof of knowledge that the encrypted value is
well-formed. Verification cost: $0.005–$0.5 per input (see fees above).

## 7. Known footguns (from OZ FHEVM Security Guide, Feb 2026)

1. **Silent overflow**: FHE arithmetic is unchecked. Use
   `FHESafeMath.safeSub / safeAdd` with `select`-guarded fallback.
2. **Over-broad ACL**: persistent `allow` to a permissive contract
   makes it a disclosure oracle. Prefer `allowTransient`.
3. **Replay in async callbacks**: stateless callbacks let attackers
   re-submit decrypt results. Always `delete pending[reqId]` BEFORE
   external calls in the callback.
4. **Silent-zero transfers**: ERC-7984 transfers silently clamp to 0
   on insufficient balance. Post-transfer, verify encrypted delta via
   `select` and reject if 0.
5. **Pre-finality disclosure**: reorgs can retroactively reveal + then
   revert. Add 3-block finality delay before liquidation callback acts.
6. **Inference via `isSenderAllowed`**: always verify caller
   authorization on received ct handles.

## 8. Operations that do NOT exist (STOP if you're tempted)

- `FHE.div(euint64, euint64)` — ct ÷ ct. Roadmap says "coming soon"
  with no ETA. Reformulate as multiplication.
- `FHE.rem(euint64, euint64)` — same.
- `ebytes` — removed in a recent version.
- Signed `eintX` types — "coming soon"; use uint64 with sign via bool flag.
- Synchronous decrypt — doesn't exist. All async.
- Anything with "loop over all positions" — you'll hit the 5M HCU
  sequential limit. Batch across txs.

## 9. Re-verification checklist

When updating this doc:
1. Fetch https://docs.zama.org/protocol/llms-full.txt — current full corpus
2. Check `@fhevm/solidity` on npm for new major versions
3. Check OpenZeppelin confidential-contracts changelog
4. Update version pins in §1, addresses in §2, op table in §3
5. Test the smoke test in `contracts/test/smoke.test.ts` still passes
6. Commit with `docs: refresh FHEVM primitives (verified YYYY-MM-DD)`
