import type { Contract } from "ethers";
import type { Logger } from "pino";

export type PublicDecryptFn = (handles: string[]) => Promise<{ abiEncodedClearValues: string; decryptionProof: string }>;

type SingleDecryptArgs = {
  engine: Contract;
  callbackName: string;
  requestId: bigint;
  handle: string;
  publicDecrypt: PublicDecryptFn;
  logger: Logger;
};

type BatchDecryptArgs = {
  engine: Contract;
  requestId: bigint;
  handles: string[];
  publicDecrypt: PublicDecryptFn;
  logger: Logger;
};

/**
 * Single-handle decrypt path: liquidation, trigger, withdraw all use it.
 * Engine callback signature is `(requestId, bytes32[] handles, bytes cleartexts, bytes proof)`.
 * For single-handle we wrap the handle in a 1-element array.
 */
export async function handleSingleDecrypt(args: SingleDecryptArgs): Promise<void> {
  const { engine, callbackName, requestId, handle, publicDecrypt, logger } = args;
  try {
    const { abiEncodedClearValues, decryptionProof } = await publicDecrypt([handle]);
    const tx = await (engine as any)[callbackName](requestId, [handle], abiEncodedClearValues, decryptionProof);
    await tx.wait();
    logger.info({ requestId: requestId.toString(), callbackName }, "decrypt-relay completed");
  } catch (err) {
    logger.error({ requestId: requestId.toString(), callbackName, err: (err as Error).message }, "decrypt-relay failed");
    // Rethrow so unit tests can assert on failure;
    // subscribeDecryptRelay swallows with `.catch(() => {})` to keep
    // the subscriber alive across single-decrypt failures.
    throw err;
  }
}

/**
 * Batch decrypt path: DarkpoolEngine BatchMatchRequested with N handles.
 */
export async function handleBatchDecrypt(args: BatchDecryptArgs): Promise<void> {
  const { engine, requestId, handles, publicDecrypt, logger } = args;
  try {
    const { abiEncodedClearValues, decryptionProof } = await publicDecrypt(handles);
    const tx = await (engine as any)._onBatchDecided(requestId, handles, abiEncodedClearValues, decryptionProof);
    await tx.wait();
    logger.info({ requestId: requestId.toString(), n: handles.length }, "batch decrypt-relay completed");
  } catch (err) {
    logger.error({ requestId: requestId.toString(), err: (err as Error).message }, "batch decrypt-relay failed");
    // Rethrow so unit tests can assert on failure;
    // subscribeDecryptRelay swallows with `.catch(() => {})` to keep
    // the subscriber alive across single-decrypt failures.
    throw err;
  }
}

/**
 * Phase 11 — pair-match decrypt path: DarkpoolEngine MatchProposed with 3
 * handles ([intersects, buyResidualZero, sellResidualZero]). Same shape as
 * handleBatchDecrypt but routes to `_onMatchDecided` instead of
 * `_onBatchDecided`.
 */
export async function handleMatchDecrypt(args: BatchDecryptArgs): Promise<void> {
  const { engine, requestId, handles, publicDecrypt, logger } = args;
  try {
    const { abiEncodedClearValues, decryptionProof } = await publicDecrypt(handles);
    const tx = await (engine as any)._onMatchDecided(requestId, handles, abiEncodedClearValues, decryptionProof);
    await tx.wait();
    logger.info({ requestId: requestId.toString(), n: handles.length }, "match decrypt-relay completed");
  } catch (err) {
    logger.error({ requestId: requestId.toString(), err: (err as Error).message }, "match decrypt-relay failed");
    throw err;
  }
}

/**
 * Wires all four engines' decrypt-request events to the appropriate handler.
 * Returns an unsubscribe function.
 *
 * Event signatures (verified against contracts/contracts/engines/*.sol):
 *   PerpEngine.LiquidationRequested(requestId, positionId, keeper, underwaterHandle)  — 4 args
 *   LimitEngine.TriggerRequested(requestId, orderId, keeper, shouldTriggerHandle)     — 4 args
 *   AMMEngine.WithdrawRequested(requestId, user, claimedShares, matchHandle)          — 4 args
 *   DarkpoolEngine.BatchMatchRequested(requestId, keeper, orderIds, handles)          — 4 args
 *   DarkpoolEngine.MatchProposed(requestId, buyId, sellId, requester, handles)        — 5 args (Phase 11)
 */
export function subscribeDecryptRelay(
  perpRO: Contract, perpRW: Contract,
  limitRO: Contract, limitRW: Contract,
  ammRO: Contract, ammRW: Contract,
  darkRO: Contract, darkRW: Contract,
  publicDecrypt: PublicDecryptFn,
  logger: Logger,
): () => void {
  // CORRECTED: 4-arg event — (requestId, positionId, keeper, underwaterHandle)
  const onLiq = async (
    requestId: bigint,
    _positionId: bigint,
    _keeper: string,
    underwaterHandle: string,
  ) => {
    await handleSingleDecrypt({
      engine: perpRW,
      callbackName: "_onLiquidationDecided",
      requestId,
      handle: underwaterHandle,
      publicDecrypt,
      logger,
    }).catch(() => {});
  };

  // CORRECTED: 4-arg event — (requestId, orderId, keeper, shouldTriggerHandle)
  const onTrig = async (
    requestId: bigint,
    _orderId: bigint,
    _keeper: string,
    shouldTriggerHandle: string,
  ) => {
    await handleSingleDecrypt({
      engine: limitRW,
      callbackName: "_onTriggerDecided",
      requestId,
      handle: shouldTriggerHandle,
      publicDecrypt,
      logger,
    }).catch(() => {});
  };

  // CORRECTED: 4-arg event — (requestId, user, claimedShares, matchHandle)
  const onWithdraw = async (
    requestId: bigint,
    _user: string,
    _claimedShares: bigint,
    matchHandle: string,
  ) => {
    await handleSingleDecrypt({
      engine: ammRW,
      callbackName: "_onWithdrawDecided",
      requestId,
      handle: matchHandle,
      publicDecrypt,
      logger,
    }).catch(() => {});
  };

  // Unchanged — matches plan: (requestId, keeper, orderIds, handles)
  const onBatch = async (requestId: bigint, _keeper: string, _orderIds: bigint[], handles: string[]) => {
    await handleBatchDecrypt({
      engine: darkRW,
      requestId,
      handles: [...handles],
      publicDecrypt,
      logger,
    }).catch(() => {});
  };

  // Phase 11 — pair-match decrypt: (requestId, buyId, sellId, requester, handles)
  const onMatch = async (
    requestId: bigint,
    _buyId: bigint,
    _sellId: bigint,
    _requester: string,
    handles: string[],
  ) => {
    await handleMatchDecrypt({
      engine: darkRW,
      requestId,
      handles: [...handles],
      publicDecrypt,
      logger,
    }).catch(() => {});
  };

  perpRO.on("LiquidationRequested", onLiq);
  limitRO.on("TriggerRequested", onTrig);
  ammRO.on("WithdrawRequested", onWithdraw);
  darkRO.on("BatchMatchRequested", onBatch);
  darkRO.on("MatchProposed", onMatch);

  return () => {
    perpRO.off("LiquidationRequested", onLiq);
    limitRO.off("TriggerRequested", onTrig);
    ammRO.off("WithdrawRequested", onWithdraw);
    darkRO.off("BatchMatchRequested", onBatch);
    darkRO.off("MatchProposed", onMatch);
  };
}
