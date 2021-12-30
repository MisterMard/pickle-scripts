import { ethers, Contract } from "ethers";
import proxyAbi from "../abis/gaugeProxy.json";
import { legos } from "@studydefi/money-legos";
import fetch from "cross-fetch";
import { writeFile } from "fs";

interface UsersInfo {
  [userAddress: string]: { totalPaid: number; totalTxs: number };
}

const OUTPUT_PATH = "./output/dill-gas-spenders.json";
const dillAddr = "0xbBCf169eE191A1Ba7371F30A1C344bFC498b29Cf";
const proxyAddr = "0x2e57627ACf6c1812F99e274d0ac61B786c19E74f";
const provider = new ethers.providers.JsonRpcProvider(
  "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161"
);
const etherscanProvider = new ethers.providers.EtherscanProvider();
const dillContract = new Contract(dillAddr, legos.erc20.abi, provider);
const proxyContract = new Contract(proxyAddr, proxyAbi, provider);
const pfcoreApi =
  "https://f8wgg18t1h.execute-api.us-west-1.amazonaws.com/prod/protocol/pfcore/";
let errorOccurred = false;

// returns an object of all DILL holders with a DILL balance > 0
// takes a list of all the addresses that have interacted with the DILL contract as an argument
const getCurrentDillHolders = async (addresses: string[]) => {
  const currentDillHolders = {};
  await Promise.all(
    addresses.map(async (address) => {
      let bal = await dillContract.balanceOf(address);
      bal.isZero()
        ? 0
        : (currentDillHolders[address] = parseFloat(
            ethers.utils.formatEther(bal)
          ));
    })
  );
  return currentDillHolders;
};

// get all addresses that have interacted with a contract
const getContractUsersInfo = async (contractAddress: string) => {
  const contractTxHistory = await etherscanProvider.getHistory(contractAddress);

  // get the actual gas amount used + effective gas price from the txs receipts
  const receipts = await Promise.all(
    contractTxHistory.map((tx) => provider.getTransactionReceipt(tx.hash))
  );

  const txs = receipts.map((receipt, idx) => {
    return {
      hash: receipt.transactionHash,
      from: receipt.from,
      txFee: receipts[idx].gasUsed.mul(receipts[idx].effectiveGasPrice),
    };
  });

  let users = {};
  txs.forEach((tx) => {
    users[tx.from] = {
      totalPaid: users[tx.from]
        ? users[tx.from].totalPaid.add(tx.txFee)
        : tx.txFee,
      totalTxs: users[tx.from] ? users[tx.from].totalTxs + 1 : 1,
    };
  });

  // convert tx cost to number
  Object.keys(users).forEach((user) => {
    users[user] = {
      totalPaid: parseFloat(
        ethers.utils.formatUnits(users[user].totalPaid, 18)
      ),
      totalTxs: users[user].totalTxs,
    };
  });

  const usersFiltered: UsersInfo = users;
  return usersFiltered;
};

const getJarUsersInfo = async () => {
  const response = await fetch(pfcoreApi);
  const pfJson = await response.json();

  // get only mainnet jars
  const jars: Array<any> = pfJson.assets.jars.filter((x) => x.chain === "eth");

  const jarsUsersInfo = {};
  for (let jar in jars) {
    console.log(
      `Getting users info (${+jar + 1}/${jars.length}) (${jars[jar].id})`
    );
    const jarUsers = await getContractUsersInfo(jars[jar].contract);
    Object.keys(jarUsers).forEach((user) => {
      const prev = jarsUsersInfo[user];
      const current = prev
        ? {
            totalPaid: prev.totalPaid + jarUsers[user].totalPaid,
            totalTxs: prev.totalTxs + jarUsers[user].totalTxs,
          }
        : jarUsers[user];

      jarsUsersInfo[user] = current;
    });
  }
  return jarsUsersInfo;
};

const getGaugeUsersInfo = async () => {
  const depositTokens = await proxyContract.tokens();
  const gaugesAddresses = await Promise.all(
    depositTokens.map((token) => proxyContract.getGauge(token))
  );

  const gaugesUsersInfo = {};
  for (let i in gaugesAddresses) {
    console.log(
      `Getting users info (${+i + 1}/${gaugesAddresses.length}) (${
        gaugesAddresses[i]
      })`
    );
    const gaugeUsers = await getContractUsersInfo(gaugesAddresses[i]);
    Object.keys(gaugeUsers).forEach((user) => {
      const prev = gaugesUsersInfo[user];
      const current = prev
        ? {
            totalPaid: prev.totalPaid + gaugeUsers[user].totalPaid,
            totalTxs: prev.totalTxs + gaugeUsers[user].totalTxs,
          }
        : gaugeUsers[user];

      gaugesUsersInfo[user] = current;
    });
  }
  return gaugesUsersInfo;
};

const filterNonDillHolders = (usersInfo: UsersInfo, dillHolders: string[]) => {
  Object.keys(usersInfo).forEach(
    (user) => !dillHolders.includes(user) && delete usersInfo[user]
  );
};

const sortTop100 = (usersInfo: UsersInfo) => {
  const tempArr = Object.keys(usersInfo).map((user) => {
    return {
      address: user,
      totalPaid: usersInfo[user].totalPaid,
      totalTxs: usersInfo[user].totalTxs,
    };
  });

  const result = tempArr
    .sort(function (a, b) {
      return b.totalPaid - a.totalPaid;
    })
    .slice(0, 100);
  return result;
};

const main = async () => {
  const top100HighestGasSpenders = {};
  try {
    console.log(`Getting users info (1/1) (DILL)`);
    const dillUsersInfo = await getContractUsersInfo(dillAddr);
    const dillHoldersWithBalance = await getCurrentDillHolders(
      Object.keys(dillUsersInfo)
    );
    const dillHoldersAddresses = Object.keys(dillHoldersWithBalance);
    filterNonDillHolders(dillUsersInfo, dillHoldersAddresses);

    const jarsUsersInfo = await getJarUsersInfo();
    filterNonDillHolders(jarsUsersInfo, dillHoldersAddresses);

    const gaugesUsersInfo = await getGaugeUsersInfo();
    filterNonDillHolders(gaugesUsersInfo, dillHoldersAddresses);

    top100HighestGasSpenders["dill"] = sortTop100(dillUsersInfo);
    top100HighestGasSpenders["jars"] = sortTop100(jarsUsersInfo);
    top100HighestGasSpenders["gauges"] = sortTop100(gaugesUsersInfo);

    writeFile(
      OUTPUT_PATH,
      JSON.stringify(top100HighestGasSpenders, null, 4),
      (err) => {
        if (err) console.log(err);
      }
    );
    console.log("\nOutput file created at: " + OUTPUT_PATH);
  } catch (error) {
    console.error(error);
    errorOccurred = true;
  }
  console.log(
    `\n${"-".repeat(50)}\n${
      errorOccurred ? "AN ERROR OCCURRED, PLEASE TRY AGAIN !" : "All good!"
    }\n${"-".repeat(50)}\n`
  );
};

main();
