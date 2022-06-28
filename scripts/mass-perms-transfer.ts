import { JsonRpcProvider, TransactionResponse } from "@ethersproject/providers";
import { Contract, ContractInterface, Wallet } from "ethers";
import readLine from "readline-sync";
import fetch from "cross-fetch";
import {
  Contract as MultiContract,
  MultiProvider,
  setMulticallAddress,
} from "ethers-multiprovider";
import controllerAbi from "../abis/controller.json";
import strategyAbi from "../abis/strategy.json";
import jarAbi from "../abis/jar.json";

const defaultMultisig = "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C";
let errors: string[] = [];
const main = async () => {
  let privateKey = readLine.question("Enter your private key: ");
  const wallet = new Wallet(privateKey);
  console.log("Address to be checked is: " + wallet.address);
  await propagateAddresses();
  await start(wallet);
  console.log("\n\n+++++++++++++++++\nREMAINING PERMS SUMMARY\n");
  console.log(errors.join("\n"));
};

const propagateAddresses = async () => {
  const pfcore = await fetch(
    "https://api.pickle.finance/prod/protocol/pfcore/"
  ).then(async (x) => await x.json());

  // extract addresses from pfcore
  pfcore.assets.jars.forEach((jar) => {
    const chain = jar.chain;
    const jarAddr = jar.contract.toLowerCase();
    const stratAddr = jar.details?.strategyAddr?.toLowerCase();
    const controller = jar.details?.controller?.toLowerCase();
    if (!addresses[chain]) {
      addresses[chain] = {
        strats: [],
        controllers: [],
        jars: [],
        multisig: defaultMultisig,
        rpc: undefined,
        chainId: undefined,
        multicallAddress: undefined,
      };
    }
    addresses[chain].jars.push(jarAddr);
    addresses[chain].strats.push(stratAddr);
    addresses[chain].controllers.push(controller);
  });

  // cleanup duplicates
  Object.keys(addresses).forEach((chain) => {
    addresses[chain].controllers = [
      ...new Set(addresses[chain].controllers),
    ].filter((x) => x);
    addresses[chain].jars = [...new Set(addresses[chain].jars)].filter(
      (x) => x
    );
    addresses[chain].strats = [...new Set(addresses[chain].strats)].filter(
      (x) => x
    );
  });

  // extract rpcs & multicall addresses
  pfcore.chains.forEach((chain) => {
    addresses[chain.network].rpc = chain.rpcs[0];
    addresses[chain.network].multicallAddress = chain.multicallAddress;
    addresses[chain.network].chainId = chain.chainId;
  });
};
const start = async (wallet: Wallet) => {
  for (const chainName in addresses) {
    if (Object.prototype.hasOwnProperty.call(addresses, chainName)) {
      const chainData = addresses[chainName];

      const provider = new JsonRpcProvider(chainData.rpc);

      const signer = wallet.connect(provider);

      let collisions: Collisions;
      try {
        collisions = await fetchChainCollisions(
          chainData,
          signer.address,
          provider
        );
      } catch (error) {
        console.log("Something went wrong on :" + chainName);
        console.log(error);
        continue;
      }
      const tempTotalCalls = Object.keys(collisions).map((col) => {
        return Object.keys(collisions[col]).reduce((prev, cur) => {
          const calls = collisions[col][cur];
          return calls.length + prev;
        }, 0);
      });
      const total = tempTotalCalls.reduce((prev, cur) => cur + prev, 0);
      if (!total) {
        console.log("No matches found on " + chainName);
        continue;
      }
      console.log(`Chain: ${chainName}`);
      if (
        !readLine.keyInYNStrict(
          `Transfer all ${total} permissions on ${chainName} to multisig?`
        )
      )
        continue;

      // Strategies
      await transferOneCollisionTypePerms(
        "Strategy",
        collisions.strats,
        chainData.multisig,
        signer,
        strategyAbi
      );
      // Controllers
      await transferOneCollisionTypePerms(
        "Controller",
        collisions.controllers,
        chainData.multisig,
        signer,
        controllerAbi
      );
      // Jars
      await transferOneCollisionTypePerms(
        "Jar",
        collisions.jars,
        chainData.multisig,
        signer,
        jarAbi
      );

      console.log(`Chain: ${chainName} done!\n`);
    }
  }
};

const fetchChainCollisions = async (
  chainData,
  wallet: string,
  provider: JsonRpcProvider
): Promise<Collisions> => {
  chainData.multicallAddress &&
    setMulticallAddress(chainData.chainId, chainData.multicallAddress);
  const multiProvider = new MultiProvider(chainData.chainId, {
    multicallAddress: chainData.multicallAddress,
    batchSize: 50,
  });
  await multiProvider.addProvider(provider);

  const strats: { [addr: string]: [permCall: string] } = {};
  const jars: { [addr: string]: [permCall: string] } = {};
  const controllers: { [addr: string]: [permCall: string] } = {};

  const controllersProms = chainData.controllers.map(async (controller) => {
    // treasury, strategist, governance, timelock, devfund
    const contract = new MultiContract(controller, controllerAbi);
    const [strategist, timelock, treasury, governance, devfund]: string[] =
      await multiProvider.all([
        contract.strategist(),
        contract.timelock(),
        contract.treasury(),
        contract.governance(),
        contract.devfund(),
      ]);
    if (treasury.toLowerCase() === wallet.toLowerCase()) {
      controllers[controller]
        ? controllers[controller].push("setTreasury")
        : (controllers[controller] = ["setTreasury"]);
    }
    if (devfund.toLowerCase() === wallet.toLowerCase()) {
      controllers[controller]
        ? controllers[controller].push("setDevFund")
        : (controllers[controller] = ["setDevFund"]);
    }
    if (timelock.toLowerCase() === wallet.toLowerCase()) {
      controllers[controller]
        ? controllers[controller].push("setTimelock")
        : (controllers[controller] = ["setTimelock"]);
    }
    if (strategist.toLowerCase() === wallet.toLowerCase()) {
      controllers[controller]
        ? controllers[controller].push("setStrategist")
        : (controllers[controller] = ["setStrategist"]);
    }
    if (governance.toLowerCase() === wallet.toLowerCase()) {
      controllers[controller]
        ? controllers[controller].push("setGovernance")
        : (controllers[controller] = ["setGovernance"]);
    }
  });
  const stratsProms = chainData.strats.map(async (strat) => {
    // governance, strategist, timelock
    const contract = new MultiContract(strat, strategyAbi);
    const [governance, strategist, timelock] = await multiProvider.all([
      contract.governance(),
      contract.strategist(),
      contract.timelock(),
    ]);

    if (timelock.toLowerCase() === wallet.toLowerCase()) {
      strats[strat]
        ? strats[strat].push("setTimelock")
        : (strats[strat] = ["setTimelock"]);
    }
    if (strategist.toLowerCase() === wallet.toLowerCase()) {
      strats[strat]
        ? strats[strat].push("setStrategist")
        : (strats[strat] = ["setStrategist"]);
    }
    if (governance.toLowerCase() === wallet.toLowerCase()) {
      strats[strat]
        ? strats[strat].push("setGovernance")
        : (strats[strat] = ["setGovernance"]);
    }
  });
  const jarsProms = chainData.jars.map(async (jar) => {
    // governance, timelock
    const [governance,timelock] = await multiProvider.all([
      new MultiContract(jar, jarAbi).governance(),
      new MultiContract(jar, jarAbi).timelock(),
    ]);
    if (governance.toLowerCase() === wallet.toLowerCase()) {
      jars[jar]
        ? jars[jar].push("setGovernance")
        : (jars[jar] = ["setGovernance"]);
    }
    if (timelock.toLowerCase() === wallet.toLowerCase()) {
      jars[jar]
        ? jars[jar].push("setTimelock")
        : (jars[jar] = ["setTimelock"]);
    }
  });

  await Promise.all([controllersProms, stratsProms, jarsProms].flat());

  return { strats, jars, controllers };
};

const transferOneCollisionTypePerms = async (
  type: string,
  oneCollision: ContractWithCalls,
  multisig: string,
  signer: Wallet,
  abi: ContractInterface
) => {
  for (const contractAddr in oneCollision) {
    if (Object.prototype.hasOwnProperty.call(oneCollision, contractAddr)) {
      const calls = oneCollision[contractAddr];
      calls.length &&
        console.log(
          `Executing ${
            calls.length
          } calls on ${type.toLowerCase()} ${contractAddr}`
        );
      const contract = new Contract(contractAddr, abi, signer);
      for (const call of calls) {
        console.log(`Calling: ${call}(${multisig})`);
        try {
          const txnResp: TransactionResponse = await contract[call](multisig);
          await txnResp.wait();
          console.log("Success!");
        } catch (error: any) {
          if (error.code === "UNPREDICTABLE_GAS_LIMIT") {
            console.log(
              `\nERROR: Failed executing txn!\nContract: ${contractAddr}\nMethod: ${type}.${call}(${multisig})`
            );
            console.log(
              `${signer.address} do not have the needed permissions.\n`
            );
            errors.push(
              `----------------------------\nContract: ${contractAddr}\nMethod: ${type}.${call}(${multisig}\n`
            );
          } else {
            console.log(
              `ERROR: Failed executing txn!\n${type}:${contractAddr}\nMethod: ${call}(${multisig})\n` +
                error
            );
            process.exit(1);
          }
        }
      }
    }
  }
};

let addresses: {
  [chain: string]: {
    strats: string[];
    controllers: string[];
    jars: string[];
    multisig: string;
    rpc?: string;
    multicallAddress?: string;
    chainId?: number;
  };
} = {
  eth: {
    strats: [],
    controllers: ["0x6847259b2B3A4c17e7c43C54409810aF48bA5210"],
    jars: [],
    multisig: "0x066419eaef5de53cc5da0d8702b990c5bc7d1ab3",
  },
  polygon: {
    strats: [],
    controllers: ["0x83074F0aB8EDD2c1508D3F657CeB5F27f6092d09"],
    jars: [],
    multisig: "0xeae55893cc8637c16cf93d43b38aa022d689fa62",
  },
  arbitrum: {
    strats: [],
    controllers: ["0x55d5bcef2bfd4921b8790525ff87919c2e26bd03"],
    jars: [],
    multisig: "0xf02ceb58d549e4b403e8f85fbbaee4c5dfa47c01",
  },
  okex: {
    strats: [],
    controllers: ["0xcf05d96b4c6c5a87b73f5f274dce1085bc7fdcc4"],
    jars: [],
    multisig: "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C",
  },
  moonriver: {
    strats: [],
    controllers: ["0xc3f393fb40f8cc499c1fe7fa5781495dc6fac9e9"],
    jars: [],
    multisig: "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C",
  },
  cronos: {
    strats: [],
    controllers: ["0xFa3Ad976c0bdeAdDe81482F5Fa8191aE1e7d84C0"],
    jars: [],
    multisig: "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C",
  },
  aurora: {
    strats: [],
    controllers: ["0xdc954e7399e9ADA2661cdddb8D4C19c19E070A8E"],
    jars: [],
    multisig: "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C",
  },
  metis: {
    strats: [],
    controllers: ["0xD556018E7b37e66f618A65737144A2ae2B98127f"],
    jars: [],
    multisig: "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C",
  },
  moonbeam: {
    strats: [],
    controllers: ["0x95ca4584eA2007D578fa2693CCC76D930a96d165"],
    jars: [],
    multisig: "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C",
  },
  optimism: {
    strats: [],
    controllers: ["0xa1d43d97fc5f1026597c67805aa02aae558e0fef"],
    jars: [],
    multisig: "0x7A79e2e867d36a91Bb47e0929787305c95E793C5",
  },
  fantom: {
    strats: [],
    controllers: ["0xc335740c951F45200b38C5Ca84F0A9663b51AEC6"],
    jars: [],
    multisig: "0xe4ee7edddbebda077975505d11decb16498264fb",
  },
  gnosis: {
    strats: [],
    controllers: ["0xe5E231De20C68AabB8D669f87971aE57E2AbF680"],
    jars: [],
    multisig: "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C",
  },
};

interface ContractWithCalls {
  [addr: string]: [permCall: string];
}
interface Collisions {
  strats: ContractWithCalls;
  jars: ContractWithCalls;
  controllers: ContractWithCalls;
}

main();
