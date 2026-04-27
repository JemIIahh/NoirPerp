// Constructor args for Sepolia Oracle verification.
// Used via: npx hardhat verify --constructor-args scripts/oracle-verify-args.js --network sepolia <oracle-addr>
// The array argument can't be passed via shell positional args reliably,
// so we serialize it through a JS module instead (hardhat-verify's
// supported pattern for non-scalar args).
module.exports = [
  "0x87E69cA0D5b843e5f1aca9fF40c8b556665c6D67",
  [
    "0xaE7dc41284B3fB4E20fb4D99b6ae0ae9b1457c91",
    "0x9FC17e8Dc575caD212945F0d4d451693878d34dC",
    "0x0994E7B8cd8314110Da09173421901130e3090d2",
  ],
  90,
  50,
];
