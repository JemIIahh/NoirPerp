# Phase 8 — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a functional React/Vite frontend that hits all 5 spec'd pages (Trade, Liquidity, Darkpool, Portfolio, Compliance) with end-to-end FHE encryption (deposit + open position + decrypt own state) so the demo video can record a real user journey.

**Architecture:** Single SPA. wagmi v2 + RainbowKit for wallet, viem under the hood. Zama Relayer SDK for client-side encryption (`createEncryptedInput().add64().encrypt()`) and decryption (`userDecrypt`). Tailwind for styling. React Router v6 for navigation. No global state library beyond wagmi's TanStack Query — page-local state is plenty. Each page is a self-contained component that composes shared hooks + components.

**Tech stack:**
- Vite 5 + React 18 + TypeScript (strict)
- wagmi 2 + viem 2 + @tanstack/react-query 5
- @rainbow-me/rainbowkit 2 (wallet UI)
- @zama-fhe/relayer-sdk 0.4.1 (EXACT pin)
- Tailwind CSS 3
- React Router v6
- ABIs hand-curated (human-readable wagmi ABI strings) so the frontend has no dependency on contracts' build state

**Reference docs:**
- Spec: `docs/specs/2026-04-24-noirperp-design.md` §3, §5.1 (Open flow), §5.5 (Compliance), §10 phase 8 line 480
- Primitives: `docs/fhe-primitives.md` §5 (decrypt) + §6 (external inputs) + §10 (test patterns — informs the runtime userDecrypt usage)
- Phase 7 deployment shape: `contracts/deployments/local.json` written by `deploy-local.ts`

**Spec deviations** (intentional, documented):
1. **No frontend test suite.** The frontend is a demo SPA over the security-critical contracts; component tests provide poor signal-per-cost. Validation is via Task 8 manual smoke test against the running local stack.
2. **No charts / orderbook visualizations.** Bare UI focused on FHE encrypt/decrypt flows, position lists, and forms. Sufficient for the submission video; visual polish is post-submission.
3. **No mobile responsive design pass.** Desktop-only for the demo. Tailwind's defaults handle reasonable narrow widths but no `md:`/`lg:` breakpoint discipline.
4. **No light/dark theme toggle.** Single dark theme (matches the "dark" pool brand).
5. **Compliance KYC onboarding is a stub.** UI shows status from compliance-backend; "request access" link points to a mailto / static text, not a form. Real KYC integration is post-launch.
6. **No transaction history page.** Wagmi's pending-tx UI + RainbowKit modal cover in-flight tx; no permanent history pane. Users can read events from a block explorer if they want history.

---

## Page-level scope

| Page | Demo flow it serves | Critical interactions |
|---|---|---|
| Compliance | "I'm KYC'd" gate | GET `/proof/:address` from backend; show status + proof handle |
| Portfolio | "What do I have?" overview | Wallet token balance (plaintext); vault balance (userDecrypt); positions list (userDecrypt size/collateral/entry); LP shares; active limit + dark orders |
| Trade | "Open a privacy-preserving long" | Encrypt size+collateral → `PerpEngine.openPosition`; userDecrypt own position; close button |
| Liquidity | "Provide AMM liquidity" | `addLiquidity(amount)` (plaintext arg per Phase 4 design); `requestWithdraw(shares)` async; show user's encrypted share balance |
| Darkpool | "Submit a hidden limit order" | Encrypt size+collateral+limitPrice → `DarkpoolEngine.submitOrder`; cancel; show user's active dark orders |

---

### Task 0: Branch + Vite scaffold + dependencies

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`, `frontend/tsconfig.node.json`
- Create: `frontend/index.html`
- Create: `frontend/.gitignore`, `frontend/.env.example`
- Create: `frontend/tailwind.config.js`, `frontend/postcss.config.js`
- Create: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`

- [ ] **Step 1: Verify branch**

```bash
git -C /Users/ram/Desktop/NoirPerp branch --show-current
```
Expected: `phase-8-frontend`.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "@noirperp/frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "NoirPerp privacy-preserving perps DEX frontend",
  "license": "MIT",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@rainbow-me/rainbowkit": "^2.1.0",
    "@tanstack/react-query": "^5.40.0",
    "@zama-fhe/relayer-sdk": "0.4.1",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.24.0",
    "viem": "^2.17.0",
    "wagmi": "^2.10.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0"
  }
}
```

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@deployments": path.resolve(__dirname, "../contracts/deployments"),
    },
  },
  server: { port: 5173, host: "127.0.0.1" },
});
```

- [ ] **Step 5: `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NoirPerp — Privacy-Preserving Perpetuals</title>
  </head>
  <body class="bg-noir-black text-noir-white">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Tailwind config**

`tailwind.config.js`:
```javascript
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        noir: {
          black: "#0a0a0a",
          gray: "#1a1a1a",
          line: "#2a2a2a",
          mute: "#6b6b6b",
          white: "#e8e8e8",
          accent: "#7c5cff",
          green: "#3ddc84",
          red: "#ff5c5c",
        },
      },
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
```

`postcss.config.js`:
```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 7: `.env.example` + `.gitignore`**

`.env.example`:
```
VITE_RPC_URL=http://127.0.0.1:8545
VITE_CHAIN_ID=31337
VITE_COMPLIANCE_API_URL=http://127.0.0.1:4001
VITE_DEPLOYMENT_NETWORK=local

# Sepolia (Phase 9 will provide real values)
# VITE_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
# VITE_CHAIN_ID=11155111
# VITE_DEPLOYMENT_NETWORK=sepolia
# VITE_WC_PROJECT_ID=<walletconnect project id>
```

`.gitignore`:
```
node_modules
dist
.env
.env.local
.vite
```

- [ ] **Step 8: Stub `App.tsx` + `main.tsx` + `index.css`**

`src/main.tsx`:
```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { font-family: ui-sans-serif, system-ui, sans-serif; }
.font-mono-tight { font-feature-settings: "tnum"; }
```

`src/App.tsx`:
```typescript
export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-4xl font-bold tracking-tight">NoirPerp</h1>
    </div>
  );
}
```

- [ ] **Step 9: Install + sanity boot**

```bash
cd /Users/ram/Desktop/NoirPerp/frontend && npm install && npm run build 2>&1 | tail -8
```

Expected: clean build, `dist/` contains `index.html` + assets.

```bash
npm run dev
```

Dev server up on `http://127.0.0.1:5173`. `curl http://127.0.0.1:5173/` should return HTML containing `<title>NoirPerp`. Kill server.

- [ ] **Step 10: CHANGELOG + commit**

```markdown
### Phase 8 — Frontend (in progress)

- **Added**: `frontend/` Vite + React 18 + TypeScript + Tailwind
  scaffold. Dependencies pinned: wagmi 2, viem 2, @tanstack/react-query 5,
  @rainbow-me/rainbowkit 2, @zama-fhe/relayer-sdk 0.4.1 (EXACT pin),
  react-router-dom 6. Tailwind theme `noir-{black,gray,line,mute,white,
  accent,green,red}` matches the dark-pool brand. Build clean, dev
  server boots on 127.0.0.1:5173.
  **Files**: `frontend/package.json`, `frontend/{vite,tsconfig,tsconfig.node}.{ts,json}`,
  `frontend/{tailwind,postcss}.config.js`, `frontend/index.html`,
  `frontend/.{gitignore,env.example}`, `frontend/src/{main,App}.tsx`,
  `frontend/src/index.css`.
```

```bash
cd /Users/ram/Desktop/NoirPerp && git add frontend/ CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "feat(frontend): Vite + React + Tailwind + wagmi scaffold

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: shared lib — clients, relayer SDK, deployments, types

**Files:**
- Create: `frontend/src/lib/deployment.ts` — load deployment.json
- Create: `frontend/src/lib/wagmi.ts` — wagmi + RainbowKit config
- Create: `frontend/src/lib/relayer.ts` — Zama relayer SDK setup
- Create: `frontend/src/lib/abis.ts` — minimal ABIs (events + functions used)
- Create: `frontend/src/lib/markets.ts` — market metadata (BTC=1, ETH=2, SOL=3)
- Create: `frontend/src/lib/format.ts` — bigint → human-readable helpers
- Create: `frontend/src/lib/types.ts` — shared types

**Pattern:** these modules mirror `bot/src/{config,clients}.ts` structure. ABIs are inlined here so the frontend has no dependency on the contracts' build state.

- [ ] **Step 1: `src/lib/markets.ts`**

```typescript
export type Market = { id: number; symbol: string; name: string; decimals: number };

export const MARKETS: Market[] = [
  { id: 1, symbol: "BTC", name: "Bitcoin",  decimals: 8 },
  { id: 2, symbol: "ETH", name: "Ethereum", decimals: 18 },
  { id: 3, symbol: "SOL", name: "Solana",   decimals: 9 },
];

export function marketById(id: number): Market | undefined {
  return MARKETS.find((m) => m.id === id);
}
```

- [ ] **Step 2: `src/lib/types.ts`**

```typescript
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
    LimitEngine: `0x${string}`;
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
```

- [ ] **Step 3: `src/lib/deployment.ts`**

```typescript
import type { Deployment } from "./types";

export async function loadDeployment(): Promise<Deployment> {
  const network = import.meta.env.VITE_DEPLOYMENT_NETWORK ?? "local";
  try {
    const mod = await import(`@deployments/${network}.json`);
    return mod.default as Deployment;
  } catch {
    const res = await fetch(`/deployment.${network}.json`);
    if (!res.ok) throw new Error(`No deployment.json for network=${network}`);
    return (await res.json()) as Deployment;
  }
}
```

- [ ] **Step 4: `src/lib/abis.ts`** — minimal ABIs reused by all pages

```typescript
// Hand-curated wagmi ABIs (human-readable). Keep minimal so the bundle
// stays small and the surface is auditable. wagmi v2 / viem accept
// these strings via parseAbi(...).

export const ERC7984_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (bytes32)",
  "function setOperator(address operator, uint48 until) external",
  "function isOperator(address holder, address operator) view returns (bool)",
  "function mintPlaintext(address to, uint64 amount) external",
] as const;

export const VAULT_ABI = [
  "function getBalance(address user) view returns (bytes32)",
  "function deposit(uint64 amount) external",
  "function getPosition(uint256 positionId) view returns (tuple(address owner, uint8 marketId, bool isLong, bool active, bytes32 size, bytes32 entryPrice, bytes32 collateral))",
  "function nextPositionId() view returns (uint256)",
  "event PositionOpened(uint256 indexed positionId, address indexed owner, uint8 marketId)",
  "event PositionClosed(uint256 indexed positionId)",
] as const;

export const ORACLE_ABI = [
  "function getPrice(uint8 marketId) view returns (uint64 price, bool fresh)",
] as const;

export const COMPLIANCE_ABI = [
  "function verify(address user, bytes32[] calldata proof) view returns (bool)",
  "function merkleRoot() view returns (bytes32)",
] as const;

export const PERP_ABI = [
  "function openPosition(bytes32 eSize, bytes sizeProof, bytes32 eCollateral, bytes collateralProof, bool isLong, uint8 marketId, bytes32[] complianceProof) external returns (uint256 positionId)",
  "function closePosition(uint256 positionId) external",
] as const;

export const AMM_ABI = [
  "function totalShares() view returns (uint64)",
  "function totalReserveUsdcx() view returns (uint64)",
  "function userShares(address) view returns (bytes32)",
  "function addLiquidity(uint64 amount) external",
  "function requestWithdraw(uint64 shares) external returns (uint256 requestId)",
] as const;

export const LIMIT_ABI = [
  "function getOrder(uint256 orderId) view returns (tuple(address owner, uint8 orderType, uint8 marketId, bool isLong, bool active, uint256 positionId, bytes32 triggerPrice, bytes32 size, bytes32 collateral))",
  "function cancelOrder(uint256 orderId) external",
] as const;

export const DARK_ABI = [
  "function getOrder(uint256 orderId) view returns (tuple(address owner, uint8 marketId, bool isLong, bool active, bytes32 size, bytes32 collateral, bytes32 limitPrice))",
  "function nextOrderId() view returns (uint256)",
  "function submitOrder(tuple(bytes32 eSize, bytes sizeProof, bytes32 eCollateral, bytes collateralProof, bytes32 eLimitPrice, bytes limitProof) inputs, uint8 marketId, bool isLong, bytes32[] complianceProof) external returns (uint256 orderId)",
  "function cancelOrder(uint256 orderId) external",
] as const;
```

If `parseAbi` rejects the inline tuple syntax in `submitOrder`, switch that single ABI entry to JSON form — keep the rest as human-readable.

- [ ] **Step 5: `src/lib/wagmi.ts`**

```typescript
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";

const network = import.meta.env.VITE_DEPLOYMENT_NETWORK ?? "local";
const rpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
const wcProjectId = import.meta.env.VITE_WC_PROJECT_ID ?? "demo";

const chain = network === "sepolia" ? sepolia : hardhat;

export const wagmiConfig = getDefaultConfig({
  appName: "NoirPerp",
  projectId: wcProjectId,
  chains: [chain],
  transports: { [chain.id]: http(rpcUrl) },
  ssr: false,
});
```

- [ ] **Step 6: `src/lib/relayer.ts`**

```typescript
import type { Deployment } from "./types";

let instance: any | undefined;

/**
 * Lazy-init the relayer SDK. Local dev uses an in-memory mock with the
 * same surface (createEncryptedInput, userDecrypt, publicDecrypt) so the
 * UI stays clickable without hitting a real KMS. Sepolia + mainnet
 * lazy-load the real `@zama-fhe/relayer-sdk/web` createInstance.
 */
export async function getRelayerInstance(deployment: Deployment) {
  if (instance) return instance;
  if (deployment.network === "local") {
    instance = makeLocalMockInstance();
    return instance;
  }
  const sdk = await import("@zama-fhe/relayer-sdk/web");
  instance = await sdk.createInstance({
    chainId: deployment.chainId,
    networkUrl: import.meta.env.VITE_RPC_URL,
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
```

**Note:** the frontend's "local" mode is for UI testing only — it can't talk to the FHEVM mock plugin (that's in-process to Hardhat). Real demo flow runs on Sepolia (Phase 9). The mock keeps imports + types coherent without crashing.

- [ ] **Step 7: `src/lib/format.ts`**

```typescript
export function formatBigint(v: bigint, decimals = 0): string {
  if (decimals === 0) return v.toString();
  const s = v.toString().padStart(decimals + 1, "0");
  const head = s.slice(0, -decimals);
  const tail = s.slice(-decimals).replace(/0+$/, "");
  return tail ? `${head}.${tail}` : head;
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
```

- [ ] **Step 8: Build sanity check**

```bash
cd /Users/ram/Desktop/NoirPerp/frontend && npm run lint && npm run build 2>&1 | tail -3
```

Expected: tsc clean.

- [ ] **Step 9: CHANGELOG + commit**

```markdown
- **Added**: `frontend/src/lib/{deployment,wagmi,relayer,abis,markets,
  format,types}.ts` — shared utilities. Deployment artifacts loaded
  via Vite alias `@deployments` (build-time) with runtime fetch
  fallback. Minimal hand-curated ABIs (8 contracts) keep the bundle
  small. Local mock for relayer SDK keeps UI clickable in dev; real
  SDK lazy-loads on Sepolia (Phase 9).
  **Files**: `frontend/src/lib/*.ts` (7 files).
```

Commit `feat(frontend): shared lib (clients, relayer SDK, types)`.

---

### Task 2: layout + routing + wallet connect

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/{Header,Layout,WalletGate}.tsx`
- Create: `frontend/src/pages/{Compliance,Portfolio,Trade,Liquidity,Darkpool,Home}.tsx` (stubs)
- Create: `frontend/src/providers.tsx`

- [ ] **Step 1: `src/providers.tsx`**

```typescript
import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "./lib/wagmi";

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

- [ ] **Step 2: `src/components/Header.tsx`**

```typescript
import { Link, NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const NAV = [
  { to: "/trade", label: "Trade" },
  { to: "/liquidity", label: "Liquidity" },
  { to: "/darkpool", label: "Darkpool" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/compliance", label: "Compliance" },
];

export function Header() {
  return (
    <header className="border-b border-noir-line bg-noir-gray">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="text-xl font-semibold tracking-tight text-noir-white">
          Noir<span className="text-noir-accent">Perp</span>
        </Link>
        <nav className="flex items-center gap-6">
          {NAV.map((n) => (
            <NavLink
              key={n.to} to={n.to}
              className={({ isActive }) =>
                `text-sm ${isActive ? "text-noir-white" : "text-noir-mute hover:text-noir-white"}`}
            >{n.label}</NavLink>
          ))}
        </nav>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
```

- [ ] **Step 3: `src/components/Layout.tsx` + `WalletGate.tsx`**

```typescript
// Layout.tsx
import { Outlet } from "react-router-dom";
import { Header } from "./Header";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-noir-line py-4 text-center text-xs text-noir-mute">
        NoirPerp · Privacy-preserving perpetuals on Zama FHEVM · Sepolia testnet
      </footer>
    </div>
  );
}

// WalletGate.tsx
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ReactNode } from "react";

export function WalletGate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-noir-mute">Connect a wallet to continue.</p>
        <ConnectButton />
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: 6 page stubs**

`src/pages/Trade.tsx` (and Liquidity / Darkpool / Portfolio / Compliance, all the same shape):
```typescript
export default function Trade() {
  return <div><h1 className="text-2xl font-semibold mb-2">Trade</h1><p className="text-noir-mute">TODO Task 5</p></div>;
}
```

`src/pages/Home.tsx`:
```typescript
import { Link } from "react-router-dom";
export default function Home() {
  return (
    <div className="text-center py-20">
      <h1 className="text-6xl font-bold tracking-tight mb-4">Noir<span className="text-noir-accent">Perp</span></h1>
      <p className="text-xl text-noir-mute mb-12">Privacy-preserving perpetuals on Zama FHEVM.</p>
      <div className="flex justify-center gap-4">
        <Link to="/trade" className="px-6 py-3 bg-noir-accent text-noir-black rounded font-medium hover:opacity-90">Open Trade</Link>
        <Link to="/portfolio" className="px-6 py-3 border border-noir-line rounded hover:bg-noir-gray">View Portfolio</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `App.tsx` — router**

```typescript
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Providers } from "./providers";
import { Layout } from "./components/Layout";
import Home from "./pages/Home";
import Trade from "./pages/Trade";
import Liquidity from "./pages/Liquidity";
import Darkpool from "./pages/Darkpool";
import Portfolio from "./pages/Portfolio";
import Compliance from "./pages/Compliance";

export default function App() {
  return (
    <Providers>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="trade" element={<Trade />} />
            <Route path="liquidity" element={<Liquidity />} />
            <Route path="darkpool" element={<Darkpool />} />
            <Route path="portfolio" element={<Portfolio />} />
            <Route path="compliance" element={<Compliance />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </Providers>
  );
}
```

- [ ] **Step 6: Build + dev sanity**

```bash
cd /Users/ram/Desktop/NoirPerp/frontend && npm run build 2>&1 | tail -5
```
Clean. Then `npm run dev` and verify the 5 routes render their TODO stubs. Kill server.

- [ ] **Step 7: CHANGELOG + commit**

```markdown
- **Added**: `frontend/src/{App,providers}.tsx`,
  `frontend/src/components/{Header,Layout,WalletGate}.tsx`,
  6 page stubs (`Home,Trade,Liquidity,Darkpool,Portfolio,Compliance.tsx`).
  wagmi + RainbowKit + react-router wired. Header with sticky nav +
  ConnectButton. Dark theme via Tailwind `noir-*` palette.
  **Files**: `frontend/src/{App,providers}.tsx`,
  `frontend/src/components/*.tsx`, `frontend/src/pages/*.tsx`.
```

Commit `feat(frontend): layout + routing + wallet connect`.

---

### Task 3: Compliance page

**Files:**
- Modify: `frontend/src/pages/Compliance.tsx`
- Create: `frontend/src/hooks/useCompliance.ts`

**Behavior:** Connected wallet's address; calls `GET ${VITE_COMPLIANCE_API_URL}/proof/:address`; status pill (green if allowlisted, red if not); proof JSON shown for allowlisted; `mailto:` stub for "request access".

- [ ] **Step 1: `src/hooks/useCompliance.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { ComplianceProof } from "../lib/types";

const API_URL = import.meta.env.VITE_COMPLIANCE_API_URL ?? "http://127.0.0.1:4001";

export function useComplianceProof() {
  const { address } = useAccount();
  return useQuery<ComplianceProof | null>({
    queryKey: ["compliance-proof", address],
    enabled: !!address,
    queryFn: async () => {
      if (!address) return null;
      const res = await fetch(`${API_URL}/proof/${address}`);
      if (!res.ok) throw new Error(`compliance API ${res.status}`);
      return (await res.json()) as ComplianceProof;
    },
    refetchInterval: 30_000,
  });
}

export function useComplianceHealth() {
  return useQuery({
    queryKey: ["compliance-health"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/health`);
      if (!res.ok) throw new Error("compliance health failed");
      return await res.json();
    },
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 2: `src/pages/Compliance.tsx`**

```typescript
import { useAccount } from "wagmi";
import { useComplianceProof, useComplianceHealth } from "../hooks/useCompliance";
import { WalletGate } from "../components/WalletGate";
import { shortAddr } from "../lib/format";

export default function Compliance() {
  return <WalletGate><Inner /></WalletGate>;
}

function Inner() {
  const { address } = useAccount();
  const { data: proof, isLoading, error } = useComplianceProof();
  const { data: health } = useComplianceHealth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Compliance</h1>
        <p className="text-noir-mute">KYC allowlist status for the connected address.</p>
      </div>

      <Section label="Connected address">
        <code className="font-mono text-noir-white">{address}</code>
      </Section>

      <Section label="Allowlist status">
        {isLoading && <span className="text-noir-mute">checking…</span>}
        {error && <span className="text-noir-red">backend unreachable: {(error as Error).message}</span>}
        {proof && (
          <div className="flex items-center gap-3">
            {proof.allowlisted ? (
              <span className="px-2 py-1 rounded bg-noir-green/20 text-noir-green text-sm">Allowlisted</span>
            ) : (
              <span className="px-2 py-1 rounded bg-noir-red/20 text-noir-red text-sm">Not allowlisted</span>
            )}
            {proof.allowlisted ? (
              <span className="text-noir-mute text-sm">Proof has {proof.proof.length} sibling(s).</span>
            ) : (
              <a href="mailto:compliance@noirperp.example" className="text-sm text-noir-accent underline">Request access</a>
            )}
          </div>
        )}
      </Section>

      {proof?.allowlisted && (
        <Section label="Proof (use as `complianceProof` in tx)">
          <pre className="bg-noir-gray border border-noir-line rounded p-3 text-xs font-mono overflow-x-auto">
{JSON.stringify(proof.proof, null, 2)}
          </pre>
        </Section>
      )}

      <Section label="Backend health">
        {health && (
          <div className="text-sm text-noir-mute">
            root: <code className="text-noir-white">{shortAddr(health.root)}</code> · entries: {health.count}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-noir-mute mb-2">{label}</div>
      <div className="bg-noir-gray border border-noir-line rounded p-4">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Build sanity** — `npm run build` clean.

- [ ] **Step 4: CHANGELOG + commit**

```markdown
- **Added**: `frontend/src/pages/Compliance.tsx` +
  `frontend/src/hooks/useCompliance.ts`. TanStack-Query-backed
  fetch of compliance-backend `/proof/:address` and `/health`.
  Status pill, proof JSON for allowlisted users, backend health
  summary. Mailto stub for "request access".
  **Files**: `frontend/src/pages/Compliance.tsx`,
  `frontend/src/hooks/useCompliance.ts`.
```

Commit `feat(frontend): Compliance page (KYC status + proof fetch)`.

---

### Task 4: Portfolio page

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`
- Create: `frontend/src/hooks/useDeployment.ts`
- Create: `frontend/src/hooks/useEncryptedBalance.ts`
- Create: `frontend/src/hooks/usePositions.ts`
- Create: `frontend/src/components/EncryptedValue.tsx`

**Behavior:** wallet token balance (plaintext from MockERC7984.balanceOf), vault balance (encrypted handle → userDecrypt), positions list (filter by owner + active, decrypt per-row), LP shares.

- [ ] **Step 1: `src/hooks/useDeployment.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { loadDeployment } from "../lib/deployment";

export function useDeployment() {
  return useQuery({
    queryKey: ["deployment"],
    queryFn: loadDeployment,
    staleTime: Infinity,
  });
}
```

- [ ] **Step 2: `src/components/EncryptedValue.tsx`**

```typescript
import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useDeployment } from "../hooks/useDeployment";
import { getRelayerInstance } from "../lib/relayer";

type Props = {
  handle: `0x${string}` | undefined;
  contractAddr: `0x${string}` | undefined;
  format?: (v: bigint) => string;
  hidden?: string;
};

export function EncryptedValue({ handle, contractAddr, format = (v) => v.toString(), hidden = "•••" }: Props) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { data: deployment } = useDeployment();
  const [value, setValue] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!handle || !contractAddr || !deployment) return <span className="text-noir-mute">—</span>;
  if (value !== null) return <span className="font-mono">{format(value)}</span>;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-noir-mute">{hidden}</span>
      <button
        className="px-2 py-0.5 text-xs border border-noir-line rounded hover:bg-noir-gray disabled:opacity-50"
        disabled={busy || !address || !walletClient}
        onClick={async () => {
          if (!address || !walletClient) return;
          setBusy(true); setErr(null);
          try {
            const inst = await getRelayerInstance(deployment);
            const v = await inst.userDecrypt(handle, contractAddr, walletClient);
            setValue(BigInt(v));
          } catch (e) { setErr((e as Error).message); }
          finally { setBusy(false); }
        }}
      >{busy ? "…" : "Reveal"}</button>
      {err && <span className="text-xs text-noir-red">{err}</span>}
    </span>
  );
}
```

**Note:** the exact `userDecrypt(handle, contractAddr, signer)` API depends on the relayer-sdk version. Phase 9 will likely need to adjust the third arg (e.g. EIP-712 typed data instead of a wallet client) when wiring real Sepolia.

- [ ] **Step 3: `src/hooks/useEncryptedBalance.ts`**

```typescript
import { useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { useDeployment } from "./useDeployment";
import { VAULT_ABI } from "../lib/abis";

const ABI = parseAbi(VAULT_ABI);

export function useVaultBalance(user: `0x${string}` | undefined) {
  const { data: deployment } = useDeployment();
  return useReadContract({
    address: deployment?.contracts.NoirVault,
    abi: ABI, functionName: "getBalance",
    args: user ? [user] : undefined,
    query: { enabled: !!user && !!deployment, refetchInterval: 10_000 },
  });
}
```

- [ ] **Step 4: `src/hooks/usePositions.ts`**

```typescript
import { useReadContracts, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { useDeployment } from "./useDeployment";
import { VAULT_ABI } from "../lib/abis";

const ABI = parseAbi(VAULT_ABI);

export function usePositions(owner: `0x${string}` | undefined, limit = 50) {
  const { data: deployment } = useDeployment();
  const { data: nextId } = useReadContract({
    address: deployment?.contracts.NoirVault, abi: ABI, functionName: "nextPositionId",
    query: { enabled: !!deployment, refetchInterval: 15_000 },
  });
  const total = nextId ? Number(nextId) : 0;
  const fromId = Math.max(0, total - limit);
  const ids = Array.from({ length: total - fromId }, (_, i) => BigInt(fromId + i));

  const positions = useReadContracts({
    contracts: ids.map((id) => ({
      address: deployment?.contracts.NoirVault, abi: ABI,
      functionName: "getPosition", args: [id],
    })),
    query: { enabled: !!deployment && !!owner && ids.length > 0 },
  });

  if (!owner || !positions.data) return [];

  return ids.flatMap((id, idx) => {
    const p = positions.data![idx]?.result as any;
    if (!p) return [];
    if (p.owner.toLowerCase() !== owner.toLowerCase()) return [];
    if (!p.active) return [];
    return [{
      id, owner: p.owner, marketId: Number(p.marketId), isLong: p.isLong,
      sizeHandle: p.size, entryPriceHandle: p.entryPrice, collateralHandle: p.collateral,
    }];
  });
}
```

- [ ] **Step 5: `src/pages/Portfolio.tsx`**

```typescript
import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { WalletGate } from "../components/WalletGate";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { useVaultBalance } from "../hooks/useEncryptedBalance";
import { usePositions } from "../hooks/usePositions";
import { ERC7984_ABI, AMM_ABI } from "../lib/abis";
import { marketById } from "../lib/markets";

export default function Portfolio() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { data: vaultBalanceHandle } = useVaultBalance(address);
  const positions = usePositions(address);

  const { data: tokenBalance } = useReadContract({
    address: deployment?.contracts.MockERC7984, abi: parseAbi(ERC7984_ABI),
    functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: !!address && !!deployment },
  });
  const { data: lpShares } = useReadContract({
    address: deployment?.contracts.AMMEngine, abi: parseAbi(AMM_ABI),
    functionName: "userShares", args: address ? [address] : undefined,
    query: { enabled: !!address && !!deployment },
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Portfolio</h1>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Wallet token (USDCx)" value={tokenBalance ? String(tokenBalance) : "—"} />
        <Stat label="Vault balance (encrypted)" inner={<EncryptedValue handle={vaultBalanceHandle as `0x${string}` | undefined} contractAddr={deployment?.contracts.NoirVault} />} />
        <Stat label="AMM shares (encrypted)" inner={<EncryptedValue handle={lpShares as `0x${string}` | undefined} contractAddr={deployment?.contracts.AMMEngine} />} />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Open positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <p className="text-noir-mute text-sm">No open positions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-noir-mute border-b border-noir-line">
              <tr><th className="text-left py-2">#</th><th className="text-left">Market</th><th className="text-left">Side</th><th className="text-left">Size</th><th className="text-left">Entry</th><th className="text-left">Collateral</th></tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id.toString()} className="border-b border-noir-line/50">
                  <td className="py-2">{p.id.toString()}</td>
                  <td>{marketById(p.marketId)?.symbol ?? p.marketId}</td>
                  <td>{p.isLong ? <span className="text-noir-green">Long</span> : <span className="text-noir-red">Short</span>}</td>
                  <td><EncryptedValue handle={p.sizeHandle} contractAddr={deployment?.contracts.NoirVault} /></td>
                  <td><EncryptedValue handle={p.entryPriceHandle} contractAddr={deployment?.contracts.NoirVault} /></td>
                  <td><EncryptedValue handle={p.collateralHandle} contractAddr={deployment?.contracts.NoirVault} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, inner }: { label: string; value?: string; inner?: React.ReactNode }) {
  return (
    <div className="bg-noir-gray border border-noir-line rounded p-4">
      <div className="text-xs uppercase tracking-wider text-noir-mute mb-1">{label}</div>
      <div className="font-mono text-lg">{inner ?? value}</div>
    </div>
  );
}
```

- [ ] **Step 6: Build sanity** — `npm run build` clean.

- [ ] **Step 7: CHANGELOG + commit**

```markdown
- **Added**: `frontend/src/pages/Portfolio.tsx` + 3 hooks
  (`useDeployment`, `useEncryptedBalance`, `usePositions`) +
  `EncryptedValue` component (one-click reveal via userDecrypt).
  Position enumeration: reads nextPositionId, fetches up to 50 most-
  recent positions in one multicall, filters by owner + active.
  **Files**: `frontend/src/pages/Portfolio.tsx`,
  `frontend/src/hooks/{useDeployment,useEncryptedBalance,usePositions}.ts`,
  `frontend/src/components/EncryptedValue.tsx`.
```

Commit `feat(frontend): Portfolio page with encrypted reveal`.

---

### Task 5: Trade page (perp open/close)

**Files:**
- Modify: `frontend/src/pages/Trade.tsx`
- Create: `frontend/src/hooks/useEncrypt.ts`
- Create: `frontend/src/components/Form.tsx`

**Behavior:** form for market/side/size/collateral; encrypts size+collateral via relayer SDK; calls `PerpEngine.openPosition(eSize, sizeProof, eCollateral, collateralProof, isLong, marketId, complianceProof)`. Right pane: positions list with Close button.

- [ ] **Step 1: `src/hooks/useEncrypt.ts`**

```typescript
import { useAccount } from "wagmi";
import { useDeployment } from "./useDeployment";
import { getRelayerInstance } from "../lib/relayer";

export function useEncryptInput(contractAddr: `0x${string}` | undefined) {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();

  return async (...values: bigint[]): Promise<{ handles: `0x${string}`[]; inputProof: `0x${string}` }> => {
    if (!address || !deployment || !contractAddr) {
      throw new Error("not ready: wallet/deployment/contractAddr missing");
    }
    const inst = await getRelayerInstance(deployment);
    let inp = inst.createEncryptedInput(contractAddr, address);
    for (const v of values) inp = inp.add64(v);
    return await inp.encrypt();
  };
}
```

- [ ] **Step 2: `src/components/Form.tsx`** — minimal primitives

```typescript
import { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-noir-mute">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className={"w-full bg-noir-black border border-noir-line rounded px-3 py-2 font-mono focus:outline-none focus:border-noir-accent " + (props.className ?? "")} />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}
      className={"w-full bg-noir-black border border-noir-line rounded px-3 py-2 focus:outline-none focus:border-noir-accent " + (props.className ?? "")} />
  );
}

export function Button({ children, variant = "primary", ...rest }: any) {
  const cls = variant === "danger"
    ? "bg-noir-red/20 text-noir-red border-noir-red/40 hover:bg-noir-red/30"
    : "bg-noir-accent text-noir-black hover:opacity-90";
  return (
    <button {...rest} className={`px-4 py-2 rounded border border-transparent disabled:opacity-50 ${cls} ${rest.className ?? ""}`}>
      {children}
    </button>
  );
}
```

- [ ] **Step 3: `src/pages/Trade.tsx`**

```typescript
import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { useDeployment } from "../hooks/useDeployment";
import { useEncryptInput } from "../hooks/useEncrypt";
import { useComplianceProof } from "../hooks/useCompliance";
import { usePositions } from "../hooks/usePositions";
import { EncryptedValue } from "../components/EncryptedValue";
import { MARKETS, marketById } from "../lib/markets";
import { PERP_ABI } from "../lib/abis";

const PERP = parseAbi(PERP_ABI);

export default function Trade() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { data: proof } = useComplianceProof();
  const positions = usePositions(address);
  const encrypt = useEncryptInput(deployment?.contracts.PerpEngine);
  const { writeContractAsync, isPending } = useWriteContract();

  const [marketId, setMarketId] = useState(2);
  const [isLong, setIsLong] = useState(true);
  const [size, setSize] = useState("");
  const [collateral, setCollateral] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!proof?.allowlisted) { setError("Address not allowlisted (visit Compliance page)"); return; }
    if (!deployment) return;
    try {
      const enc = await encrypt(BigInt(size), BigInt(collateral));
      await writeContractAsync({
        address: deployment.contracts.PerpEngine, abi: PERP, functionName: "openPosition",
        args: [enc.handles[0], enc.inputProof, enc.handles[1], enc.inputProof, isLong, marketId, proof.proof],
      });
      setSize(""); setCollateral("");
    } catch (e) { setError((e as Error).message); }
  }

  async function onClose(positionId: bigint) {
    setError(null);
    if (!deployment) return;
    try {
      await writeContractAsync({
        address: deployment.contracts.PerpEngine, abi: PERP, functionName: "closePosition",
        args: [positionId],
      });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="grid grid-cols-2 gap-8">
      <div>
        <h1 className="text-2xl font-semibold mb-4">Open position</h1>
        <div className="space-y-4 bg-noir-gray border border-noir-line rounded p-6">
          <Field label="Market">
            <Select value={marketId} onChange={(e) => setMarketId(Number(e.target.value))}>
              {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.symbol} / USD</option>)}
            </Select>
          </Field>
          <Field label="Side">
            <div className="flex gap-2">
              <button className={`flex-1 py-2 rounded border ${isLong ? "border-noir-green bg-noir-green/20 text-noir-green" : "border-noir-line text-noir-mute"}`} onClick={() => setIsLong(true)}>Long</button>
              <button className={`flex-1 py-2 rounded border ${!isLong ? "border-noir-red bg-noir-red/20 text-noir-red" : "border-noir-line text-noir-mute"}`} onClick={() => setIsLong(false)}>Short</button>
            </div>
          </Field>
          <Field label="Size (units)"><Input type="text" value={size} onChange={(e) => setSize(e.target.value)} placeholder="10" /></Field>
          <Field label="Collateral (USDCx)"><Input type="text" value={collateral} onChange={(e) => setCollateral(e.target.value)} placeholder="1000" /></Field>
          <Button onClick={onSubmit} disabled={isPending || !proof?.allowlisted}>
            {isPending ? "submitting…" : "Open position"}
          </Button>
          {!proof?.allowlisted && <p className="text-xs text-noir-red">Address not allowlisted (Compliance page).</p>}
          {error && <p className="text-xs text-noir-red">{error}</p>}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold mb-4">My positions ({positions.length})</h1>
        {positions.length === 0 ? (
          <p className="text-noir-mute text-sm">No open positions.</p>
        ) : (
          <div className="space-y-3">
            {positions.map((p) => (
              <div key={p.id.toString()} className="bg-noir-gray border border-noir-line rounded p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm">
                    <span className="text-noir-mute">#{p.id.toString()} · </span>
                    <span>{marketById(p.marketId)?.symbol}</span> ·
                    <span className={p.isLong ? "text-noir-green" : "text-noir-red"}> {p.isLong ? "Long" : "Short"}</span>
                  </div>
                  <div className="text-xs text-noir-mute mt-1 flex gap-4">
                    size: <EncryptedValue handle={p.sizeHandle} contractAddr={deployment?.contracts.NoirVault} />
                    coll: <EncryptedValue handle={p.collateralHandle} contractAddr={deployment?.contracts.NoirVault} />
                  </div>
                </div>
                <Button variant="danger" onClick={() => onClose(p.id)}>Close</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build sanity** — `npm run build` clean.

- [ ] **Step 5: CHANGELOG + commit**

```markdown
- **Added**: `frontend/src/pages/Trade.tsx`,
  `frontend/src/hooks/useEncrypt.ts`,
  `frontend/src/components/Form.tsx`. Open-position form with FHE
  encryption of size + collateral via relayer SDK; openPosition tx
  signed via wagmi useWriteContract. Right pane: live positions list
  with one-click close + per-row encrypted-value reveal.
  Allowlist guard prevents submit when not KYC'd.
  **Files**: `frontend/src/pages/Trade.tsx`,
  `frontend/src/hooks/useEncrypt.ts`,
  `frontend/src/components/Form.tsx`.
```

Commit `feat(frontend): Trade page with FHE encryption`.

---

### Task 6: Liquidity page (AMM)

**Files:** Modify `frontend/src/pages/Liquidity.tsx`.

**Behavior:** pool stats (totalShares, totalReserveUsdcx, both plaintext per Phase 4 hybrid-privacy design); addLiquidity (sync) + requestWithdraw (async) forms; user's encrypted shares.

- [ ] **Step 1: `src/pages/Liquidity.tsx`**

```typescript
import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Button } from "../components/Form";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { AMM_ABI } from "../lib/abis";

const AMM = parseAbi(AMM_ABI);

export default function Liquidity() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { writeContractAsync, isPending } = useWriteContract();
  const [addAmount, setAddAmount] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ammAddr = deployment?.contracts.AMMEngine;

  const { data: totalShares } = useReadContract({
    address: ammAddr, abi: AMM, functionName: "totalShares",
    query: { enabled: !!ammAddr, refetchInterval: 15_000 },
  });
  const { data: totalReserve } = useReadContract({
    address: ammAddr, abi: AMM, functionName: "totalReserveUsdcx",
    query: { enabled: !!ammAddr, refetchInterval: 15_000 },
  });
  const { data: userShares } = useReadContract({
    address: ammAddr, abi: AMM, functionName: "userShares",
    args: address ? [address] : undefined,
    query: { enabled: !!ammAddr && !!address, refetchInterval: 15_000 },
  });

  async function onAdd() {
    setError(null);
    try {
      await writeContractAsync({
        address: ammAddr!, abi: AMM, functionName: "addLiquidity",
        args: [BigInt(addAmount)],
      });
      setAddAmount("");
    } catch (e) { setError((e as Error).message); }
  }

  async function onWithdraw() {
    setError(null);
    try {
      await writeContractAsync({
        address: ammAddr!, abi: AMM, functionName: "requestWithdraw",
        args: [BigInt(withdrawShares)],
      });
      setWithdrawShares("");
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Liquidity</h1>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total shares" value={totalShares?.toString() ?? "—"} />
        <Stat label="Total reserve (USDCx)" value={totalReserve?.toString() ?? "—"} />
        <Stat label="Your shares (encrypted)" inner={<EncryptedValue handle={userShares as `0x${string}` | undefined} contractAddr={ammAddr} />} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-noir-gray border border-noir-line rounded p-6 space-y-4">
          <h2 className="text-lg font-semibold">Add liquidity</h2>
          <Field label="Amount (USDCx)"><Input value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder="1000" /></Field>
          <Button onClick={onAdd} disabled={isPending || !addAmount}>Add</Button>
        </div>
        <div className="bg-noir-gray border border-noir-line rounded p-6 space-y-4">
          <h2 className="text-lg font-semibold">Request withdraw</h2>
          <Field label="Shares to burn"><Input value={withdrawShares} onChange={(e) => setWithdrawShares(e.target.value)} placeholder="100" /></Field>
          <Button onClick={onWithdraw} disabled={isPending || !withdrawShares}>Request</Button>
          <p className="text-xs text-noir-mute">Async — bot completes settlement. Watch Portfolio for update.</p>
        </div>
      </div>

      {error && <p className="text-noir-red">{error}</p>}
    </div>
  );
}

function Stat({ label, value, inner }: { label: string; value?: string; inner?: React.ReactNode }) {
  return (
    <div className="bg-noir-gray border border-noir-line rounded p-4">
      <div className="text-xs uppercase tracking-wider text-noir-mute mb-1">{label}</div>
      <div className="font-mono text-lg">{inner ?? value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Build sanity** — `npm run build` clean.

- [ ] **Step 3: CHANGELOG + commit**

```markdown
- **Added**: `frontend/src/pages/Liquidity.tsx`. Pool stats (plaintext
  totalShares + totalReserveUsdcx, both Phase 4 hybrid-privacy state).
  addLiquidity (sync) + requestWithdraw (async via bot) forms. User's
  encrypted share balance with reveal button.
  **Files**: `frontend/src/pages/Liquidity.tsx`.
```

Commit `feat(frontend): Liquidity page (AMM add/withdraw)`.

---

### Task 7: Darkpool page

**Files:**
- Modify: `frontend/src/pages/Darkpool.tsx`
- Create: `frontend/src/hooks/useDarkOrders.ts`

**Behavior:** form with marketId, isLong, size, collateral, limitPrice (3 encrypted inputs); user's active orders + cancel button.

- [ ] **Step 1: `src/hooks/useDarkOrders.ts`**

```typescript
import { useReadContracts, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { useDeployment } from "./useDeployment";
import { DARK_ABI } from "../lib/abis";

const ABI = parseAbi(DARK_ABI);

export function useDarkOrders(owner: `0x${string}` | undefined, limit = 50) {
  const { data: deployment } = useDeployment();
  const dark = deployment?.contracts.DarkpoolEngine;
  const { data: nextId } = useReadContract({
    address: dark, abi: ABI, functionName: "nextOrderId",
    query: { enabled: !!dark, refetchInterval: 15_000 },
  });
  const total = nextId ? Number(nextId) : 0;
  const fromId = Math.max(0, total - limit);
  const ids = Array.from({ length: total - fromId }, (_, i) => BigInt(fromId + i));

  const orders = useReadContracts({
    contracts: ids.map((id) => ({ address: dark, abi: ABI, functionName: "getOrder", args: [id] })),
    query: { enabled: !!dark && !!owner && ids.length > 0 },
  });
  if (!owner || !orders.data) return [];

  return ids.flatMap((id, idx) => {
    const o = orders.data![idx]?.result as any;
    if (!o) return [];
    if (o.owner.toLowerCase() !== owner.toLowerCase()) return [];
    if (!o.active) return [];
    return [{
      id, marketId: Number(o.marketId), isLong: o.isLong,
      sizeHandle: o.size, collateralHandle: o.collateral, limitPriceHandle: o.limitPrice,
    }];
  });
}
```

- [ ] **Step 2: `src/pages/Darkpool.tsx`**

```typescript
import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseAbi } from "viem";
import { WalletGate } from "../components/WalletGate";
import { Field, Input, Select, Button } from "../components/Form";
import { EncryptedValue } from "../components/EncryptedValue";
import { useDeployment } from "../hooks/useDeployment";
import { useEncryptInput } from "../hooks/useEncrypt";
import { useComplianceProof } from "../hooks/useCompliance";
import { useDarkOrders } from "../hooks/useDarkOrders";
import { MARKETS, marketById } from "../lib/markets";
import { DARK_ABI } from "../lib/abis";

const DARK = parseAbi(DARK_ABI);

export default function Darkpool() { return <WalletGate><Inner /></WalletGate>; }

function Inner() {
  const { address } = useAccount();
  const { data: deployment } = useDeployment();
  const { data: proof } = useComplianceProof();
  const orders = useDarkOrders(address);
  const encrypt = useEncryptInput(deployment?.contracts.DarkpoolEngine);
  const { writeContractAsync, isPending } = useWriteContract();

  const [marketId, setMarketId] = useState(2);
  const [isLong, setIsLong] = useState(true);
  const [size, setSize] = useState("");
  const [collateral, setCollateral] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!proof?.allowlisted) { setError("Address not allowlisted"); return; }
    if (!deployment) return;
    try {
      const enc = await encrypt(BigInt(size), BigInt(collateral), BigInt(limitPrice));
      const inputs = {
        eSize: enc.handles[0], sizeProof: enc.inputProof,
        eCollateral: enc.handles[1], collateralProof: enc.inputProof,
        eLimitPrice: enc.handles[2], limitProof: enc.inputProof,
      };
      await writeContractAsync({
        address: deployment.contracts.DarkpoolEngine, abi: DARK,
        functionName: "submitOrder", args: [inputs, marketId, isLong, proof.proof],
      });
      setSize(""); setCollateral(""); setLimitPrice("");
    } catch (e) { setError((e as Error).message); }
  }

  async function onCancel(orderId: bigint) {
    setError(null);
    if (!deployment) return;
    try {
      await writeContractAsync({
        address: deployment.contracts.DarkpoolEngine, abi: DARK,
        functionName: "cancelOrder", args: [orderId],
      });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="grid grid-cols-2 gap-8">
      <div>
        <h1 className="text-2xl font-semibold mb-4">Submit dark order</h1>
        <div className="space-y-4 bg-noir-gray border border-noir-line rounded p-6">
          <Field label="Market">
            <Select value={marketId} onChange={(e) => setMarketId(Number(e.target.value))}>
              {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.symbol}</option>)}
            </Select>
          </Field>
          <Field label="Side">
            <div className="flex gap-2">
              <button className={`flex-1 py-2 rounded border ${isLong ? "border-noir-green bg-noir-green/20 text-noir-green" : "border-noir-line text-noir-mute"}`} onClick={() => setIsLong(true)}>Long</button>
              <button className={`flex-1 py-2 rounded border ${!isLong ? "border-noir-red bg-noir-red/20 text-noir-red" : "border-noir-line text-noir-mute"}`} onClick={() => setIsLong(false)}>Short</button>
            </div>
          </Field>
          <Field label="Size"><Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="10" /></Field>
          <Field label="Collateral (USDCx)"><Input value={collateral} onChange={(e) => setCollateral(e.target.value)} placeholder="1000" /></Field>
          <Field label="Limit price"><Input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="3000" /></Field>
          <Button onClick={onSubmit} disabled={isPending || !proof?.allowlisted}>Submit dark order</Button>
          {error && <p className="text-xs text-noir-red">{error}</p>}
        </div>
      </div>
      <div>
        <h1 className="text-2xl font-semibold mb-4">My active orders ({orders.length})</h1>
        {orders.length === 0 ? <p className="text-noir-mute text-sm">No active orders.</p> : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id.toString()} className="bg-noir-gray border border-noir-line rounded p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm">#{o.id.toString()} · {marketById(o.marketId)?.symbol} · <span className={o.isLong ? "text-noir-green" : "text-noir-red"}>{o.isLong ? "Long" : "Short"}</span></div>
                  <div className="text-xs text-noir-mute mt-1 flex gap-4">
                    size: <EncryptedValue handle={o.sizeHandle} contractAddr={deployment?.contracts.DarkpoolEngine} />
                    limit: <EncryptedValue handle={o.limitPriceHandle} contractAddr={deployment?.contracts.DarkpoolEngine} />
                  </div>
                </div>
                <Button variant="danger" onClick={() => onCancel(o.id)}>Cancel</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build sanity** — `npm run build` clean.

- [ ] **Step 4: CHANGELOG + commit**

```markdown
- **Added**: `frontend/src/pages/Darkpool.tsx`,
  `frontend/src/hooks/useDarkOrders.ts`. Submit dark order form with
  3 encrypted inputs (size, collateral, limitPrice) wrapped in the
  SubmitOrderInputs struct. Live orders list with cancel + per-row
  encrypted-value reveal.
  **Files**: `frontend/src/pages/Darkpool.tsx`,
  `frontend/src/hooks/useDarkOrders.ts`.
```

Commit `feat(frontend): Darkpool page (submit + cancel)`.

---

### Task 8: Manual integration smoke

**Goal:** prove the frontend works end-to-end against a running local stack. Document a runbook for the demo video.

- [ ] **Step 1: Run the stack**

In separate terminals (or `&` in background) — start each from `/Users/ram/Desktop/NoirPerp`:

```bash
# 1. Hardhat node (in-process FHEVM mock)
cd contracts && npx hardhat node &
sleep 5
# 2. Deploy (writes deployments/local.json)
cd contracts && npx hardhat run scripts/deploy-local.ts --network localhost
# 3. compliance-backend
cd compliance-backend && npm start &
# 4. Add admin's address to compliance allowlist
curl -X POST http://localhost:4001/admin/add \
  -H "Content-Type: application/json" \
  -H "x-api-key: local-dev-secret-CHANGE-IN-PROD" \
  -d '{"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}'
# 5. (Optional) oracle-relayer
cd oracle-relayer && npm start &
# 6. Frontend
cd frontend && npm run dev
```

- [ ] **Step 2: In browser**

1. Open `http://127.0.0.1:5173`
2. Connect MetaMask to Hardhat (chainId 31337, RPC http://127.0.0.1:8545). Import the admin private key (`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`).
3. Compliance page: should show "Allowlisted".
4. Portfolio page: wallet token balance shows admin's mintPlaintext'd amount (if any was minted) — vault balance "Reveal" button click should decrypt to the deposit amount (0 if no deposits).
5. Trade page: enter size=10, collateral=1000, market=ETH, Long. Click "Open position". Sign in MetaMask. After confirmation, Portfolio should show 1 active position.
6. Trade page: click "Close" on the new position. Confirm in MetaMask. Position should disappear from Portfolio.
7. Liquidity page: addLiquidity(100) → confirm → totalShares should increase.
8. Darkpool page: submit a dark order → should appear in active orders → cancel it → should disappear.

**Pass criteria**: every step completes without browser console errors. Reveal buttons return non-zero plaintexts (proves userDecrypt works against the FHEVM mock — though note the local-mock branch in relayer.ts returns 0n; full FHE round-trip lights up on Sepolia in Phase 9).

**Anticipated issues**:
- userDecrypt fails on local mock: documented Phase 8 limitation — local mode is for UI testing.
- MetaMask "wrong chain": chainId 31337 must be added manually.
- CORS error from compliance-backend: backend doesn't set CORS by default. If hit, add `app.use((_req, res, next) => { res.header("Access-Control-Allow-Origin", "*"); next(); })` in `compliance-backend/src/server.ts`.

- [ ] **Step 3: Document runbook** in `frontend/README.md`

Create `frontend/README.md` with the exact commands above + a "Demo flow" section listing the 7 click-through steps.

- [ ] **Step 4: CHANGELOG + commit**

```markdown
- **Added**: `frontend/README.md` runbook for local stack +
  click-through demo flow (7 steps). Smoke verified manually:
  pages render, wallet connects, Trade open + close cycles correctly,
  encrypted values reveal via mock userDecrypt (returns 0n on
  local — full FHE round-trip lights up on Sepolia in Phase 9).
  **Files**: `frontend/README.md`.
```

If the smoke uncovers a bug needing a code fix, include it in the same commit.

Commit `docs(frontend): runbook + manual integration smoke`.

---

### Task 9: Tier 1 audit (mandatory phase gate)

- [ ] **Step 1: Spec compliance reviewer**

Use Agent tool, subagent_type=general-purpose, model=sonnet. Prompt:
> Review Phase 8 (frontend) against `/Users/ram/Desktop/NoirPerp/docs/plans/2026-04-25-phase-8-frontend.md` and `/Users/ram/Desktop/NoirPerp/docs/specs/2026-04-24-noirperp-design.md` §3, §5.1, §5.5, §10. Plan documents 6 spec deviations. Verify all 5 pages exist + render + cover their critical interactions. Verify FHE encrypt/decrypt flows are wired through the relayer SDK (not bypassed). Verify Compliance page calls the backend's /proof/:address. Verify openPosition tx includes complianceProof from useComplianceProof. Report ✅ compliant or ❌ issues with file:line.

- [ ] **Step 2: Code quality reviewer**

> Code-quality review of Phase 8 frontend. Check: TypeScript strict, no `any` leaks (especially in EncryptedValue's userDecrypt call signature — the relayer SDK's userDecrypt API is NOT well-typed and `any` may be necessary, but flag if it leaks beyond that boundary). XSS posture: all user-controlled or fetched content rendered through React's default escaping (no raw HTML injection APIs). Address validation before contract calls. Tx error handling — every writeContractAsync has try/catch with user-visible error. wagmi v2 + react-query patterns: no manual state where useReadContract/useWriteContract suffice. Bundle size sanity (no enormous accidental imports — print `du -sh frontend/dist/assets`). React hooks rules followed (no conditional hooks). Report APPROVED / APPROVED_WITH_MINOR_FIXES / NEEDS_REWORK.

- [ ] **Step 3: Address findings inline**

---

### Task 10: Phase 8 tick + merge

- [ ] **Step 1: Run all builds**

```bash
cd /Users/ram/Desktop/NoirPerp/frontend && npm run build 2>&1 | tail -3
cd /Users/ram/Desktop/NoirPerp/contracts && npx hardhat test 2>&1 | tail -3
cd /Users/ram/Desktop/NoirPerp/bot && npm run build 2>&1 | tail -3
cd /Users/ram/Desktop/NoirPerp/oracle-relayer && npm run build 2>&1 | tail -3
cd /Users/ram/Desktop/NoirPerp/compliance-backend && npm run build 2>&1 | tail -3
```

All clean. Test counts unchanged from Phase 7 (288 contracts + 38 off-chain).

- [ ] **Step 2: Tick PROGRESS.md**

Replace:
```markdown
- [ ] **Phase 8 — Frontend**
  Plan: *(not yet written)*
```
with:
```markdown
- [x] **Phase 8 — Frontend** ✅ (2026-04-XX)
  Plan: `docs/plans/2026-04-25-phase-8-frontend.md`
  Completion criteria met: Vite + React 18 + Tailwind + wagmi 2 +
  RainbowKit + Zama relayer SDK 0.4.1. 5 pages: Trade (FHE-encrypted
  open + close), Liquidity (AMM add/request-withdraw + encrypted
  shares), Darkpool (3-input encrypted submit), Portfolio (encrypted
  reveal of vault balance + position size/entry/collateral),
  Compliance (KYC status + proof fetch from backend). Tier 1 audit
  passed. 6 documented deviations: no test suite, no charts, no
  mobile, single dark theme, KYC stub UI, no tx history page.
```

- [ ] **Step 3: CHANGELOG complete entry**

```markdown
### Phase 8 complete ✅ (2026-04-XX)

- **Frontend live** at `http://127.0.0.1:5173` (local dev):
  - Trade, Liquidity, Darkpool, Portfolio, Compliance pages
  - wagmi 2 + RainbowKit wallet
  - Zama relayer SDK 0.4.1 (lazy-loaded on Sepolia, mocked on local)
  - Tailwind dark theme (`noir-*` palette)
- **Local mode caveat**: userDecrypt against the local mock returns
  0n — the frontend's local mode tests UI shell + tx wiring only.
  Real FHE encrypt/decrypt round-trips work end-to-end on Sepolia
  (lit up in Phase 9).
- **Tier 1 audit**: passed.
- **Spec deviations**:
  1. No frontend test suite (manual smoke only)
  2. No charts / orderbook UI
  3. Desktop-only (no responsive pass)
  4. Single dark theme
  5. KYC onboarding is a stub (mailto)
  6. No tx history page (RainbowKit + block explorer suffice)
- **Ready for Phase 9** (integration + audit + Sepolia deploy).
```

- [ ] **Step 4: Commit + merge**

```bash
cd /Users/ram/Desktop/NoirPerp && git add PROGRESS.md CHANGELOG.md && git -c user.email=developer@randao.net -c user.name="Ram" commit -q -m "docs: tick Phase 8 complete — frontend live

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" && git checkout master && git merge --ff-only phase-8-frontend
```

---

## Appendix A — Why no frontend test suite

Frontend tests provide poor signal-per-cost for this project:
- The contracts (security-critical) have 288 tests + Tier 1 audits + Slither/Mythril (Phase 9).
- The off-chain services have 38 tests + Tier 1 audit (Phase 7).
- The frontend is the *demo surface*: every contract address change, every ABI tweak, every relayer SDK upgrade requires re-testing the UI manually anyway. Component tests would either lag the real behavior (mocking the relayer SDK) or duplicate the integration smoke (Task 8).
- Time-to-submission pressure: better to ship a working UI manually verified than a test suite that delays the demo video.

This is a deliberate scope decision; not a quality gap. Phase 9 will run the full stack end-to-end on Sepolia as the integration test.

## Appendix B — Sepolia wiring (for Phase 9)

Phase 9 will:
1. Deploy contracts to Sepolia + write `contracts/deployments/sepolia.json`.
2. Set `VITE_DEPLOYMENT_NETWORK=sepolia` + `VITE_RPC_URL=<sepolia RPC>` + `VITE_WC_PROJECT_ID=<wc id>`.
3. The lazy-import branch of `getRelayerInstance` activates `createInstance({chainId:11155111, networkUrl})`.
4. `userDecrypt` makes a real KMS round-trip; demo video records this for the submission.
5. Vercel deploy: `npm run build && vercel --prod`.

No code changes needed to lift to Sepolia — only env values + the deployment.json file.

## Appendix C — Troubleshooting

**`useReadContract` returns undefined forever**: check `query.enabled` is set when args depend on `address` (must be `!!address && !!deployment`).

**MetaMask shows wrong account when admin signs**: Hardhat default mnemonic produces deterministic addresses; connect via "Custom RPC" with chainId 31337 + import account #0 (admin).

**Build error: "tuple type unsupported in human-readable ABI"**: viem's `parseAbi` may reject inline tuples in `function submitOrder(tuple(...) inputs, ...)`. Workaround: use the JSON ABI form for that one entry, or split into a struct definition first.

**Deployment.json missing at build**: the Vite alias `@deployments/local.json` resolves at build time. If the file doesn't exist, the build fails with a module-not-found. Ensure `cd contracts && npx hardhat run scripts/deploy-local.ts` ran successfully before `cd frontend && npm run build`.
