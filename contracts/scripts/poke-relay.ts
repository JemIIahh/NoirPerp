import * as hre from "hardhat";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";

/// One-shot decrypt-relay for an outstanding MatchProposed. Bypasses the
/// bot's WS subscription (which is unreliable on publicnode WSS — see
/// CHANGELOG entry to be added). Picks the most recent MatchProposed for
/// (BUY, SELL) within the last 200 blocks, runs KMS publicDecrypt, then
/// calls _onMatchDecided. Equivalent in effect to what the bot's
/// decrypt-relay watcher does.
///
/// Run: BUY=0 SELL=1 npx hardhat run scripts/poke-relay.ts --network sepolia

async function main() {
  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
  const buyId = BigInt(process.env.BUY ?? "0");
  const sellId = BigInt(process.env.SELL ?? "1");

  const provider = hre.ethers.provider;
  const admin = new Wallet(process.env.PRIVATE_KEY!, provider);
  const dark = await hre.ethers.getContractAt("DarkpoolEngine", dep.contracts.DarkpoolEngine, admin);

  const head = await provider.getBlockNumber();
  const proposed = await dark.queryFilter(
    dark.filters.MatchProposed(undefined, buyId, sellId), head - 500, head,
  );
  if (proposed.length === 0) {
    console.error(`no MatchProposed for buy=${buyId} sell=${sellId} in last 500 blocks`);
    process.exit(1);
  }
  // Use the OLDEST pending — that one was queued first; if it succeeds, the
  // orders go inactive and any later proposed-but-unsettled requests will
  // emit MatchAborted ("cancelled during decrypt" or similar) on subsequent
  // relays. That's the bot's safety-guard behavior — no harm.
  const ev = proposed[0] as any;
  const requestId: bigint = ev.args.requestId;
  const handles: string[] = [...ev.args.handles];
  console.log(`MatchProposed found:`);
  console.log(`  requestId : ${requestId}`);
  console.log(`  handles   : ${handles.length} (${handles.map(h => h.slice(0, 10)).join(", ")})`);
  console.log(`  block     : ${ev.blockNumber}`);

  // KMS publicDecrypt via relayer-SDK Node
  console.log(`\ncalling KMS publicDecrypt…`);
  const sdkModule = await (Function('return import("@zama-fhe/relayer-sdk/node")')() as Promise<any>);
  const sdkInstance = await sdkModule.createInstance({
    ...sdkModule.SepoliaConfig,
    network: process.env.SEPOLIA_RPC_URL!,
  });
  const result: any = await sdkInstance.publicDecrypt(handles);
  // SDK output shape varies between versions; handle both.
  const abiEncodedClearValues: string = result.abiEncodedClearValues ?? result.cleartexts;
  const decryptionProof: string = result.decryptionProof ?? result.proof;
  if (!abiEncodedClearValues || !decryptionProof) {
    console.error("publicDecrypt returned unexpected shape:", Object.keys(result));
    process.exit(1);
  }
  console.log(`  cleartexts: ${abiEncodedClearValues.slice(0, 20)}…`);
  console.log(`  proof     : ${decryptionProof.slice(0, 20)}… (${decryptionProof.length / 2 - 1} bytes)`);

  console.log(`\ncalling _onMatchDecided(${requestId})…`);
  const tx = await (dark as any)._onMatchDecided(
    requestId, handles, abiEncodedClearValues, decryptionProof,
    { gasLimit: 5_000_000 },
  );
  console.log(`  tx: ${tx.hash}`);
  const r = await tx.wait();
  console.log(`  status: ${r!.status}  block: ${r!.blockNumber}  gasUsed: ${r!.gasUsed}`);

  // Parse what happened
  for (const log of r!.logs) {
    try {
      const p = dark.interface.parseLog({ topics: log.topics, data: log.data });
      if (p) console.log(`  → ${p.name}(${p.args.map((a: any) => String(a).slice(0, 24)).join(", ")})`);
    } catch { /* not a dark event */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
