import { ethers, Contract, BigNumber } from "ethers";
import dillAbi from "../abis/dill.json";
import { legos } from "@studydefi/money-legos";

const onlyUnique = (value, index, self) => {
  return self.indexOf(value) === index;
};

const getCurrentDillHolders = async (walletAddrs, contract) => {
  const currentDillHolders = [];
  for (const addr of walletAddrs) {
    const bal = await contract.callStatic["balanceOf"](null);
    bal > 0 ? currentDillHolders.push({ addr: addr, bal: bal }) : 0;
  }
  return currentDillHolders;
};

const getDillAddrs = async () => {
  const pickleAddr = "0x429881672B9AE42b8EbA0E26cD9C73711b891Ca5";
  const dillAddr = "0xbBCf169eE191A1Ba7371F30A1C344bFC498b29Cf";
  const provider = new ethers.providers.JsonRpcProvider(
    "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161"
  );
  const pickleContract = new Contract(pickleAddr, legos.erc20.abi, provider);
  const dillContract = new Contract(dillAddr, legos.erc20.abi, provider);
  // dillContract.callStatic["balanceOf"](null)
  const filterTo = pickleContract.filters.Transfer(null, dillAddr);
  const dillTxHistory = pickleContract.queryFilter(filterTo);
  const walletAddrList = [];
  for (const tx of await dillTxHistory) {
    walletAddrList.push(tx.args["src"]);
  }
  const uniqueWalletAddrs = walletAddrList.filter(onlyUnique);
  const currentDillHolders = [];
  await Promise.all(uniqueWalletAddrs.map(async (x) => {
      let bal = await dillContract.callStatic["balanceOf"](x)
      bal.isZero() ? 
        0 : 
        parseFloat(ethers.utils.formatEther(bal)) > 10 ? 
          currentDillHolders.push({'addr': x, 'bal': ethers.utils.formatEther(bal)}) : 
          0;
    return
    }
  ));
  return currentDillHolders;
};

export default getDillAddrs;
