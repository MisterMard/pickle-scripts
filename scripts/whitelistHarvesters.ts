import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract, Wallet } from "ethers";

const PRIVATE_KEY = "";

const abi = [
  {
    type: "function",
    stateMutability: "nonpayable",
    outputs: [],
    name: "whitelistHarvesters",
    inputs: [
      { type: "address[]", name: "_harvesters", internalType: "address[]" },
    ],
  },
];
const addresses = [
  "0xe8C3510560cF1b7720d22Ae133924f281483CB9d",
  "0x6a79199B728e243B178ddaedeCACC6c5862e2c48",
  "0x6CeF89a9B43D1b47709b6e590B55a5a3CAA55690",
];
const tsukeAddr = "0x0f571D2625b503BB7C1d2b5655b483a2Fa696fEf"
const main = async () => {
  const provider = new JsonRpcProvider("https://mainnet.aurora.dev");
  const signer = new Wallet(PRIVATE_KEY, provider);
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    const contract = new Contract(addr, abi, signer);
    await contract.whitelistHarvesters([tsukeAddr]);
  }
};

main();
