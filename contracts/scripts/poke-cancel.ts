import * as hre from "hardhat";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";

/// Cancel a pair-eligible order from its owner. Owner refunds escrow.
/// Used to clean up dangling orders left over from a partial smoke test.
///
/// Run: PK=<key> ORDER=<id> npx hardhat run scripts/poke-cancel.ts --network sepolia

async function main() {
  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
  const orderId = BigInt(process.env.ORDER!);
  const provider = hre.ethers.provider;
  const owner = new Wallet(process.env.PK!, provider);
  const dark = await hre.ethers.getContractAt("DarkpoolEngine", dep.contracts.DarkpoolEngine, owner);

  const o = await dark.getOrder(orderId);
  if (!o.active) { console.log(`order ${orderId} already inactive — nothing to do`); return; }
  if (o.owner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(`order ${orderId} owner=${o.owner}, but PK resolves to ${owner.address}`);
  }
  // FHEVM plugin estimateGas hook would error on `--network sepolia`; skip with explicit gasLimit.
  const tx = await (dark as any).cancelOrder(orderId, { gasLimit: 1_500_000 });
  const r = await tx.wait();
  console.log(`✓ cancelled order ${orderId}  tx=${r!.hash}  status=${r!.status}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
