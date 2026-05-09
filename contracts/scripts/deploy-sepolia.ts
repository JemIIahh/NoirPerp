import * as hre from "hardhat";

/// Phase 9 Sepolia deploy script.
///
/// Mirrors deploy-local.ts step-for-step with these required differences:
///   - SKIP MockERC7984 deploy. Per CLAUDE.md token rule, NoirVault must
///     wire to Zama's pre-deployed cUSDCMock at the canonical address
///     below. Deploying our own ERC-7984 silos NoirPerp's USDCx away
///     from every other Zama demo on Sepolia.
///   - Three relayer addresses come from env (RELAYER_A/B/C_ADDRESS).
///     They must be funded EOAs separate from the deployer.
///   - Writes deployments/sepolia.json (chainId 11155111) instead of
///     local.json.
///   - Refuses to overwrite an existing sepolia.json — Sepolia deploys
///     are not redoable; user must explicitly `rm` the artifact first.
///
/// Network preconditions:
///   - hardhat.config.ts has the `sepolia` network block (already done).
///   - PRIVATE_KEY env var holds the deployer's secret (~0.5 Sepolia ETH
///     covers all 8 deploys + 6 wiring txs + buffer).
///   - SEPOLIA_RPC_URL env var or default (publicnode.com).
///
/// Run with:
///   npx hardhat run scripts/deploy-sepolia.ts --network sepolia
///
/// After this script completes, follow up with:
///   - scripts/setup-sepolia.ts  — mint cUSDCMock + commit oracle prices
///   - scripts/sync-compliance-root.ts --network sepolia — push merkle root

// Zama's pre-deployed cUSDCMock on Sepolia. Canonical confidential
// USDC mock used across all Zama demos. CLAUDE.md token rule.
const SEPOLIA_CUSDC_MOCK = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";

async function main() {
  // ─── Preflight ──────────────────────────────────────────────────────
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11155111n) {
    throw new Error(
      `Wrong network: expected Sepolia (chainId 11155111), got ${network.chainId}. ` +
        `Run with --network sepolia.`
    );
  }

  const RELAYER_A = process.env.RELAYER_A_ADDRESS;
  const RELAYER_B = process.env.RELAYER_B_ADDRESS;
  const RELAYER_C = process.env.RELAYER_C_ADDRESS;
  if (!RELAYER_A || !RELAYER_B || !RELAYER_C) {
    throw new Error(
      "RELAYER_A_ADDRESS, RELAYER_B_ADDRESS, RELAYER_C_ADDRESS env vars are required for Sepolia deploy. " +
        "These are 3 separate EOAs that submit oracle prices via 2-of-3 quorum."
    );
  }

  const fs = await import("fs");
  const path = await import("path");
  const deploymentDir = path.resolve(__dirname, "..", "deployments");
  const artifactPath = path.join(deploymentDir, "sepolia.json");
  if (fs.existsSync(artifactPath)) {
    throw new Error(
      `deployments/sepolia.json already exists. Sepolia deploys are not redoable; ` +
        `to start fresh, delete the file manually first: rm ${artifactPath}`
    );
  }

  const [admin] = await hre.ethers.getSigners();
  if (!admin)
    throw new Error("No signer available — set PRIVATE_KEY in contracts/.env");

  const adminBalance = await hre.ethers.provider.getBalance(admin.address);
  // if (adminBalance < hre.ethers.parseEther("0.1")) {
  //   throw new Error(
  //     `Deployer ${admin.address} has only ${hre.ethers.formatEther(adminBalance)} Sepolia ETH. ` +
  //     `Need at least 0.1 ETH (recommended 0.5). Fund from a faucet first.`,
  //   );
  // }

  console.log("=== NoirPerp Phase 9 Sepolia deploy ===");
  console.log("Deployer:    ", admin.address);
  console.log("Balance:     ", hre.ethers.formatEther(adminBalance), "ETH");
  console.log("cUSDCMock:   ", SEPOLIA_CUSDC_MOCK, "(pre-deployed by Zama)");
  console.log("Relayers:    ", RELAYER_A, RELAYER_B, RELAYER_C);
  console.log("");

  // ─── 1. Compliance ─────────────────────────────────────────────────
  // Empty initial root; sync-compliance-root.ts will push the live root
  // from compliance-backend after this deploy completes.
  const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
  const compliance = await ComplianceFactory.deploy(
    admin.address,
    hre.ethers.ZeroHash
  );
  await compliance.waitForDeployment();
  const complianceAddr = await compliance.getAddress();
  console.log("Compliance deployed: ", complianceAddr);

  // ─── 2. Oracle ─────────────────────────────────────────────────────
  // 2-of-3 quorum, 90s staleness, 50 bps deviation guard. Same params as
  // deploy-local.ts; tune in setup-sepolia.ts if Sepolia block-time
  // pacing requires looser staleness.
  const OracleFactory = await hre.ethers.getContractFactory("Oracle");
  const oracle = await OracleFactory.deploy(
    admin.address,
    [RELAYER_A, RELAYER_B, RELAYER_C],
    90,
    50
  );
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("Oracle deployed:     ", oracleAddr);

  // ─── 3. NoirVault ──────────────────────────────────────────────────
  // ★ Critical Sepolia difference: usdcxToken = SEPOLIA_CUSDC_MOCK,
  //   NOT a freshly-deployed mock. Per CLAUDE.md token rule.
  const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
  const vault = await VaultFactory.deploy(admin.address, SEPOLIA_CUSDC_MOCK);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("NoirVault deployed:  ", vaultAddr, "(usdcx=cUSDCMock)");

  // ─── 4. PerpEngine ─────────────────────────────────────────────────
  // liquidationPool starts as admin; repointed to AMMEngine in step 5.
  const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
  const perp = await PerpFactory.deploy(
    vaultAddr,
    oracleAddr,
    complianceAddr,
    admin.address,
    admin.address
  );
  await perp.waitForDeployment();
  const perpAddr = await perp.getAddress();
  console.log("PerpEngine deployed: ", perpAddr);

  await (await vault.registerEngine(perpAddr)).wait();
  console.log("PerpEngine registered as authorized engine on vault");

  // ─── 5. AMMEngine ──────────────────────────────────────────────────
  const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
  const amm = await AMMFactory.deploy(vaultAddr, admin.address);
  await amm.waitForDeployment();
  const ammAddr = await amm.getAddress();
  console.log("AMMEngine deployed:  ", ammAddr);

  await (await vault.registerEngine(ammAddr)).wait();
  console.log("AMMEngine registered as authorized engine on vault");

  await (await amm.setOracle(oracleAddr)).wait();
  console.log("AMMEngine oracle set");

  await (await perp.setLiquidationPool(ammAddr)).wait();
  console.log("PerpEngine liquidationPool repointed to AMMEngine");

  // ─── 6. LimitEngine ────────────────────────────────────────────────
  const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
  const limit = await LimitFactory.deploy(vaultAddr, admin.address);
  await limit.waitForDeployment();
  const limitAddr = await limit.getAddress();
  console.log("LimitEngine deployed:", limitAddr);

  await (await vault.registerEngine(limitAddr)).wait();
  console.log("LimitEngine registered as authorized engine on vault");

  await (await limit.setOracle(oracleAddr)).wait();
  console.log("LimitEngine oracle set");

  await (await limit.setPerp(perpAddr)).wait();
  console.log("LimitEngine perp set");

  await (await limit.setCompliance(complianceAddr)).wait();
  console.log("LimitEngine compliance set");

  await (await perp.setExecutor(limitAddr, true)).wait();
  console.log("LimitEngine authorized as executor on PerpEngine");

  // ─── 7. DarkpoolEngine ─────────────────────────────────────────────
  const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
  const dark = await DarkFactory.deploy(vaultAddr, admin.address);
  await dark.waitForDeployment();
  const darkAddr = await dark.getAddress();
  console.log("DarkpoolEngine deployed:", darkAddr);

  await (await vault.registerEngine(darkAddr)).wait();
  console.log("DarkpoolEngine registered as authorized engine on vault");

  await (await dark.setOracle(oracleAddr)).wait();
  await (await dark.setPerp(perpAddr)).wait();
  await (await dark.setCompliance(complianceAddr)).wait();
  console.log("DarkpoolEngine oracle/perp/compliance set");

  await (await perp.setExecutor(darkAddr, true)).wait();
  console.log("DarkpoolEngine authorized as executor on PerpEngine");

  // ─── 8. Write deployment artifact ──────────────────────────────────
  fs.mkdirSync(deploymentDir, { recursive: true });
  const deployment = {
    network: "sepolia",
    chainId: 11155111,
    deployedAt: new Date().toISOString(),
    contracts: {
      // No MockERC7984 entry — using Zama's canonical cUSDCMock instead.
      cUSDCMock: SEPOLIA_CUSDC_MOCK,
      Compliance: complianceAddr,
      Oracle: oracleAddr,
      NoirVault: vaultAddr,
      PerpEngine: perpAddr,
      AMMEngine: ammAddr,
      LimitEngine: limitAddr,
      DarkpoolEngine: darkAddr,
    },
    relayers: [RELAYER_A, RELAYER_B, RELAYER_C],
    admin: admin.address,
    explorer: "https://sepolia.etherscan.io",
  };
  fs.writeFileSync(artifactPath, JSON.stringify(deployment, null, 2));
  console.log("Deployment artifacts written to deployments/sepolia.json");

  console.log("");
  console.log("=== Phase 9 Sepolia deploy complete ===");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Verify on Etherscan:");
  console.log(
    `     npx hardhat verify --network sepolia ${complianceAddr} ${admin.address} 0x0000000000000000000000000000000000000000000000000000000000000000`
  );
  console.log(
    `     npx hardhat verify --network sepolia ${oracleAddr} ${admin.address} '[${RELAYER_A},${RELAYER_B},${RELAYER_C}]' 90 50`
  );
  console.log(
    `     npx hardhat verify --network sepolia ${vaultAddr} ${admin.address} ${SEPOLIA_CUSDC_MOCK}`
  );
  console.log(
    `     npx hardhat verify --network sepolia ${perpAddr} ${vaultAddr} ${oracleAddr} ${complianceAddr} ${admin.address} ${admin.address}`
  );
  console.log(
    `     npx hardhat verify --network sepolia ${ammAddr} ${vaultAddr} ${admin.address}`
  );
  console.log(
    `     npx hardhat verify --network sepolia ${limitAddr} ${vaultAddr} ${admin.address}`
  );
  console.log(
    `     npx hardhat verify --network sepolia ${darkAddr} ${vaultAddr} ${admin.address}`
  );
  console.log(
    "  2. Run setup-sepolia.ts to seed cUSDCMock + commit oracle prices"
  );
  console.log("  3. Run sync-compliance-root.ts --network sepolia");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
