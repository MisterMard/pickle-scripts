import { JsonRpcProvider } from "@ethersproject/providers";
import { BigNumber, Contract } from "ethers";

const providerUrls = {
  aurora: "https://mainnet.aurora.dev",
  optimism:
    "https://opt-mainnet.g.alchemy.com/v2/mk-iKUdTO7nJqOgCsa1E_bFYU7l6aecl",
};
const abi = [
  "function governance() view returns(address)",
  "function strategist() view returns(address)",
  "function observe(uint32[]) view returns(int56[], uint160[])",
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      {
        components: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "bool", name: "stable", type: "bool" },
        ],
        internalType: "struct Router.route[]",
        name: "routes",
        type: "tuple[]",
      },
    ],
    name: "getAmountsOut",
    outputs: [
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // "function getAmountsOut(uint256,tuple[]) view returns(uint256[])",
];
const addresses = ["0xa132DAB612dB5cB9fC9Ac426A0Cc215A3423F9c9"];
const main = async () => {
  const provider = new JsonRpcProvider(providerUrls.optimism);
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    const contract = new Contract(addr, abi, provider);
    try {
      const ret = await contract.getAmountsOut("42257734937611963",[["0x4200000000000000000000000000000000000006","0x3c8b650257cfb5f272f799f5e2b4e65093a11a05",false]]);
      // console.log("Contract (" + addr + "): " + ret);
      console.log(ret);
    } catch (error) {
      console.log("Contract: " + addr + " returned an error");
      console.log(error);
    }
  }
};

main();
