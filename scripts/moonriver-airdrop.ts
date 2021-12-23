import { ethers, Contract, BigNumber } from "ethers";
import { legos } from "@studydefi/money-legos";
import { writeFile } from "fs";
import fetch from "cross-fetch";

const MINIMUM_BALANCE = 50; // The minimum USD value required for users to qualify for the airdrop

interface TransferEventDecoded {
  from: string;
  to: string;
  amount: BigNumber;
}

const getJarBalances = async (jar, provider) => {
  const jarContract = new Contract(jar.contract, legos.erc20.abi, provider); // we only need the Transfer() event from the abi

  const oldestBlock = 946000; // our earliest activity was on block 946029 [https://moonriver.moonscan.io/tx/0x542c17ebdb86a4154c86852f5994f3af5254f45b7ea2406512b82f90f3580ee8]
  const latestBlock = await provider.getBlockNumber();
  const chunkSize = 1e3;

  let transferEvents: TransferEventDecoded[] = [];
  let users = {};
  let promises: Promise<any>[] = [];
  for (let i = oldestBlock; i < latestBlock; i += chunkSize) {
    if (i > latestBlock) i = latestBlock;
    const res = jarContract.queryFilter(
      jarContract.filters.Transfer(),
      i,
      i + chunkSize - 1
    );
    promises.push(res);
  }

  console.log(`Getting jar info (${jar.id}) ...`);
  const responses = await Promise.all(promises);

  responses.forEach((res) => {
    const decoded: TransferEventDecoded[] = res.map((event) => {
      const eventData = event.decode(event.data, event.topics);
      return {
        from: eventData[0],
        to: eventData[1],
        amount: eventData[2],
      };
    });
    transferEvents = [...transferEvents, ...decoded];
  });

  // instantiate users addresses
  transferEvents.forEach((tx) => {
    users[tx.to] = BigNumber.from(0);
    users[tx.from] = BigNumber.from(0);
  });
  // deposits & withdrawals
  transferEvents.forEach((tx) => {
    users[tx.to] = users[tx.to].add(tx.amount);
    users[tx.from] = users[tx.from].sub(tx.amount);
  });

  // convert balances to usd value
  Object.keys(users).forEach((user) => {
    const balance = parseFloat(ethers.utils.formatEther(users[user])); // convert to number
    const usdValue = balance * jar.depositToken.price * jar.details.ratio;
    users[user] = usdValue;
  });

  // cleanup burn address & 0 balances
  Object.keys(users).forEach((user) => {
    if (
      users[user] < MINIMUM_BALANCE ||
      user === "0x0000000000000000000000000000000000000000"
    )
      delete users[user];
  });

  return users;
};

const main = async () => {
  const pfcoreApi =
    "https://f8wgg18t1h.execute-api.us-west-1.amazonaws.com/prod/protocol/pfcore/";
  const response = await fetch(pfcoreApi);
  const pfJson = await response.json();

  // get only Moonriver jars that are active
  const jars = pfJson.assets.jars.filter(
    (x) => x.chain === "moonriver" && x.enablement === "enabled"
  );

  let jarsUsersBalances = {};

  const provider = new ethers.providers.JsonRpcProvider(
    "https://rpc.moonriver.moonbeam.network"
  );

  for (let i = 0; i < jars.length; i++) {
    const usersBalances = await getJarBalances(jars[i], provider);
    jarsUsersBalances[jars[i].id] = usersBalances;
  }

  // aggregate jars balances into a single list
  const finalList = {};
  Object.keys(jarsUsersBalances).forEach((jarId) => {
    Object.keys(jarsUsersBalances[jarId]).forEach((user) => {
      finalList[user] = finalList[user] ?? 0;
      finalList[user] += jarsUsersBalances[jarId][user];
    });
  });

  const outputPath = "./output/moonriver-airdrop.json";
  writeFile(outputPath, JSON.stringify(finalList, null, 4), (err) => {
    if (err) console.log(err);
  });
  console.log("\nOutput file created at: " + outputPath);
};

main();
