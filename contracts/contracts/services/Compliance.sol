// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title Compliance
/// @notice Merkle-tree KYC allowlist for NoirPerp. Admin sets the root
///         (computed off-chain from the approved address list). Users
///         prove membership via standard OZ MerkleProof. On-chain
///         revocation overrides membership regardless of proof validity.
/// @dev Leaves are `keccak256(bytes.concat(keccak256(abi.encode(address))))`
///      per OZ StandardMerkleTree convention (JS library: openzeppelin/merkle-tree).
contract Compliance {
    bytes32 public merkleRoot;
    uint256 public rootUpdatedAt;
    mapping(address => bool) public revoked;
    address public admin;

    event RootUpdated(bytes32 indexed newRoot, uint256 timestamp);
    event Revoked(address indexed user);
    event Unrevoked(address indexed user);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    error NotAdmin();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address initialAdmin, bytes32 initialRoot) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        merkleRoot = initialRoot;
        rootUpdatedAt = block.timestamp;
        emit AdminTransferred(address(0), initialAdmin);
        emit RootUpdated(initialRoot, block.timestamp);
    }

    function updateRoot(bytes32 newRoot) external onlyAdmin {
        merkleRoot = newRoot;
        rootUpdatedAt = block.timestamp;
        emit RootUpdated(newRoot, block.timestamp);
    }

    /// @notice Verifies that `user` is allowlisted and not revoked.
    /// @dev Leaf format matches openzeppelin/merkle-tree's StandardMerkleTree
    ///      for single-column `["address"]`: double-hashed.
    function verify(address user, bytes32[] calldata proof) external view returns (bool) {
        if (revoked[user]) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(user))));
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    function revoke(address user) external onlyAdmin {
        revoked[user] = true;
        emit Revoked(user);
    }

    function unrevoke(address user) external onlyAdmin {
        revoked[user] = false;
        emit Unrevoked(user);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }
}
