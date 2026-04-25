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
  // `network` accepts an EIP-1193 provider or a JSON-RPC URL string.
  // SepoliaConfig / MainnetConfig supply the preset contract addresses.
  const preset =
    deployment.chainId === 11155111 ? sdk.SepoliaConfig : sdk.MainnetConfig;
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
