import * as hre from "hardhat";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";

/// Idempotent provisioning for the Phase 11+ Sepolia smoke test:
///   - Admin: ensure ≥1 USDCx in NoirVault.
///   - Trader B: ensure ≥1 USDCx in NoirVault.
/// 1 USDCx = 1_000_000 vault units (cUSDCMock has 6 decimals); the smoke
/// test only locks 400 per side so 1 USDCx is plenty.
///
/// Run AFTER setup-sepolia.ts has minted admin the initial 1M USDCx and
/// set vault as operator on cUSDCMock for admin.
///
/// Run: `npx hardhat run scripts/setup-smoke-traders.ts --network sepolia`

// 6-decimal USDC; 1 USDCx = 1e6 units. Provision 10 USDCx per trader.
const PROVISION_AMOUNT = 10_000_000n;

// Underlying ERC20Mock referenced by Zama's cUSDCMock (verified via
// cUSDCMock.underlying() during Phase 9 audit).
const UNDERLYING_USDC_MOCK = "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF";

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11155111n) {
    throw new Error(`Wrong network: expected Sepolia (11155111), got ${network.chainId}`);
  }

  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
  const provider = hre.ethers.provider;

  const adminPk = process.env.PRIVATE_KEY;
  const traderBPk = process.env.SMOKE_TRADER_B_PK;
  if (!adminPk) throw new Error("PRIVATE_KEY (admin) missing in contracts/.env");
  if (!traderBPk) throw new Error("SMOKE_TRADER_B_PK missing in contracts/.env");
  const admin = new Wallet(adminPk, provider);
  const traderB = new Wallet(traderBPk, provider);
  console.log(`admin    : ${admin.address}`);
  console.log(`traderB  : ${traderB.address}`);

  const vault = await hre.ethers.getContractAt("NoirVault", dep.contracts.NoirVault, admin);

  // Helper: vault balance handle is bytes32(0) iff user never deposited.
  const hasVaultDeposit = async (addr: string): Promise<boolean> => {
    const h: string = await vault.getBalance(addr);
    return h !== "0x0000000000000000000000000000000000000000000000000000000000000000";
  };

  const cUSDCAdmin = new hre.ethers.Contract(
    dep.contracts.cUSDCMock,
    [
      "function wrap(address to, uint256 amount)",
      "function setOperator(address operator, uint48 until)",
    ],
    admin,
  );
  const cUSDCB = new hre.ethers.Contract(
    dep.contracts.cUSDCMock,
    ["function setOperator(address operator, uint48 until)"],
    traderB,
  );
  const underlyingAdmin = new hre.ethers.Contract(
    UNDERLYING_USDC_MOCK,
    [
      "function mint(address to, uint256 amount)",
      "function balanceOf(address) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
    ],
    admin,
  );

  // ─── Step 1: ensure admin has underlying to wrap (mint open) ────
  // We need PROVISION_AMOUNT × 2 (one for admin's deposit, one for B).
  const need = PROVISION_AMOUNT * 2n;
  const underlyingBal: bigint = await underlyingAdmin.balanceOf(admin.address);
  if (underlyingBal < need) {
    const mintAmt = need - underlyingBal;
    const tx = await underlyingAdmin.mint(admin.address, mintAmt);
    await tx.wait();
    console.log(`step 1   admin minted ${mintAmt} underlying USDC (had ${underlyingBal}, need ${need})`);
  } else {
    console.log(`step 1   admin already has ${underlyingBal} underlying USDC ≥ ${need}, skipping mint`);
  }

  // ─── Step 2: ensure approval cUSDCMock can pull underlying ──────
  const allowance: bigint = await underlyingAdmin.allowance(admin.address, dep.contracts.cUSDCMock);
  if (allowance < need) {
    const tx = await underlyingAdmin.approve(dep.contracts.cUSDCMock, hre.ethers.MaxUint256);
    await tx.wait();
    console.log(`step 2   admin approved cUSDCMock to spend underlying (MaxUint256)`);
  } else {
    console.log(`step 2   admin allowance ${allowance} ≥ ${need}, skipping approve`);
  }

  // ─── Step 3: wrap underlying → USDCx for trader B (mints USDCx to B) ─
  // wrap(to, amount) takes underlying from msg.sender and credits `to` confidentially.
  // This skips the need for a confidential transfer (avoids relayer-SDK
  // input encryption from the admin side).
  const txWrapB = await cUSDCAdmin.wrap(traderB.address, PROVISION_AMOUNT);
  await txWrapB.wait();
  console.log(`step 3   wrapped ${PROVISION_AMOUNT} → USDCx for trader B (tx ${txWrapB.hash})`);

  // ─── Step 4: trader B sets vault as operator on cUSDCMock ──────
  // The deposit() flow uses ERC-7984 operator semantics: vault calls
  // confidentialTransferFrom on the user's USDCx balance.
  const tx4 = await cUSDCB.setOperator(dep.contracts.NoirVault, 2n ** 48n - 1n);
  await tx4.wait();
  console.log(`step 4   trader B setOperator(vault) on cUSDCMock`);

  // ─── Step 5: trader B deposits PROVISION_AMOUNT into vault ─────
  const vaultB = vault.connect(traderB);
  if (!(await hasVaultDeposit(traderB.address))) {
    const tx5 = await (vaultB as any).deposit(PROVISION_AMOUNT);
    await tx5.wait();
    console.log(`step 5   trader B deposited ${PROVISION_AMOUNT} into vault (tx ${tx5.hash})`);
  } else {
    console.log(`step 5   trader B already has vault balance, skipping deposit`);
  }

  // ─── Step 6: admin deposits PROVISION_AMOUNT into vault (if needed) ─
  // setup-sepolia.ts already setOperator(vault) for admin, so this is one tx.
  if (!(await hasVaultDeposit(admin.address))) {
    const tx6 = await (vault as any).deposit(PROVISION_AMOUNT);
    await tx6.wait();
    console.log(`step 6   admin deposited ${PROVISION_AMOUNT} into vault (tx ${tx6.hash})`);
  } else {
    console.log(`step 6   admin already has vault balance, skipping deposit`);
  }

  console.log(`\n✓ smoke traders provisioned. Run: npx hardhat run scripts/smoke-sepolia-pair-match.ts --network sepolia`);
}

main().catch((e) => { console.error(e); process.exit(1); });
