// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title DecryptQueue
/// @notice Async-decrypt state machine for FHEVM engines. Every engine
///         that calls FHE.requestDecryption inherits this abstract
///         contract to track pending requests and guard against replay.
/// @dev Replay-guard pattern: always call _dequeue(reqId) BEFORE any
///      external call in the decrypt callback. Stale entries past
///      DECRYPT_TIMEOUT can be garbage-collected by anyone via
///      cleanupStale to prevent storage bloat.
abstract contract DecryptQueue {
    struct PendingDecrypt {
        address caller;
        uint256 contextId;
        bytes context;
        uint64 requestedAt;
    }

    uint64 public constant DECRYPT_TIMEOUT = 10 minutes;

    mapping(uint256 requestId => PendingDecrypt) private _pending;

    event DecryptEnqueued(
        uint256 indexed requestId,
        address indexed caller,
        uint256 contextId
    );
    event DecryptDequeued(uint256 indexed requestId);
    event DecryptCleaned(uint256 indexed requestId);

    error DecryptNotPending();
    error DecryptNotStale();

    /// @notice Records a pending decrypt request. Engine calls this right
    ///         before FHE.requestDecryption.
    function _enqueue(
        uint256 requestId,
        address caller,
        uint256 contextId,
        bytes memory context
    ) internal {
        _pending[requestId] = PendingDecrypt({
            caller: caller,
            contextId: contextId,
            context: context,
            requestedAt: uint64(block.timestamp)
        });
        emit DecryptEnqueued(requestId, caller, contextId);
    }

    /// @notice Returns and deletes the pending entry. MUST be called
    ///         BEFORE any external call in the callback (replay guard).
    /// @dev Reverts DecryptNotPending if requestId is not pending.
    function _dequeue(uint256 requestId)
        internal
        returns (PendingDecrypt memory info)
    {
        info = _pending[requestId];
        if (info.requestedAt == 0) revert DecryptNotPending();
        delete _pending[requestId];
        emit DecryptDequeued(requestId);
    }

    function _isPending(uint256 requestId) internal view returns (bool) {
        return _pending[requestId].requestedAt != 0;
    }

    /// @notice Read pending entry without removing (for debugging / UX).
    function pendingInfo(uint256 requestId)
        external
        view
        returns (PendingDecrypt memory)
    {
        return _pending[requestId];
    }

    /// @notice Anyone can call to sweep stale pending entries past timeout.
    ///         Reverts if any id is not pending or not yet stale.
    /// @dev Permissionless by design (storage-bloat GC). ACCEPTED GRIEFING:
    ///      after DECRYPT_TIMEOUT (10 min), anyone can cleanupStale a pending
    ///      entry before the Gateway callback arrives. If that happens, the
    ///      callback will revert with `DecryptNotPending` and the engine must
    ///      re-request the decrypt (costing another $0.001–$0.10 Gateway fee).
    ///      No funds are at risk — the griefing cost is per-decrypt bounded.
    ///      10 min timeout vs 15–60s typical Gateway latency gives ~10x
    ///      safety margin, so in practice callbacks arrive well before
    ///      cleanup is permitted.
    function cleanupStale(uint256[] calldata requestIds) external {
        uint256 len = requestIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 rid = requestIds[i];
            PendingDecrypt storage entry = _pending[rid];
            if (entry.requestedAt == 0) revert DecryptNotPending();
            if (block.timestamp < entry.requestedAt + DECRYPT_TIMEOUT) {
                revert DecryptNotStale();
            }
            delete _pending[rid];
            emit DecryptCleaned(rid);
        }
    }
}
