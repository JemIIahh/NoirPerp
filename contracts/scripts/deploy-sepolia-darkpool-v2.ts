import * as hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Phase 11 surgical Sepolia upgrade — DarkpoolEngine v2 only.
///
/// Phase 11 changed the DarkpoolEngine surface (added submitOrderForPairMatch
/// + submitMatchPair + _onMatchDecided + 6 new events + 6 new errors). All
/// other contracts (Vault, Perp, AMM, Limit, Oracle, Compliance) are
/// unchanged. So this script:
///
///   1. Reads existing deployments/sepolia.json
///   2. Deploys a new DarkpoolEngine pointing at the existing Vault
///   3. As admin, wires it: setOracle, setPerp, setCompliance,
///      vault.registerEngine, perp.setExecutor
///   4. Rewrites deployments/sepolia.json with the new DarkpoolEngine
///      address, archiving the old one under `previousDarkpoolEngine`
///      for traceability
///
/// The OLD DarkpoolEngine stays on-chain — anyone with active orders on
/// it can still cancel via the contract directly. The vault still has
/// it registered as an authorized engine; we deliberately do NOT
/// deregister it so existing collateral refunds keep working. New
/// orders flow through the new engine since the frontend will pick up
/// the updated address from the JSON.
///
/// Run with:
///   npx hardhat run scripts/deploy-sepolia-darkpool-v2.ts --network sepolia
///
/// Preconditions:
///   - PRIVATE_KEY in contracts/.env corresponds to the admin in
///     sepolia.json (same wallet that did the original Phase 9 deploy).
///   - Admin wallet has ~0.02 Sepolia ETH (1 deploy + 5 admin txs).
///   - Phase 11 contracts compiled clean (`npx hardhat compile`).
///
/// After this script:
///   - Etherscan-verify the new DarkpoolEngine via:
///       npx hardhat verify --network sepolia <newAddress> <vaultAddress> <adminAddress>
///   - git add deployments/sepolia.json && commit
///   - Reload the frontend — P2P submit now works end-to-end on Sepolia

async function main() {
  const deploymentDir = path.resolve(__dirname, "..", "deployments");
  const artifactPath = path.join(deploymentDir, "sepolia.json");
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`deployments/sepolia.json not found — run deploy-sepolia.ts first.`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const [signer] = await hre.ethers.getSigners();
  if (signer.address.toLowerCase() !== artifact.admin.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY signer (${signer.address}) is not the admin in sepolia.json (${artifact.admin}). ` +
      `Refusing — admin txs would revert with NotAdmin.`,
    );
  }

  const oldDarkAddr = artifact.contracts.DarkpoolEngine as string;
  const vaultAddr   = artifact.contracts.NoirVault     as string;
  const oracleAddr  = artifact.contracts.Oracle        as string;
  const perpAddr    = artifact.contracts.PerpEngine    as string;
  const compAddr    = artifact.contracts.Compliance    as string;

  console.log("=== Phase 11 surgical DarkpoolEngine upgrade ===");
  console.log("Admin / signer:        ", signer.address);
  console.log("Vault (existing):      ", vaultAddr);
  console.log("Oracle (existing):     ", oracleAddr);
  console.log("Perp (existing):       ", perpAddr);
  console.log("Compliance (existing): ", compAddr);
  console.log("OLD DarkpoolEngine:    ", oldDarkAddr);
  console.log("");

  // 1) Deploy new DarkpoolEngine.
  const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
  const dark = await DarkFactory.deploy(vaultAddr, signer.address);
  await dark.waitForDeployment();
  const newDarkAddr = await dark.getAddress();
  console.log("NEW DarkpoolEngine:    ", newDarkAddr);

  // 2) Wire it up as admin.
  console.log("Wiring setOracle…");
  await (await dark.setOracle(oracleAddr)).wait();
  console.log("Wiring setPerp…");
  await (await dark.setPerp(perpAddr)).wait();
  console.log("Wiring setCompliance…");
  await (await dark.setCompliance(compAddr)).wait();

  console.log("Registering new engine on the vault…");
  const Vault = await hre.ethers.getContractAt("NoirVault", vaultAddr);
  await (await Vault.registerEngine(newDarkAddr)).wait();

  console.log("Authorizing new engine as Perp executor…");
  const Perp = await hre.ethers.getContractAt("PerpEngine", perpAddr);
  await (await Perp.setExecutor(newDarkAddr, true)).wait();

  // 3) Rewrite deployments/sepolia.json. Old DarkpoolEngine archived under
  //    `previousDarkpoolEngine` so it's still grep-able + auditable.
  artifact.contracts.DarkpoolEngine = newDarkAddr;
  artifact.previousDarkpoolEngine = oldDarkAddr;
  artifact.darkpoolV2DeployedAt = new Date().toISOString();
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
  console.log("");
  console.log("=== Deploy + wiring complete ===");
  console.log("deployments/sepolia.json updated.");
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Verify on Etherscan:`);
  console.log(`     npx hardhat verify --network sepolia ${newDarkAddr} ${vaultAddr} ${signer.address}`);
  console.log("  2. git add deployments/sepolia.json && git commit -m 'feat(phase-11): redeploy DarkpoolEngine on Sepolia'");
  console.log("  3. Hard-reload http://127.0.0.1:5173/darkpool — P2P submit now works end-to-end.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
