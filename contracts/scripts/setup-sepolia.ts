import * as hre from "hardhat";
import { readFileSync } from "node:fs";

/// Phase 9 Sepolia bring-up: single-shot script that takes the
/// freshly-deployed contracts (placeholder relayers, no token balance,
/// stale oracle) to "ready to trade" state.
///
/// Run AFTER deploy-sepolia.ts has written deployments/sepolia.json.
/// Idempotent on most steps; rotateRelayer is one-way (calling with the
/// currently-set address is a no-op). Re-running after partial failure
/// is safe except for fund transfers — those will happily send again.
///
/// Steps (in order):
///   1. Fund real relayers A and B (~0.05 ETH each from admin).
///   2. Oracle.rotateRelayer(0, A) + (1, B) so the placeholders are
///      replaced. Slot 2 keeps its placeholder (Phase 7 "C offline").
///   3. Mint 1M underlying ERC20Mock USDC to admin (open mint).
///   4. Approve cUSDCMock proxy to spend the underlying.
///   5. Wrap 1M into confidential cUSDCMock balance for admin.
///   6. setOperator on cUSDCMock so NoirVault can pull tokens during
///      deposit (matches the local setup-demo.ts pattern).
///   7. Commit BTC=60000 / ETH=3000 / SOL=150 oracle prices through
///      the now-funded real relayers (2-of-3 quorum: A then B).
///
/// After this completes, NoirPerp on Sepolia is ready for: deposit →
/// open → close → AMM add/withdraw → darkpool submit/cancel.

// Underlying ERC20Mock referenced by Zama's cUSDCMock (read once at
// module load — verified via cUSDCMock.underlying() during the audit
// pass). 6-decimal regular USDC mock, open mint.
const UNDERLYING_USDC_MOCK = "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF";

// 1M USDC at 6 decimals.
const WRAP_AMOUNT = 1_000_000n * 10n ** 6n;

// Funding amount per relayer (~0.05 ETH covers ~thousands of price
// pushes at Sepolia gas prices).
const RELAYER_FUNDING = hre.ethers.parseEther("0.05");

async function main() {
  // ─── Preflight ──────────────────────────────────────────────────────
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11155111n) {
    throw new Error(
      `Wrong network: expected Sepolia (11155111), got ${network.chainId}. ` +
      `Run with --network sepolia.`,
    );
  }

  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));

  const RELAYER_A_PRIVKEY = process.env.RELAYER_A_PRIVKEY;
  const RELAYER_B_PRIVKEY = process.env.RELAYER_B_PRIVKEY;
  if (!RELAYER_A_PRIVKEY || !RELAYER_B_PRIVKEY) {
    throw new Error("RELAYER_A_PRIVKEY and RELAYER_B_PRIVKEY env vars required");
  }

  const [admin] = await hre.ethers.getSigners();
  if (!admin) throw new Error("No admin signer — set PRIVATE_KEY in contracts/.env");

  const provider = hre.ethers.provider;
  const relayerA = new hre.ethers.Wallet(RELAYER_A_PRIVKEY, provider);
  const relayerB = new hre.ethers.Wallet(RELAYER_B_PRIVKEY, provider);

  console.log("=== Sepolia bring-up ===");
  console.log("Admin:        ", admin.address);
  console.log("Relayer A:    ", relayerA.address);
  console.log("Relayer B:    ", relayerB.address);
  console.log("");

  // ─── Step 1: Fund relayers from admin ──────────────────────────────
  for (const [label, target] of [["A", relayerA.address], ["B", relayerB.address]] as const) {
    const balance = await provider.getBalance(target);
    if (balance >= RELAYER_FUNDING / 2n) {
      console.log(`Step 1 — Relayer ${label} already has ${hre.ethers.formatEther(balance)} ETH (skip)`);
      continue;
    }
    const tx = await admin.sendTransaction({ to: target, value: RELAYER_FUNDING });
    await tx.wait(1);
    console.log(`Step 1 — Funded Relayer ${label} with ${hre.ethers.formatEther(RELAYER_FUNDING)} ETH (tx ${tx.hash})`);
  }

  // ─── Step 2: Rotate Oracle slots ──────────────────────────────────
  const oracle = new hre.ethers.Contract(
    dep.contracts.Oracle,
    [
      "function relayers(uint256) view returns (address)",
      "function rotateRelayer(uint8 index, address newRelayer)",
    ],
    admin,
  );

  for (const [slot, target] of [[0, relayerA.address], [1, relayerB.address]] as const) {
    const current = await oracle.relayers(slot);
    if (current.toLowerCase() === target.toLowerCase()) {
      console.log(`Step 2 — Oracle slot ${slot} already = ${target} (skip)`);
      continue;
    }
    const tx = await oracle.rotateRelayer(slot, target);
    await tx.wait(1);
    console.log(`Step 2 — Rotated Oracle slot ${slot} → ${target} (tx ${tx.hash})`);
  }

  // ─── Step 3: Mint underlying USDC ──────────────────────────────────
  const underlying = new hre.ethers.Contract(
    UNDERLYING_USDC_MOCK,
    [
      "function balanceOf(address) view returns (uint256)",
      "function mint(address to, uint256 amount)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
    ],
    admin,
  );

  const adminUnderlyingBal = await underlying.balanceOf(admin.address);
  if (adminUnderlyingBal < WRAP_AMOUNT) {
    const need = WRAP_AMOUNT - adminUnderlyingBal;
    const tx = await underlying.mint(admin.address, need);
    await tx.wait(1);
    console.log(`Step 3 — Minted ${need / 10n ** 6n} underlying USDC to admin (tx ${tx.hash})`);
  } else {
    console.log(`Step 3 — Admin already holds ${adminUnderlyingBal / 10n ** 6n} underlying USDC (skip)`);
  }

  // ─── Step 4: Approve cUSDCMock proxy ──────────────────────────────
  const allowance = await underlying.allowance(admin.address, dep.contracts.cUSDCMock);
  if (allowance < WRAP_AMOUNT) {
    const tx = await underlying.approve(dep.contracts.cUSDCMock, hre.ethers.MaxUint256);
    await tx.wait(1);
    console.log(`Step 4 — Approved cUSDCMock for unlimited underlying (tx ${tx.hash})`);
  } else {
    console.log(`Step 4 — cUSDCMock already has sufficient allowance (skip)`);
  }

  // ─── Step 5: Wrap underlying → confidential cUSDCMock ─────────────
  const cUSDC = new hre.ethers.Contract(
    dep.contracts.cUSDCMock,
    [
      "function wrap(address to, uint256 amount)",
      "function setOperator(address operator, uint48 until)",
      "function isOperator(address holder, address spender) view returns (bool)",
    ],
    admin,
  );
  // We can't read the confidential balance plaintext on-chain (it's
  // ciphertext). Just attempt the wrap — if admin already has plenty
  // it's still safe to add more for the demo budget.
  const wrapTx = await cUSDC.wrap(admin.address, WRAP_AMOUNT);
  await wrapTx.wait(1);
  console.log(`Step 5 — Wrapped ${WRAP_AMOUNT / 10n ** 6n} underlying → confidential cUSDCMock (tx ${wrapTx.hash})`);

  // ─── Step 6: Set NoirVault as operator on cUSDCMock ──────────────
  const isOp = await cUSDC.isOperator(admin.address, dep.contracts.NoirVault);
  if (!isOp) {
    const tx = await cUSDC.setOperator(dep.contracts.NoirVault, 2n ** 48n - 1n);
    await tx.wait(1);
    console.log(`Step 6 — Set NoirVault as operator on cUSDCMock for admin (tx ${tx.hash})`);
  } else {
    console.log(`Step 6 — NoirVault already operator on cUSDCMock (skip)`);
  }

  // ─── Step 7: Commit oracle prices via 2-of-3 quorum ──────────────
  const oracleSubmit = new hre.ethers.Contract(
    dep.contracts.Oracle,
    ["function submitPrice(uint8 marketId, uint64 price, uint64 timestamp)"],
    provider,
  );

  const block = await provider.getBlock("latest");
  const baseT = BigInt(block!.timestamp);

  for (const [m, p, dt] of [[1, 60000n, 0n], [2, 3000n, 2n], [3, 150n, 4n]] as const) {
    const txA = await oracleSubmit.connect(relayerA).submitPrice(m, p, baseT + dt);
    await txA.wait(1);
    const txB = await oracleSubmit.connect(relayerB).submitPrice(m, p, baseT + dt + 1n);
    await txB.wait(1);
    console.log(`Step 7 — Committed market ${m} price ${p} via A+B (txA ${txA.hash}, txB ${txB.hash})`);
  }

  console.log("");
  console.log("=== Sepolia bring-up complete ===");
  console.log("");
  console.log("NoirPerp is now live and tradable on Sepolia. Oracle is fresh,");
  console.log("admin holds confidential cUSDCMock balance, vault is authorized");
  console.log("operator, real relayers in slots 0 + 1.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
