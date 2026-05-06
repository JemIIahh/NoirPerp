import * as hre from "hardhat";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";

/// Submit ONE pair-match order from admin to trigger live
/// `OrderSubmittedForPair`. Used to verify whether the bot's WS
/// subscription catches DarkpoolEngine events on a fresh process.
/// Orders submitted here can be cancelled via DarkpoolEngine.cancelOrder
/// to refund collateral.
///
/// Run: SIDE=long npx hardhat run scripts/poke-submit.ts --network sepolia
///      SIDE=short npx hardhat run scripts/poke-submit.ts --network sepolia

const SIZE = 1n;
const CPU = 200n;

async function main() {
  const dep = JSON.parse(readFileSync("deployments/sepolia.json", "utf8"));
  const isLong = (process.env.SIDE ?? "long").toLowerCase() === "long";
  const provider = hre.ethers.provider;
  const admin = new Wallet(process.env.PRIVATE_KEY!, provider);

  // Fetch compliance proof for admin
  const apiUrl = process.env.COMPLIANCE_API_URL ?? "http://127.0.0.1:4001";
  const res = await fetch(`${apiUrl}/proof/${admin.address}`);
  const body = (await res.json()) as { allowlisted: boolean; proof: string[] };
  if (!body.allowlisted) throw new Error(`admin not on allowlist`);
  const proof = body.proof;

  const oracle = await hre.ethers.getContractAt("Oracle", dep.contracts.Oracle, admin);
  const dark = await hre.ethers.getContractAt("DarkpoolEngine", dep.contracts.DarkpoolEngine, admin);

  const [oraclePrice]: [bigint, boolean] = await oracle.getPrice(2);
  const limit = isLong ? oraclePrice + 200n : oraclePrice - 200n;
  console.log(`oracle=${oraclePrice}  side=${isLong ? "long" : "short"}  limit=${limit}  size=${SIZE}  cpu=${CPU}`);

  // Encrypt 3 inputs in one bundle (same pattern as smoke + frontend)
  const sdkModule = await (Function('return import("@zama-fhe/relayer-sdk/node")')() as Promise<any>);
  const sdk = await sdkModule.createInstance({
    ...sdkModule.SepoliaConfig,
    network: process.env.SEPOLIA_RPC_URL!,
  });
  const inp = sdk.createEncryptedInput(dep.contracts.DarkpoolEngine, admin.address);
  inp.add64(SIZE);
  inp.add64(CPU);
  inp.add64(limit);
  const enc = await inp.encrypt();

  const tx = await (dark as any).submitOrderForPairMatch(
    {
      eSize: enc.handles[0], sizeProof: enc.inputProof,
      eCollateralPerUnit: enc.handles[1], collateralPerUnitProof: enc.inputProof,
      eLimitPrice: enc.handles[2], limitProof: enc.inputProof,
    },
    2, isLong, proof,
  );
  const r = await tx.wait();
  for (const log of r!.logs) {
    try {
      const p = dark.interface.parseLog({ topics: log.topics, data: log.data });
      if (p?.name === "OrderSubmittedForPair") {
        console.log(`✓ orderId=${p.args.orderId} block=${r!.blockNumber} tx=${r!.hash}`);
      }
    } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
