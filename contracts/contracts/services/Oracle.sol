// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Oracle
/// @notice 2-of-3 Chainlink-relayer price consensus. First submission
///         stores as pending; second submission from a DIFFERENT relayer
///         within deviation tolerance + staleness window commits the
///         price.
/// @dev Market IDs: 1 = BTC, 2 = ETH, 3 = SOL.
contract Oracle is ZamaEthereumConfig {
    struct PriceData {
        uint64 price;
        uint64 timestamp;
        uint8 confirmations;
        uint64 pendingPrice;
        uint64 pendingTimestamp;
        address pendingRelayer;
    }

    uint64 private constant BPS_DIVISOR = 10_000;

    mapping(uint8 marketId => PriceData) public prices;
    address[3] public relayers;
    uint256 public stalenessSeconds;
    uint256 public deviationBps;
    address public admin;

    /// @dev For test harness path only. Stores the last-produced
    ///      encrypted price handle with caller ACL grant.
    euint64 public lastEncryptedPrice;

    event PriceSubmitted(uint8 indexed marketId, address indexed relayer, uint64 price);
    event PriceCommitted(uint8 indexed marketId, uint64 price, uint64 timestamp);
    event RelayerRotated(uint8 indexed index, address oldRelayer, address newRelayer);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    error NotRelayer();
    error NotAdmin();
    error ZeroAddress();
    error DeviationTooLarge();
    error PendingStale();
    error PriceNotFresh();
    error BadIndex();

    modifier onlyRelayer() {
        if (
            msg.sender != relayers[0] &&
            msg.sender != relayers[1] &&
            msg.sender != relayers[2]
        ) revert NotRelayer();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        address initialAdmin,
        address[3] memory initialRelayers,
        uint256 staleness_,
        uint256 deviation_
    ) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        relayers = initialRelayers;
        stalenessSeconds = staleness_;
        deviationBps = deviation_;
        emit AdminTransferred(address(0), initialAdmin);
    }

    function submitPrice(uint8 marketId, uint64 price, uint64 timestamp)
        external
        onlyRelayer
    {
        PriceData storage p = prices[marketId];

        // Same relayer or no pending → (re)start pending cycle.
        if (p.pendingRelayer == address(0) || p.pendingRelayer == msg.sender) {
            p.pendingPrice = price;
            p.pendingTimestamp = timestamp;
            p.pendingRelayer = msg.sender;
            emit PriceSubmitted(marketId, msg.sender, price);
            return;
        }

        // Different relayer: attempt to commit.
        // Check staleness of pending.
        if (block.timestamp > p.pendingTimestamp + stalenessSeconds) {
            // Stale pending — reject; operator can restart by resubmitting.
            revert PendingStale();
        }

        // Check deviation: |price - pendingPrice| / pendingPrice <= deviationBps / BPS_DIVISOR.
        // Reformulated as multiplication to avoid division inaccuracy:
        //   abs(price - pendingPrice) * BPS_DIVISOR <= pendingPrice * deviationBps
        uint64 pp = p.pendingPrice;
        uint64 diff = price > pp ? price - pp : pp - price;
        if (uint256(diff) * BPS_DIVISOR > uint256(pp) * deviationBps) {
            revert DeviationTooLarge();
        }

        // Commit.
        p.price = price;
        p.timestamp = timestamp;
        p.confirmations = 2;
        // Clear pending.
        p.pendingPrice = 0;
        p.pendingTimestamp = 0;
        p.pendingRelayer = address(0);

        emit PriceSubmitted(marketId, msg.sender, price);
        emit PriceCommitted(marketId, price, timestamp);
    }

    function getPrice(uint8 marketId) public view returns (uint64 price, bool fresh) {
        PriceData memory p = prices[marketId];
        price = p.price;
        fresh = p.confirmations >= 2 && block.timestamp <= p.timestamp + stalenessSeconds;
    }

    /// @notice Trivial-encrypts the current fresh price for FHE downstream use.
    ///         Engines call this inline within their ops. Caller receives ACL
    ///         via FHE.allowThis on the returned handle.
    function getEncryptedPrice(uint8 marketId) external returns (euint64) {
        (uint64 price, bool fresh) = getPrice(marketId);
        if (!fresh) revert PriceNotFresh();
        euint64 encrypted = FHE.asEuint64(price);
        FHE.allowThis(encrypted);
        FHE.allowTransient(encrypted, msg.sender);
        return encrypted;
    }

    /// @notice Test-only helper: produces an encrypted price handle with
    ///         persistent ACL grant to the caller for decryption in tests.
    function requestEncryptedPrice(uint8 marketId) external {
        (uint64 price, bool fresh) = getPrice(marketId);
        if (!fresh) revert PriceNotFresh();
        euint64 encrypted = FHE.asEuint64(price);
        lastEncryptedPrice = encrypted;
        FHE.allowThis(encrypted);
        FHE.allow(encrypted, msg.sender);
    }

    function rotateRelayer(uint8 index, address newRelayer) external onlyAdmin {
        if (index >= 3) revert BadIndex();
        if (newRelayer == address(0)) revert ZeroAddress();
        address old = relayers[index];
        relayers[index] = newRelayer;
        emit RelayerRotated(index, old, newRelayer);
    }

    function setStalenessSeconds(uint256 s) external onlyAdmin {
        stalenessSeconds = s;
    }

    function setDeviationBps(uint256 d) external onlyAdmin {
        deviationBps = d;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }
}
