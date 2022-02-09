import { ethers, Contract, BigNumber } from "ethers";
import {
  Contract as MulticallContract,
  Provider as MulticallProvider,
  setMulticallAddress,
} from "ethers-multicall";
import { legos } from "@studydefi/money-legos";
import { writeFile } from "fs";
import fetch from "cross-fetch";
import minichefAbi from "../abis/pickle-minichef.json";
import { Provider } from "@ethersproject/providers";
import * as dotenv from "dotenv";

dotenv.config();

const CHAIN = "eth";
const RPC_URL = `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`;
const EARLIEST_INTERACTION_BLOCK = 13_989_700; // creation of looks-eth jar

const getJarUsers = async (jarAddr: string, provider): Promise<string[]> => {
  const jarContract = new Contract(jarAddr, legos.erc20.abi, provider); // we only need the Transfer() event from the abi

  const oldestBlock = EARLIEST_INTERACTION_BLOCK;
  const latestBlock = await provider.getBlockNumber();
  const chunkSize = 1e6;

  let users: string[] = [];

  let responses = [];
  for (let i = oldestBlock; i < latestBlock; i += chunkSize) {
    const startBlock = i;
    let endBlock = i + chunkSize - 1;
    if (endBlock > latestBlock) endBlock = latestBlock;

    const res = jarContract.queryFilter(
      jarContract.filters.Transfer(),
      startBlock,
      endBlock
    );
    responses.push(await res);
  }

  responses.forEach((res) => {
    res.forEach((event) => {
      const eventData = event.decode(event.data, event.topics);
      users.push(eventData[0]);
      users.push(eventData[1]);
    });
  });

  const usersUnique = [...new Set(users)];

  return usersUnique;
};

const getJarTokenPrice = (jars: any, jarAddr: string): number => {
  const jar = jars.filter((jar) => jar.contract === jarAddr)[0];
  return jar.details.ratio * jar.depositToken.price;
};

const getJarBalances = async (
  pfJars: any,
  jarAddress: string,
  gaugeAddress: string,
  provider: Provider,
  multicallProvider: MulticallProvider
) => {
  let usersBalances = {};
  console.log(`Getting jar info (${jarAddress}) ...`);
  const addresses = await getJarUsers(jarAddress, provider);

  // delete the gauge address from the addresses list
  const index = addresses.indexOf(gaugeAddress);
  if (index > -1) {
    addresses.splice(index, 1);
  }

  const jarMultiContract = new MulticallContract(jarAddress, legos.erc20.abi);
  const gaugeMultiContract = new MulticallContract(
    gaugeAddress,
    legos.erc20.abi
  );

  const unstakedBalances = await multicallProvider.all(
    addresses.map((address) => jarMultiContract.balanceOf(address))
  );
  const stakedBalances = await multicallProvider.all(
    addresses.map((address) => gaugeMultiContract.balanceOf(address))
  );
  const summedBalances = unstakedBalances.map((ub, idx) => {
    const sumBN: BigNumber = ub.add(stakedBalances[idx]);
    const sum = parseFloat(ethers.utils.formatEther(sumBN));
    const value = sum * getJarTokenPrice(pfJars, jarAddress);
    return value;
  });
  addresses.forEach((address, idx) => {
    usersBalances[address] = usersBalances[address]
      ? usersBalances[address] + summedBalances[idx]
      : summedBalances[idx];
  });

  // cleanup 0 balances
  Object.keys(usersBalances).forEach((user) => {
    usersBalances[user] === 0 && delete usersBalances[user];
  });

  return usersBalances;
};

const main = async () => {
  try {
    const pfcoreApi = "https://api.pickle.finance/prod/protocol/pfcore/";
    const response = await fetch(pfcoreApi);
    const pfJson = await response.json();

    // get only Mainnet jars that are active
    const jars = pfJson.assets.jars.filter(
      (x) => x.chain === CHAIN && x.enablement === "enabled"
    );
    const pUNILOOKSETH = {
      jar: "0x69CC22B240bdcDf4A33c7B3D04a660D4cF714370",
      gauge: "0xb5fE3204aABe02475d5B9d3C52820f2169002124",
    };
    const pLOOKS = {
      jar: "0xb4EBc2C371182DeEa04B2264B9ff5AC4F0159C69",
      gauge: "0x06A566E7812413bc66215b48D6F26321Ddf653A9",
    };

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const multicallProvider = new MulticallProvider(provider);
    await multicallProvider.init();

    let finalList = {};
    finalList["pLooksEth"] = await getJarBalances(
      jars,
      pUNILOOKSETH.jar,
      pUNILOOKSETH.gauge,
      provider,
      multicallProvider
    );
    finalList["pLooks"] = await getJarBalances(
      jars,
      pLOOKS.jar,
      pLOOKS.gauge,
      provider,
      multicallProvider
    );

    // exclude the gauge address from the list
    Object.keys(finalList).forEach((jar) => {
      Object.keys(finalList[jar]).forEach((user) => {
        finalList[jar][user] === 0 && delete finalList[jar][user];
      });
    });

    // sort descendently
    const jarNames = Object.keys(finalList);
    const tempArr = Object.keys(finalList).map((jar) => {
      return Object.keys(finalList[jar]).map((user) => {
        return {
          address: user,
          balance: finalList[jar][user],
        };
      });
    });

    tempArr.forEach((jar, i) => {
      const sortedUsers = jar.sort(function (a, b) {
        return b.balance - a.balance;
      });
      finalList[jarNames[i]] = sortedUsers;
    });

    const outputPath = "./output/looks-snapshot.json";
    writeFile(outputPath, JSON.stringify(finalList, null, 4), (err) => {
      if (err) console.log(err);
    });
    console.log("\nOutput file created at: " + outputPath);
  } catch (error) {
    console.error(error);
  }
};

main();
