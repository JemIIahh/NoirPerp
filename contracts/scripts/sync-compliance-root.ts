import * as hre from "hardhat";
import { readFileSync } from "node:fs";

/// Pulls the current Merkle root from compliance-backend's /health
/// and updates the on-chain Compliance contract. Required for the
/// frontend Trade flow: openPosition's complianceProof check uses
/// the on-chain root, which must match the proof issued by the
/// backend.
async function main() {
  // Pick the deployment artifact for the network the script is run
  // against — hardhat sets `hre.network.name` from --network.
  const networkName = hre.network.name === "hardhat" ? "local" : hre.network.name;
  const depPath = `deployments/${networkName}.json`;
  const dep = JSON.parse(readFileSync(depPath, "utf8"));
  const [admin] = await hre.ethers.getSigners();
  console.log(`Reading deployment: ${depPath}`);

  const apiUrl = process.env.COMPLIANCE_API_URL ?? "http://127.0.0.1:4001";
  const res = await fetch(`${apiUrl}/health`);
  if (!res.ok) throw new Error(`compliance /health: ${res.status}`);
  const health = await res.json();
  const newRoot: string = health.root;
  console.log(`Backend root: ${newRoot} (entries: ${health.count})`);

  const compliance = await hre.ethers.getContractAt(
    "Compliance", dep.contracts.Compliance, admin,
  );
  const currentRoot = await compliance.merkleRoot();
  if (currentRoot.toLowerCase() === newRoot.toLowerCase()) {
    console.log("On-chain root already matches — no update needed.");
    return;
  }
  await (await compliance.updateRoot(newRoot)).wait();
  console.log(`On-chain root updated to ${newRoot}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
