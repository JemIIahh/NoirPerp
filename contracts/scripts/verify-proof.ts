import * as hre from "hardhat";
import { readFileSync } from "node:fs";

async function main() {
  const dep = JSON.parse(readFileSync("deployments/local.json", "utf8"));
  const compliance = await hre.ethers.getContractAt("Compliance", dep.contracts.Compliance);
  const apiUrl = process.env.COMPLIANCE_API_URL ?? "http://127.0.0.1:4001";
  const addr = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const r = await fetch(`${apiUrl}/proof/${addr}`);
  const { proof } = await r.json();
  console.log("Proof from backend:", proof);
  const ok = await compliance.verify(addr, proof);
  console.log(`Compliance.verify(${addr}, proof) =`, ok);
}
main().catch((e) => { console.error(e); process.exit(1); });
