import { JsonRpcProvider } from "@ethersproject/providers";
import { BigNumber, Contract, ethers } from "ethers";
import { MultiProvider, Contract as MultiContract } from "ethers-multiprovider";

const providerUrls = {
aurora: "https://mainnet.aurora.dev",
  optimism:
    "https://opt-mainnet.g.alchemy.com/v2/mk-iKUdTO7nJqOgCsa1E_bFYU7l6aecl",
};

const getTimestamp = async () => {
  const provider = new JsonRpcProvider(providerUrls.optimism);
  const hashes = [
    "0x89c02023031fe871fc49890f1fec0662a599b6f32efdd590b2e0c85dcb1093d0",
  ];
  for (let i = 0; i < hashes.length; i++) {
    const receipt: ethers.providers.TransactionReceipt = await provider.getTransactionReceipt(hashes[i]);
    const block = await provider.getBlock(receipt.blockNumber);
    console.log('\n  contract: "'+receipt.contractAddress+'",')
  console.log(`  startBlock: ${receipt.blockNumber}, startTimestamp: ${block.timestamp},`)
  }
}

const getAmountsOut = async () => {
  const abi = [
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
  ];

  const addresses = ["0xa132DAB612dB5cB9fC9Ac426A0Cc215A3423F9c9"];
  const provider = new JsonRpcProvider(providerUrls.optimism);
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    const contract = new Contract(addr, abi, provider);
    try {
      const ret = await contract.getAmountsOut("42257734937611963", [["0x4200000000000000000000000000000000000006", "0x3c8b650257cfb5f272f799f5e2b4e65093a11a05", false]]).then(x => x.toString());
      // console.log("Contract (" + addr + "): " + ret);
      console.log(ret);
    } catch (error) {
      console.log("Contract: " + addr + " returned an error");
      console.log(error);
    }
  }

}

const checkTokenBalance = async() =>{
  const abi = ["function balanceOf(address) view returns (uint256)"]
  const provider = new MultiProvider(1);
  await provider.initDefault();
  const contract = new MultiContract("0x429881672B9AE42b8EbA0E26cD9C73711b891Ca5",abi);
  const balance:BigNumber = await provider.all([contract.balanceOf("0xf696350f37cb8a1cc9c56ec5c8cff00a5e01fd40")]).then(x=>x[0]);
  console.log("balance: "+balance.toString());
  await provider.stop();
}

getTimestamp();
