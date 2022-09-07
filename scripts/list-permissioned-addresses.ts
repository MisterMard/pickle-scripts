import fetch from "cross-fetch";
import { JsonRpcProvider } from "@ethersproject/providers";
import {
  Contract as MultiContract,
  MultiProvider,
  setMulticallAddress,
} from "ethers-multiprovider";
import controllerAbi from "../abis/controller.json";
import strategyAbi from "../abis/strategy.json";
import jarAbi from "../abis/jar.json";

const defaultMultisig = "0xaCfE4511CE883C14c4eA40563F176C3C09b4c47C";
const result: {
  [permissionedAddr: string]: {
    [chain: string]: {
      jar?: { contractAddr: string; perm: string }[];
      strat?: { contractAddr: string; perm: string }[];
      controller?: { contractAddr: string; perm: string }[];
    };
  };
} = {};
const contractsWithPerms: {
  [chain: string]: {
    jar?: { [contractAddr: string]: { [role: string]: string } };
    strat?: { [contractAddr: string]: { [role: string]: string } };
    controller?: { [contractAddr: string]: { [role: string]: string } };
  };
} = {};

const main = async () => {
  const pfcore = await fetch(
    "https://api.pickle.finance/prod/protocol/pfcore/"
  ).then(async (x) => await x.json());

  await propagateAddresses(pfcore);
  await start(pfcore);
  // printResultsDetailed();
  // printResultsSummary();
  printAddressPerms("0x4204FDD868FFe0e62F57e6A626F8C9530F7d5AD1");
};

const printAddressPerms = (address: string) => {
  const lens = {
    addr: 46,
    chain: 12,
    type: 12,
    perm: 12,
  };
  const fmtStrLen = (str: string, len: number) => {
    const pre = " ".repeat(Math.floor((len - str.length) / 2));
    const trail = " ".repeat(Math.ceil((len - str.length) / 2));
    return pre.concat(str).concat(trail);
  };
  console.log(
    `|${fmtStrLen("CHAIN", lens.chain)}|${fmtStrLen(
      "GOVERNANCE ADDRESS",
      lens.addr
    )}|${fmtStrLen("CONTRACT", lens.addr)}|${fmtStrLen("TYPE", lens.type)}|`
  );
  console.log("-".repeat(157));
  Object.keys(result[address]).forEach((chain) => {
    Object.keys(result[address][chain]).forEach((type) => {
      result[address][chain][type].forEach((perm) => {
        const governanceAddr = getContractGovernance(
          chain,
          type,
          perm.contractAddr
        );
        console.log(
          `|${fmtStrLen(chain, lens.chain)}|${fmtStrLen(
            governanceAddr,
            lens.addr
          )}|${fmtStrLen(perm.contractAddr, lens.addr)}|${fmtStrLen(
            type,
            lens.type
          )}|`
        );
      });
    });

    console.log("-".repeat(157));
  });
};

const getContractGovernance = (
  chain: string,
  contractType: string,
  contractAddr: string
): string => {
  return contractsWithPerms[chain][contractType][contractAddr]["governance"];
};

const printResultsSummary = () => {
  const lens = {
    addr: 46,
    chain: 57,
    owner: 10,
  };
  const fmtStrLen = (str: string, len: number) => {
    const pre = " ".repeat(Math.floor((len - str.length) / 2));
    const trail = " ".repeat(Math.ceil((len - str.length) / 2));
    return pre.concat(str).concat(trail);
  };
  console.log(
    `|${fmtStrLen("ADDRESS", lens.addr)}|${fmtStrLen(
      "CHAINS",
      lens.chain
    )}|${fmtStrLen("OWNER", lens.owner)}|`
  );
  console.log("-".repeat(117));
  Object.keys(result).forEach((permissionedAddr) => {
    const chains: string[][] = [];
    Object.keys(result[permissionedAddr]).forEach((chain, idx) => {
      chains[Math.floor(idx / 5)]
        ? chains[Math.floor(idx / 5)].push(chain)
        : (chains[Math.floor(idx / 5)] = [chain]);
    });
    console.log(
      `|${fmtStrLen(permissionedAddr, lens.addr)}|${fmtStrLen(
        chains[0].join(", "),
        lens.chain
      )}|${fmtStrLen("", lens.owner)}|`
    );
    if (chains.length > 1) {
      for (let i = 1; i < chains.length; i++) {
        console.log(
          `|${fmtStrLen("", lens.addr)}|${fmtStrLen(
            chains[i].join(", "),
            lens.chain
          )}|${fmtStrLen("", lens.owner)}|`
        );
      }
    }
    console.log("-".repeat(117));
  });
};

const printResultsDetailed = () => {
  const lens = {
    addr: 46,
    chain: 12,
    type: 12,
    perm: 12,
  };
  const fmtStrLen = (str: string, len: number) => {
    const pre = " ".repeat(Math.floor((len - str.length) / 2));
    const trail = " ".repeat(Math.ceil((len - str.length) / 2));
    return pre.concat(str).concat(trail);
  };
  console.log(
    `|${fmtStrLen("ADDRESS", lens.addr)}|${fmtStrLen(
      "CHAIN",
      lens.chain
    )}|${fmtStrLen("CONTRACT", lens.addr)}|${fmtStrLen(
      "TYPE",
      lens.type
    )}|${fmtStrLen("PERM", lens.perm)}|`
  );
  console.log("-".repeat(157));
  Object.keys(result).forEach((permissionedAddr) => {
    Object.keys(result[permissionedAddr]).forEach((chain) => {
      Object.keys(result[permissionedAddr][chain]).forEach((type) => {
        result[permissionedAddr][chain][type].forEach((perm) => {
          console.log(
            `|${fmtStrLen(permissionedAddr, lens.addr)}|${fmtStrLen(
              chain,
              lens.chain
            )}|${fmtStrLen(perm.contractAddr, lens.addr)}|${fmtStrLen(
              type,
              lens.type
            )}|${fmtStrLen(perm.perm, lens.perm)}|`
          );
        });
      });
    });
    console.log("-".repeat(157));
  });
};

const propagateAddresses = async (pfcore) => {
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
const extractResults = (
  chainCollisions: Collisions,
  chain: string,
  _pfcore: any
) => {
  const addToResults = (
    permissionedAddr: string,
    chain: string,
    contractType: string,
    contractAddr: string,
    perm: string
  ) => {
    if (!result[permissionedAddr]) result[permissionedAddr] = {};
    if (!result[permissionedAddr][chain]) result[permissionedAddr][chain] = {};
    if (!result[permissionedAddr][chain][contractType])
      result[permissionedAddr][chain][contractType] = [];
    result[permissionedAddr][chain][contractType].push({ contractAddr, perm });
  };
  const addToContractsWithPerms = (
    permissionedAddr: string,
    chain: string,
    contractType: string,
    contractAddr: string,
    role: string
  ) => {
    if (!contractsWithPerms[chain])
      contractsWithPerms[chain] = { jar: {}, strat: {}, controller: {} };
    if (!contractsWithPerms[chain][contractType])
      contractsWithPerms[chain][contractType] = {};
    if (!contractsWithPerms[chain][contractType][contractAddr])
      contractsWithPerms[chain][contractType][contractAddr] = {};
    contractsWithPerms[chain][contractType][contractAddr][role] =
      permissionedAddr;
  };
  const loopContractObject = (
    contractWithPerms: ContractWithPerms,
    contractType: string
  ) => {
    for (const contractAddr in contractWithPerms) {
      const perms = contractWithPerms[contractAddr];
      perms.forEach((perm) => {
        addToResults(
          perm.permissionedAddr,
          chain,
          contractType,
          contractAddr,
          perm.perm
        );
        addToContractsWithPerms(
          perm.permissionedAddr,
          chain,
          contractType,
          contractAddr,
          perm.perm
        );
      });
    }
  };

  Object.keys(chainCollisions).forEach((contractType) => {
    loopContractObject(
      chainCollisions[contractType],
      contractType.substring(0, contractType.length - 1)
    );
  });
};
const start = async (pfcore) => {
  const proms = Object.keys(addresses).map(async (chainName) => {
    const chainData = addresses[chainName];

    const provider = new JsonRpcProvider(chainData.rpc);

    let collisions: Collisions;
    try {
      collisions = await fetchChainCollisions(chainData, provider);
    } catch (error) {
      console.log("Something went wrong on :" + chainName);
      console.log(error);
    }

    extractResults(collisions, chainName, pfcore);
    console.log(`Chain: ${chainName} done!\n`);
  });

  await Promise.all(proms);
};
const fetchChainCollisions = async (
  chainData,
  provider: JsonRpcProvider
): Promise<Collisions> => {
  chainData.multicallAddress &&
    setMulticallAddress(chainData.chainId, chainData.multicallAddress);
  const multiProvider = new MultiProvider(chainData.chainId, {
    multicallAddress: chainData.multicallAddress,
    batchSize: 50,
  });
  await multiProvider.addProvider(provider);

  const strats: {
    [addr: string]: IPerms[];
  } = {};
  const jars: {
    [addr: string]: IPerms[];
  } = {};
  const controllers: {
    [addr: string]: IPerms[];
  } = {};

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
    controllers[controller] = [];
    controllers[controller].push({
      permissionedAddr: treasury,
      perm: "treasury",
    });
    controllers[controller].push({
      permissionedAddr: devfund,
      perm: "devfund",
    });
    controllers[controller].push({
      permissionedAddr: timelock,
      perm: "timelock",
    });
    controllers[controller].push({
      permissionedAddr: strategist,
      perm: "strategist",
    });
    controllers[controller].push({
      permissionedAddr: governance,
      perm: "governance",
    });
  });
  const stratsProms = chainData.strats.map(async (strat) => {
    // governance, strategist, timelock
    const contract = new MultiContract(strat, strategyAbi);
    const [governance, strategist, timelock, controller] =
      await multiProvider.all([
        contract.governance(),
        contract.strategist(),
        contract.timelock(),
        contract.controller(),
      ]);
    strats[strat] = [];
    strats[strat].push({
      permissionedAddr: governance,
      perm: "governance",
    });
    strats[strat].push({
      permissionedAddr: strategist,
      perm: "strategist",
    });
    strats[strat].push({ permissionedAddr: timelock, perm: "timelock" });

    // Check if the controller is set to an unknown controller
    if (
      !chainData.controllers.find(
        (c) => c.toLowerCase() === controller.toLowerCase()
      )
    ) {
      strats[strat].push({
        permissionedAddr: controller,
        perm: "controller",
      });
    }
  });
  const jarsProms = chainData.jars.map(async (jar) => {
    // governance, timelock
    const contract = new MultiContract(jar, jarAbi);
    const [governance, timelock, controller] = await multiProvider.all([
      contract.governance(),
      contract.timelock(),
      contract.controller(),
    ]);
    jars[jar] = [];
    jars[jar].push({ permissionedAddr: governance, perm: "governance" });
    jars[jar].push({ permissionedAddr: timelock, perm: "timelock" });

    // Check if the controller is set to an unknown controller
    if (
      !chainData.controllers.find(
        (c) => c.toLowerCase() === controller.toLowerCase()
      )
    ) {
      jars[jar].push({ permissionedAddr: controller, perm: "controller" });
    }
  });

  await Promise.all([controllersProms, stratsProms, jarsProms].flat());

  return { strats, jars, controllers };
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

interface IPerms {
  permissionedAddr: string;
  perm: string;
}
interface ContractWithPerms {
  [contractAddr: string]: IPerms[];
}
interface Collisions {
  strats: ContractWithPerms;
  jars: ContractWithPerms;
  controllers: ContractWithPerms;
}

main();
