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
 * Poll all four engines' decrypt-request events in (fromBlock, toBlock] and
 * dispatch each to the appropriate handler. HTTP-based replacement for
 * the earlier WS subscription. Each request is processed sequentially so
 * the bot's single signer doesn't race nonces. Per-handler failures are
 * swallowed (logged inside the handler) so one stuck request can't block
 * the rest.
 *
 * Event signatures (verified against contracts/contracts/engines/*.sol):
 *   PerpEngine.LiquidationRequested(requestId, positionId, keeper, underwaterHandle)
 *   LimitEngine.TriggerRequested(requestId, orderId, keeper, shouldTriggerHandle)
 *   AMMEngine.WithdrawRequested(requestId, user, claimedShares, matchHandle)
 *   DarkpoolEngine.BatchMatchRequested(requestId, keeper, orderIds, handles)
 *   DarkpoolEngine.MatchProposed(requestId, buyId, sellId, requester, handles)
 */
export async function pollDecryptRequests(
  perpRO: Contract, perpRW: Contract,
  limitRO: Contract, limitRW: Contract,
  ammRO: Contract, ammRW: Contract,
  darkRO: Contract, darkRW: Contract,
  publicDecrypt: PublicDecryptFn,
  fromBlock: number,
  toBlock: number,
  logger: Logger,
): Promise<void> {
  const [liq, trig, withdraw, batch, match] = await Promise.all([
    perpRO.queryFilter("LiquidationRequested", fromBlock, toBlock),
    limitRO.queryFilter("TriggerRequested", fromBlock, toBlock),
    ammRO.queryFilter("WithdrawRequested", fromBlock, toBlock),
    darkRO.queryFilter("BatchMatchRequested", fromBlock, toBlock),
    darkRO.queryFilter("MatchProposed", fromBlock, toBlock),
  ]);

  for (const ev of liq) {
    const a = (ev as any).args;
    await handleSingleDecrypt({
      engine: perpRW,
      callbackName: "_onLiquidationDecided",
      requestId: a.requestId as bigint,
      handle: a.underwaterHandle as string,
      publicDecrypt, logger,
    }).catch(() => {});
  }
  for (const ev of trig) {
    const a = (ev as any).args;
    await handleSingleDecrypt({
      engine: limitRW,
      callbackName: "_onTriggerDecided",
      requestId: a.requestId as bigint,
      handle: a.shouldTriggerHandle as string,
      publicDecrypt, logger,
    }).catch(() => {});
  }
  for (const ev of withdraw) {
    const a = (ev as any).args;
    await handleSingleDecrypt({
      engine: ammRW,
      callbackName: "_onWithdrawDecided",
      requestId: a.requestId as bigint,
      handle: a.matchHandle as string,
      publicDecrypt, logger,
    }).catch(() => {});
  }
  for (const ev of batch) {
    const a = (ev as any).args;
    await handleBatchDecrypt({
      engine: darkRW,
      requestId: a.requestId as bigint,
      handles: [...(a.handles as string[])],
      publicDecrypt, logger,
    }).catch(() => {});
  }
  for (const ev of match) {
    const a = (ev as any).args;
    await handleMatchDecrypt({
      engine: darkRW,
      requestId: a.requestId as bigint,
      handles: [...(a.handles as string[])],
      publicDecrypt, logger,
    }).catch(() => {});
  }
}
