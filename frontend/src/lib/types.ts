export type Deployment = {
  network: string;
  chainId: number;
  contracts: {
    MockERC7984: `0x${string}`;
    Compliance: `0x${string}`;
    Oracle: `0x${string}`;
    NoirVault: `0x${string}`;
    PerpEngine: `0x${string}`;
    AMMEngine: `0x${string}`;
    DarkpoolEngine: `0x${string}`;
  };
  relayers: `0x${string}`[];
  admin: `0x${string}`;
};

export type ComplianceProof = {
  root: `0x${string}`;
  allowlisted: boolean;
  proof: `0x${string}`[];
};
