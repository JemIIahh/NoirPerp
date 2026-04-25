import * as hre from "hardhat";

/// Phase 6 local deploy script.
/// Deploys:
///   1. MockERC7984 (USDCx mock for local testing)
///   2. Compliance (admin = signer[0], initial empty root)
///   3. Oracle    (admin = signer[0], relayers = signer[1..3])
///   4. NoirVault (admin = signer[0], usdcxToken = MockERC7984)
///   5. PerpEngine (admin = signer[0], registered on vault)
///   6. AMMEngine (admin = signer[0], registered on vault, oracle wired,
///                 liquidationPool repointed from PerpEngine)
///   7. LimitEngine (admin = signer[0], registered on vault, oracle/perp/compliance wired)
///   8. DarkpoolEngine (admin = signer[0], registered on vault, oracle/perp/compliance wired,
///                      authorized as executor on PerpEngine)
async function main() {
  const signers = await hre.ethers.getSigners();
  const [admin, relayerA, relayerB, relayerC] = signers;

  console.log("=== NoirPerp Phase 3 local deploy ===");
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

  // 6. AMMEngine (Phase 4)
  const AMMFactory = await hre.ethers.getContractFactory("AMMEngine");
  const amm = await AMMFactory.deploy(await vault.getAddress(), admin.address);
  await amm.waitForDeployment();
  console.log("AMMEngine deployed:  ", await amm.getAddress());
  await (await vault.registerEngine(await amm.getAddress())).wait();
  console.log("AMMEngine registered as authorized engine on vault");

  await (await amm.setOracle(await oracle.getAddress())).wait();
  console.log("AMMEngine oracle set");

  await (await perp.setLiquidationPool(await amm.getAddress())).wait();
  console.log("PerpEngine liquidationPool repointed to AMMEngine");

  // 7. LimitEngine (Phase 5)
  const LimitFactory = await hre.ethers.getContractFactory("LimitEngine");
  const limit = await LimitFactory.deploy(await vault.getAddress(), admin.address);
  await limit.waitForDeployment();
  console.log("LimitEngine deployed:", await limit.getAddress());

  await (await vault.registerEngine(await limit.getAddress())).wait();
  console.log("LimitEngine registered as authorized engine on vault");

  await (await limit.setOracle(await oracle.getAddress())).wait();
  console.log("LimitEngine oracle set");

  await (await limit.setPerp(await perp.getAddress())).wait();
  console.log("LimitEngine perp set");

  await (await limit.setCompliance(await compliance.getAddress())).wait();
  console.log("LimitEngine compliance set");

  await (await perp.setExecutor(await limit.getAddress(), true)).wait();
  console.log("LimitEngine authorized as executor on PerpEngine");

  // 8. DarkpoolEngine (Phase 6)
  const DarkFactory = await hre.ethers.getContractFactory("DarkpoolEngine");
  const dark = await DarkFactory.deploy(await vault.getAddress(), admin.address);
  await dark.waitForDeployment();
  console.log("DarkpoolEngine deployed:", await dark.getAddress());

  await (await vault.registerEngine(await dark.getAddress())).wait();
  console.log("DarkpoolEngine registered as authorized engine on vault");

  await (await dark.setOracle(await oracle.getAddress())).wait();
  await (await dark.setPerp(await perp.getAddress())).wait();
  await (await dark.setCompliance(await compliance.getAddress())).wait();
  console.log("DarkpoolEngine oracle/perp/compliance set");

  await (await perp.setExecutor(await dark.getAddress(), true)).wait();
  console.log("DarkpoolEngine authorized as executor on PerpEngine");

  console.log("");
  console.log("=== Phase 6 deploy complete ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
