export type Deployment = {
  network: string;
  chainId: number;
  contracts: {
    /** Local mode: our self-deployed MockERC7984. Absent on Sepolia. */
    MockERC7984?: `0x${string}`;
    /** Sepolia mode: Zama's pre-deployed cUSDCMock. Absent on local. */
    cUSDCMock?:   `0x${string}`;
    Compliance:     `0x${string}`;
    Oracle:         `0x${string}`;
    NoirVault:      `0x${string}`;
    PerpEngine:     `0x${string}`;
    AMMEngine:      `0x${string}`;
    LimitEngine:    `0x${string}`;
    DarkpoolEngine: `0x${string}`;
  };
  relayers: `0x${string}`[];
  admin:    `0x${string}`;
};

/** Resolve the USDCx token address regardless of deploy network.
 *  Local stack uses self-deployed MockERC7984; Sepolia uses Zama's
 *  canonical cUSDCMock. Both implement ERC-7984 so frontend code can
 *  treat them identically once the address is resolved. */
export function getUsdcxToken(d: Deployment | undefined): `0x${string}` | undefined {
  return d?.contracts.cUSDCMock ?? d?.contracts.MockERC7984;
}

export type ComplianceProof = {
  root: `0x${string}`;
  allowlisted: boolean;
  proof: `0x${string}`[];
};
