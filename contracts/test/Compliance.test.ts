import { expect } from "chai";
import * as hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Compliance } from "../typechain-types";

describe("Compliance", () => {
  let compliance: Compliance;
  let admin: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let alice: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let bob: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];
  let carol: Awaited<ReturnType<typeof hre.ethers.getSigners>>[number];

  // Build a Merkle tree over [alice, bob] addresses
  function buildTree(addrs: string[]) {
    const values = addrs.map((a) => [a]);
    return StandardMerkleTree.of(values, ["address"]);
  }

  beforeEach(async () => {
    [admin, alice, bob, carol] = await hre.ethers.getSigners();
    const tree = buildTree([alice.address, bob.address]);
    const Factory = await hre.ethers.getContractFactory("Compliance");
    compliance = (await Factory.deploy(admin.address, tree.root)) as unknown as Compliance;
    await compliance.waitForDeployment();
  });

  describe("constructor", () => {
    it("sets initial admin and root", async () => {
      expect(await compliance.admin()).to.equal(admin.address);
      expect(await compliance.merkleRoot()).to.not.equal(hre.ethers.ZeroHash);
      expect(await compliance.rootUpdatedAt()).to.be.gt(0);
    });

    it("reverts on zero admin", async () => {
      const Factory = await hre.ethers.getContractFactory("Compliance");
      await expect(
        Factory.deploy(hre.ethers.ZeroAddress, hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError({ interface: Factory.interface } as any, "ZeroAddress");
    });
  });

  describe("verify", () => {
    it("returns true for a listed user with a valid proof", async () => {
      const tree = buildTree([alice.address, bob.address]);
      const proof = tree.getProof([alice.address]);
      expect(await compliance.verify(alice.address, proof)).to.equal(true);
    });

    it("returns false for a user not in the tree", async () => {
      const tree = buildTree([alice.address, bob.address]);
      // Carol is not in the tree — her proof for alice wouldn't verify anyway
      const wrongProof = tree.getProof([alice.address]);
      expect(await compliance.verify(carol.address, wrongProof)).to.equal(false);
    });

    it("returns false when proof is invalid (empty)", async () => {
      expect(await compliance.verify(alice.address, [])).to.equal(false);
    });

    it("returns false for a revoked user even with a valid proof", async () => {
      const tree = buildTree([alice.address, bob.address]);
      const proof = tree.getProof([alice.address]);
      await (await compliance.revoke(alice.address)).wait();
      expect(await compliance.verify(alice.address, proof)).to.equal(false);
    });
  });

  describe("updateRoot", () => {
    it("admin can update the root", async () => {
      const tree = buildTree([alice.address, bob.address, carol.address]);
      const newRoot = tree.root;
      await expect(compliance.updateRoot(newRoot))
        .to.emit(compliance, "RootUpdated")
        .withArgs(newRoot, await hre.ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));
      expect(await compliance.merkleRoot()).to.equal(newRoot);
    });

    it("non-admin cannot update the root", async () => {
      await expect(
        compliance.connect(alice).updateRoot(hre.ethers.ZeroHash)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });

    it("new root unlocks new users", async () => {
      const tree2 = buildTree([alice.address, bob.address, carol.address]);
      await (await compliance.updateRoot(tree2.root)).wait();
      const carolProof = tree2.getProof([carol.address]);
      expect(await compliance.verify(carol.address, carolProof)).to.equal(true);
    });
  });

  describe("revoke / unrevoke", () => {
    it("admin can revoke a user", async () => {
      await expect(compliance.revoke(alice.address))
        .to.emit(compliance, "Revoked")
        .withArgs(alice.address);
      expect(await compliance.revoked(alice.address)).to.equal(true);
    });

    it("admin can unrevoke a user", async () => {
      await (await compliance.revoke(alice.address)).wait();
      await expect(compliance.unrevoke(alice.address))
        .to.emit(compliance, "Unrevoked")
        .withArgs(alice.address);
      expect(await compliance.revoked(alice.address)).to.equal(false);
    });

    it("non-admin cannot revoke", async () => {
      await expect(
        compliance.connect(bob).revoke(alice.address)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });

    it("non-admin cannot unrevoke", async () => {
      await (await compliance.revoke(alice.address)).wait();
      await expect(
        compliance.connect(bob).unrevoke(alice.address)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });
  });

  describe("transferAdmin", () => {
    it("admin can transfer to a new admin", async () => {
      await expect(compliance.transferAdmin(bob.address))
        .to.emit(compliance, "AdminTransferred")
        .withArgs(admin.address, bob.address);
      expect(await compliance.admin()).to.equal(bob.address);
    });

    it("non-admin cannot transfer", async () => {
      await expect(
        compliance.connect(alice).transferAdmin(alice.address)
      ).to.be.revertedWithCustomError(compliance, "NotAdmin");
    });

    it("reverts on zero address", async () => {
      await expect(
        compliance.transferAdmin(hre.ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(compliance, "ZeroAddress");
    });
  });
});
