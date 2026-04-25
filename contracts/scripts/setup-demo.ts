import * as hre from "hardhat";
import { readFileSync } from "node:fs";

/// One-shot demo bootstrap: mints USDCx to admin, sets vault operator,
/// commits oracle prices for all 3 markets via 2-of-3 quorum.
/// Run AFTER deploy-local.ts. Idempotent across multiple runs.
async function main() {
  const dep = JSON.parse(readFileSync("deployments/local.json", "utf8"));
  const [admin, relayerA, relayerB] = await hre.ethers.getSigners();

  const token = await hre.ethers.getContractAt("MockERC7984", dep.contracts.MockERC7984, admin);
  await (await token.mintPlaintext(admin.address, 1_000_000n)).wait();
  console.log("Minted 1,000,000 USDCx to admin");

  await (await token.setOperator(dep.contracts.NoirVault, 2n ** 48n - 1n)).wait();
  console.log("Set vault as operator on token for admin");

  const oracle = await hre.ethers.getContractAt("Oracle", dep.contracts.Oracle, relayerA);
  const block = await hre.ethers.provider.getBlock("latest");
  const t = block!.timestamp;

  for (const [m, p, dt] of [[1, 60000n, 0], [2, 3000n, 2], [3, 150n, 4]] as const) {
    await (await oracle.connect(relayerA).submitPrice(m, p, t + dt)).wait();
    await (await oracle.connect(relayerB).submitPrice(m, p, t + dt + 1)).wait();
  }
  console.log("Committed prices: BTC=60000, ETH=3000, SOL=150");

  console.log("\nDemo ready.");
}
main().catch((e) => { console.error(e); process.exit(1); });
