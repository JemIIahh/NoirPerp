import * as hre from "hardhat";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";

/// Manually call submitMatchPair(buyId, sellId) from admin during a
/// fresh-oracle window. Used to bypass the bot's per-pair 10-block
/// back-off when a previous attempt happened to land in a stale gap.
/// Permissionless on the contract — no admin role required.
///
/// Run: BUY=0 SELL=1 npx hardhat run scripts/poke-match.ts --network sepolia

async function main() {
  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
  const buyId = BigInt(process.env.BUY ?? "0");
  const sellId = BigInt(process.env.SELL ?? "1");

  const provider = hre.ethers.provider;
  const admin = new Wallet(process.env.PRIVATE_KEY!, provider);
  const oracle = await hre.ethers.getContractAt("Oracle", dep.contracts.Oracle, admin);
  const dark = await hre.ethers.getContractAt("DarkpoolEngine", dep.contracts.DarkpoolEngine, admin);

  // Need a market — read from buy order
  const buy = await dark.getOrder(buyId);
  const marketId = Number(buy.marketId);

  // Poll for oracle freshness
  console.log(`waiting for fresh oracle on market ${marketId}…`);
  while (true) {
    const [price, fresh] = await oracle.getPrice(marketId);
    if (fresh) { console.log(`  fresh: price=${price}`); break; }
    process.stdout.write(`  not yet (price=${price})\r`);
    await new Promise(r => setTimeout(r, 4000));
  }

  console.log(`calling submitMatchPair(${buyId}, ${sellId})…`);
  // Skip the FHEVM plugin's estimateGas hook (it requires plugin init that
  // doesn't run on `--network sepolia`). 2M is well above expected ~600k.
  const tx = await (dark as any).submitMatchPair(buyId, sellId, { gasLimit: 2_000_000 });
  console.log(`  tx: ${tx.hash}`);
  const r = await tx.wait();
  const proposed = r!.logs.find((l: any) => {
    try {
      const p = dark.interface.parseLog({ topics: l.topics, data: l.data });
      return p?.name === "MatchProposed";
    } catch { return false; }
  });
  if (proposed) {
    const parsed = dark.interface.parseLog({ topics: (proposed as any).topics, data: (proposed as any).data })!;
    console.log(`✓ MatchProposed requestId=${parsed.args.requestId}`);
  } else {
    console.log(`tx confirmed but MatchProposed not found in logs — receipt: ${r!.hash}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
