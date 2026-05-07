import type { Deployment } from "./types";

let instance: unknown | undefined;

/**
 * Lazy-init the relayer SDK. Local dev uses an in-memory mock with the
 * same surface (createEncryptedInput, userDecrypt, publicDecrypt) so the
 * UI stays clickable without hitting a real KMS. Sepolia + mainnet
 * lazy-load the real `@zama-fhe/relayer-sdk` createInstance.
 *
 * Import path note: `@zama-fhe/relayer-sdk/web` is the browser bundle
 * (confirmed at 0.4.1 — package.json exports map has `./web` pointing at
 * `lib/web.js` with `lib/web.d.ts` types). Root export is node-only.
 */
export async function getRelayerInstance(deployment: Deployment) {
  if (instance) return instance;
  if (deployment.network === "local") {
    instance = makeLocalMockInstance();
    return instance;
  }
  const sdk = await import("@zama-fhe/relayer-sdk/web");
  // Must run before createInstance(). WASM blobs are copied to /public/
  // at install time and we pass explicit URLs to bypass the SDK's
  // relative-URL heuristic (which lands on Vite's SPA fallback in dev,
  // returning index.html — `<!DO…` — instead of the WASM bytes).
  await sdk.initSDK({ tfheParams: "/tfhe_bg.wasm", kmsParams: "/kms_lib_bg.wasm" });
  // Use the V2 preset: Zama's testnet relayer migrated /v1/* → /v2/*
  // (verified 2026-05-07 — /v1/keyurl returns 404, /v2/keyurl returns 200).
  // SepoliaConfigV2 differs from SepoliaConfig only by `relayerUrl`
  // (`.../v2` vs the unversioned base which the SDK's V1 helpers append
  // `/v1` to). Mainnet preset stays as-is until we hit the same gap there.
  const preset =
    deployment.chainId === 11155111 ? sdk.SepoliaConfigV2 : sdk.MainnetConfig;
  instance = await sdk.createInstance({
    ...preset,
    network: import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545",
  });
  return instance;
}

function makeLocalMockInstance() {
  return {
    createEncryptedInput: (_contract: string, _user: string) => {
      const values: bigint[] = [];
      const inp = {
        add64: (v: bigint) => { values.push(v); return inp; },
        encrypt: async () => ({
          handles: values.map((v) =>
            ("0x" + v.toString(16).padStart(64, "0")) as `0x${string}`,
          ),
          inputProof: "0x" as `0x${string}`,
        }),
      };
      return inp;
    },
    userDecrypt: async (_handle: string) => 0n,
    publicDecrypt: async () => ({
      abiEncodedClearValues: "0x" as `0x${string}`,
      decryptionProof: "0x" as `0x${string}`,
    }),
  };
}
