import { JsonRpcProvider } from "@ethersproject/providers";
import { BigNumber, Contract, ethers } from "ethers";
import { MultiProvider, Contract as MultiContract } from "ethers-multiprovider";
import { ChainNetwork } from "picklefinance-core";
import readLine from "readline-sync";
import { getPickleModelJson, getProviderFor } from "./utils/helpers.js";
import clipboard  from "clipboardy";

const providerUrls = {
  aurora: "https://mainnet.aurora.dev",
  optimism:
    "https://opt-mainnet.g.alchemy.com/v2/mk-iKUdTO7nJqOgCsa1E_bFYU7l6aecl",
};

const promptChain = (): ChainNetwork => {
  const allChains = Object.keys(ChainNetwork)
  console.log("Choose a chain:");
  allChains.forEach((chain, idx) => console.log(`\t${idx}) ${chain}`))
  const choice = readLine.question("\tChoice: ", { limit: allChains.map((_, idx) => `${idx}`) });
  return ChainNetwork[allChains[choice]]
}

const getTimestamp = async () => {
  const chain = promptChain();
  const pfcore = await getPickleModelJson()
  const provider = getProviderFor(chain, pfcore);
  const txHash = readLine.question("\tEnter txn hash: ");

  const receipt: ethers.providers.TransactionReceipt = await provider.getTransactionReceipt(txHash);
  const block = await provider.getBlock(receipt.blockNumber);
  const result = `\n  contract: "${receipt.contractAddress}",\n  startBlock: ${receipt.blockNumber},\n  startTimestamp: ${block.timestamp},`;
  console.log("============ Result ==========")
  console.log(result + "\n");

  if (readLine.keyIn("Press [c] to copy the result, or any other key to continue..") === "c") {
    clipboard.writeSync(result);
    console.log("Result copied to clipboard.");
  }
}

const temp = async () => {
  const stakingRewardsAddr = "0xa17a8883da1abd57c690df9ebf58fc194edab66f";
  const provider = new ethers.providers.JsonRpcProvider("https://rpc.ankr.com/eth");
  const abi = ["event RewardPaid(address indexed user, uint256 reward)"];
  const contract = new Contract(stakingRewardsAddr, abi, provider);
  const fromBlock = 13541950;
  const toBlock = 13541960;

  // This will get us getReward() + exit() txns (they both emit RewardPaid() events)
  const events = await contract.queryFilter(contract.filters.RewardPaid(), fromBlock, toBlock);
  events.forEach(event => {
    const user = event.args.user;
    const ethAmountBN = event.args.reward;
    console.log(`From: ${event.address} To: ${user} EthAmount: ${parseFloat(ethers.utils.formatEther(ethAmountBN))}`);
  });
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

const checkTokenBalance = async () => {
  const abi = ["function balanceOf(address) view returns (uint256)"]
  const provider = new MultiProvider(1);
  await provider.initDefault();
  const contract = new MultiContract("0x429881672B9AE42b8EbA0E26cD9C73711b891Ca5", abi);
  const balance: BigNumber = await provider.all([contract.balanceOf("0xf696350f37cb8a1cc9c56ec5c8cff00a5e01fd40")]).then(x => x[0]);
  console.log("balance: " + balance.toString());
  await provider.stop();
}

export const miscMenu = async () => {
  let done: boolean = false;
  while (!done) {
    console.log("Choose an option:");
    console.log("\t1) getTimestamp");
    console.log("\t2) Print bad roles");
    console.log("\t3) Print an address roles");
    console.log("\t4) Print an address bad roles");
    console.log("\t0) Back.");
    const choice = readLine.question("\tChoice: ", { limit: ["1", "2", "3", "4", "0"] });

    switch (choice) {
      case "0":
        done = true;
        break;
      case "1":
        await getTimestamp();
        break;
      case "2":
        break;
      case "3":
        break;
      case "4":
        break;
      default:
        console.log("Wrong Choice!");
        break;
    }
  }

}
