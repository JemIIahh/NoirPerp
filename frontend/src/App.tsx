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
