import * as hre from "hardhat";

/// Phase 3 local deploy script.
/// Deploys:
///   1. MockERC7984 (USDCx mock for local testing)
///   2. Compliance (admin = signer[0], initial empty root)
///   3. Oracle    (admin = signer[0], relayers = signer[1..3])
///   4. NoirVault (admin = signer[0], usdcxToken = MockERC7984)
///   5. PerpEngine (admin = signer[0], registered on vault)
async function main() {
  const signers = await hre.ethers.getSigners();
  const [admin, relayerA, relayerB, relayerC] = signers;

  console.log("=== NoirPerp Phase 2 local deploy ===");
  console.log("Admin:   ", admin.address);
  console.log("Relayers:", relayerA.address, relayerB.address, relayerC.address);
  console.log("");

  // 1. MockERC7984
  const TokenFactory = await hre.ethers.getContractFactory("MockERC7984");
  const token = await TokenFactory.deploy("MockUSDCx", "mUSDCx");
  await token.waitForDeployment();
  console.log("MockERC7984 deployed:", await token.getAddress());

  // 2. Compliance (empty root — no users allowlisted by default)
  const ComplianceFactory = await hre.ethers.getContractFactory("Compliance");
  const compliance = await ComplianceFactory.deploy(admin.address, hre.ethers.ZeroHash);
  await compliance.waitForDeployment();
  console.log("Compliance deployed: ", await compliance.getAddress());

  // 3. Oracle
  const OracleFactory = await hre.ethers.getContractFactory("Oracle");
  const oracle = await OracleFactory.deploy(
    admin.address,
    [relayerA.address, relayerB.address, relayerC.address],
    90, // stalenessSeconds
    50, // deviationBps = 0.5%
  );
  await oracle.waitForDeployment();
  console.log("Oracle deployed:     ", await oracle.getAddress());

  // 4. NoirVault
  const VaultFactory = await hre.ethers.getContractFactory("NoirVault");
  const vault = await VaultFactory.deploy(admin.address, await token.getAddress());
  await vault.waitForDeployment();
  console.log("NoirVault deployed:  ", await vault.getAddress());

  // 5. PerpEngine (Phase 3)
  const PerpFactory = await hre.ethers.getContractFactory("PerpEngine");
  const perp = await PerpFactory.deploy(
    await vault.getAddress(),
    await oracle.getAddress(),
    await compliance.getAddress(),
    admin.address, // liquidationPool = admin for local
    admin.address,
  );
  await perp.waitForDeployment();
  console.log("PerpEngine deployed: ", await perp.getAddress());

  // Register PerpEngine as authorized on vault
  await (await vault.registerEngine(await perp.getAddress())).wait();
  console.log("PerpEngine registered as authorized engine on vault");

  console.log("");
  console.log("=== Phase 3 deploy complete ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
