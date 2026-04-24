import { expect } from "chai";
import * as hre from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { Smoke } from "../typechain-types";

describe("Smoke (FHEVM toolchain)", () => {
  let smoke: Smoke;
  let owner: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  beforeEach(async () => {
    [owner] = await hre.ethers.getSigners();
    const SmokeFactory = await hre.ethers.getContractFactory("Smoke");
    smoke = (await SmokeFactory.deploy()) as unknown as Smoke;
    await smoke.waitForDeployment();
  });

  it("stores a trivially-encrypted value and lets owner decrypt it", async () => {
    const plain = 42n;

    const tx = await smoke.setValue(plain);
    await tx.wait();

    const handle = await smoke.getValue();
    expect(handle).to.not.equal(hre.ethers.ZeroHash);

    // Decrypt via FHEVM mock (hre.fhevm exposes userDecryptEuint)
    const decrypted = await hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      handle,
      await smoke.getAddress(),
      owner,
    );

    expect(decrypted).to.equal(plain);
  });
});
