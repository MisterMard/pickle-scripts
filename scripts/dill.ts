import { ethers, Contract, BigNumber } from "ethers";
import { legos } from "@studydefi/money-legos";


const onlyUnique = (value, index, self) => {
  return self.indexOf(value) === index;
}

const getDillAddrs = async() => {
    const pickleAddr = "0x429881672B9AE42b8EbA0E26cD9C73711b891Ca5";
    const dillAddr = "0xbBCf169eE191A1Ba7371F30A1C344bFC498b29Cf";
    const provider = new ethers.providers.JsonRpcProvider("https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161");
    const pickleContract = new Contract(pickleAddr, legos.erc20.abi, provider);
    const filterTo = pickleContract.filters.Transfer(null, dillAddr);
    const res = pickleContract.queryFilter(filterTo)
    const walletAddrList = [];
    for (const tx of await res) {
      walletAddrList.push(tx.args['src'])
    }
    const uniqueWalletAddrs = walletAddrList.filter(onlyUnique)
    console.log(uniqueWalletAddrs);
}

export default getDillAddrs;