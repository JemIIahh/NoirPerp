// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title MockERC7984
/// @notice Minimal ERC-7984 token for local Hardhat tests of NoirVault.
///         On Sepolia, use the pre-deployed cUSDCMock instead.
/// @dev `mint` and `mintPlaintext` are open to any caller — test-only.
///      NOT production-safe.
///
/// OZ API note (verified against openzeppelin/confidential-contracts v0.4.0):
///   Constructor: ERC7984(string name_, string symbol_, string contractURI_)
///   Internal mint: _mint(address to, euint64 amount) internal returns (euint64)
///   No abstract methods require implementation; ERC7984 is a concrete base
///   (inherits ERC165 only).
contract MockERC7984 is ERC7984, ZamaEthereumConfig {
    constructor(string memory name_, string memory symbol_)
        ERC7984(name_, symbol_, "")
    {}

    /// @notice Seeds the recipient with an encrypted amount of tokens.
    /// @dev Open to any caller; test-only.
    /// @param to       Recipient address.
    /// @param encryptedAmount  External encrypted handle (from FHE.js client-side encryption).
    /// @param inputProof       ZK proof accompanying the encrypted handle.
    /// @return The internal euint64 ciphertext representing the minted amount.
    function mint(
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        return _mint(to, amount);
    }

    /// @notice Alternate mint using a plaintext amount (trivial encrypt).
    /// @dev Useful when tests don't need to exercise the proof path.
    /// @param to     Recipient address.
    /// @param amount Plaintext token amount (trivially encrypted via FHE.asEuint64).
    /// @return The internal euint64 ciphertext representing the minted amount.
    function mintPlaintext(address to, uint64 amount) external returns (euint64) {
        euint64 encrypted = FHE.asEuint64(amount);
        return _mint(to, encrypted);
    }
}
