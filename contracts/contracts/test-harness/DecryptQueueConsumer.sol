// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { DecryptQueue } from "../lib/DecryptQueue.sol";

/// @title DecryptQueueConsumer
/// @notice Test-only concrete inheritor of DecryptQueue. Exposes internal
///         _enqueue / _dequeue / _isPending as external + records the
///         last dequeued payload so tests can assert on it.
contract DecryptQueueConsumer is DecryptQueue {
    PendingDecrypt public lastDequeued;

    function enqueue(
        uint256 requestId,
        address caller,
        uint256 contextId,
        bytes memory context
    ) external {
        _enqueue(requestId, caller, contextId, context);
    }

    function dequeueAndRecord(uint256 requestId) external {
        PendingDecrypt memory info = _dequeue(requestId);
        lastDequeued = info;
    }

    function isPending(uint256 requestId) external view returns (bool) {
        return _isPending(requestId);
    }
}
