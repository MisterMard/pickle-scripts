import {
  Contract as MultiContract,
} from "ethers-multiprovider";
import { getMultiproviderFor, getPickleModelJson, getWallet, getWalletFor, printTable } from "./utils/helpers";
import { PickleModelJson } from "picklefinance-core/lib/model/PickleModelJson";
import { ADDRESSES } from "picklefinance-core/lib/model/PickleModel";
import { ChainNetwork } from "picklefinance-core";
import { ethers } from "ethers";
import readLine from "readline-sync";


const defaultPermissionedAddress = "0xacfe4511ce883c14c4ea40563f176c3c09b4c47c";
const multisigs: { [P in ChainNetwork]?: string } = {
  eth: "0x9d074e37d408542fd38be78848e8814afb38db17",
  polygon: "0xeae55893cc8637c16cf93d43b38aa022d689fa62",
  arbitrum: "0xf02ceb58d549e4b403e8f85fbbaee4c5dfa47c01",
  optimism: "0x7a79e2e867d36a91bb47e0929787305c95e793c5",
  gnosis: "0x986e64622ffb6b95b0be00076051807433258b46",
  fantom: "0xe4ee7edddbebda077975505d11decb16498264fb",
}
const treasuries: { [P in ChainNetwork]?: string } = {
  eth: "0x066419eaef5de53cc5da0d8702b990c5bc7d1ab3",
}

const GOOD_ADDRESSES: { [address: string]: string } = {
  "0xacfe4511ce883c14c4ea40563f176c3c09b4c47c": "larry",
  "0x4023ef3aaa0669faaf3a712626f4d8ccc3eaf2e5": "mard",     //Deployer
  "0x673d105035798ef87376f0253ff4a3cff4c6b0a5": "mard",     //Keeper
  "0x0f571d2625b503bb7c1d2b5655b483a2fa696fef": "tsuke",
  "0x066419eaef5de53cc5da0d8702b990c5bc7d1ab3": "multisig", //Mainnet treasury
  "0x9d074e37d408542fd38be78848e8814afb38db17": "multisig", //Mainnet governance
  "0xeae55893cc8637c16cf93d43b38aa022d689fa62": "multisig", //Polygon 
  "0x986e64622ffb6b95b0be00076051807433258b46": "multisig", //Gnosis  
  "0xf02ceb58d549e4b403e8f85fbbaee4c5dfa47c01": "multisig", //Arbitrum
  "0xe4ee7edddbebda077975505d11decb16498264fb": "multisig", //Fantom  
  "0x7a79e2e867d36a91bb47e0929787305c95e793c5": "multisig", //Optimism
  "0xd92c7faa0ca0e6ae4918f3a83d9832d9caeaa0d3": "timelock", //Mainnet 12h
  "0x0040e05ce9a5fc9c0abf89889f7b60c2fc278416": "timelock", //Mainnet 24h
  "0xc2d82a3e2bae0a50f4aeb438285804354b467bc0": "timelock", //Mainnet 48h
  "0x63a991b9c34d2590a411584799b030414c9b0d6f": "timelock", //Polygon 12h
  "0x6847259b2b3a4c17e7c43c54409810af48ba5210": "controller_eth",
  "0x7b5916c61bceeaa2646cf49d9541ac6f5dce3637": "controller_eth",
  "0x83074f0ab8edd2c1508d3f657ceb5f27f6092d09": "controller_polygon",
  "0x7749fbd85f388f4a186b1d339c2fd270dd0aa647": "controller_polygon",
  "0x90ee5481a78a23a24a4290eec42e8ad0fd3b4ac3": "controller_polygon",
  "0xcf05d96b4c6c5a87b73f5f274dce1085bc7fdcc4": "controller_okex",
  "0x55d5bcef2bfd4921b8790525ff87919c2e26bd03": "controller_arbitrum",
  "0xc3f393fb40f8cc499c1fe7fa5781495dc6fac9e9": "controller_moonriver",
  "0xf34514260f18bdb3ed1142b69a6055f51089ac7d": "controller_moonriver",
  "0xfa3ad976c0bdeadde81482f5fa8191ae1e7d84c0": "controller_cronos",
  "0xdc954e7399e9ada2661cdddb8d4c19c19e070a8e": "controller_aurora",
  "0xd556018e7b37e66f618a65737144a2ae2b98127f": "controller_metis",
  "0x69094096daeafa96f49438beda6b0e0950e4bf02": "controller_metis",
  "0x95ca4584ea2007d578fa2693ccc76d930a96d165": "controller_moonbeam",
  "0xa1d43d97fc5f1026597c67805aa02aae558e0fef": "controller_optimism",
  "0xeedef926d3d7c9628c8620b5a018c102f413cdb7": "controller_optimism",
  "0xa936511d24f9488db343afddccbf78ad28bd3f42": "controller_optimism",
  "0xc335740c951f45200b38c5ca84f0a9663b51aec6": "controller_fantom",
  "0xb1698a97b497c998b2b2291bb5c48d1d6075836a": "controller_fantom",
  "0xe5e231de20c68aabb8d669f87971ae57e2abf680": "controller_gnosis",

};
const BAD_ADDRESSES: { [address: string]: string } = {
  "0x4204fdd868ffe0e62f57e6a626f8c9530f7d5ad1": "ape",
  "0xd34216f24dac965f9cc9a9762194d1cbcd58e5a1": "ape",
  "0x000000000088e0120f9e6652cc058aec07564f69": "vanity_cipio",    //Vanity   
  "0x518973790e6b88fcd328952fd66cb7ddff96ac63": "evil_cipio",    //EvilCipio
}
const KNOWN_ADDRESSES: { [address: string]: string } = {
  "0x9796b1fa0de058877a3235e6b1beb9c1f945d99c": "cipio",
  "0x9bd920252e388579770b2cca855f81ababd22a84": "cipio",
  "0x907d9b32654b8d43e8737e0291ad9bfcce01dad6": "0xPenguin",
  "0x1cbf903de5d688eda7d6d895ea2f0a8f2a521e99": "0xKoffee",
}

interface IChainAddresses {
  pickle: string[];
  chef: string[];
  rewarder: string[];
  controllers: string[];
  jars: string[];
  strats: string[];
  brineries: string[];
};
type AddressesModel = { [P in ChainNetwork]?: IChainAddresses };


type ChefRoles = "owner";
type BrineryRoles = "governance";
type JarRoles = BrineryRoles | "timelock" | "controller";
type StrategyRoles = JarRoles | "strategist";
type ControllerRoles = StrategyRoles | "treasury" | "devfund";
interface IContractsWithRoles {
  pickle?: { [contractAddr: string]: { [P in ChefRoles]?: string } };
  chef?: { [contractAddr: string]: { [P in ChefRoles]?: string } };
  rewarder?: { [contractAddr: string]: { [P in ChefRoles]?: string } };
  controller?: { [contractAddr: string]: { [P in ControllerRoles]?: string } };
  jar?: { [contractAddr: string]: { [P in JarRoles]?: string } };
  strat?: { [contractAddr: string]: { [P in StrategyRoles]?: string } };
  brinery?: { [contractAddr: string]: { [P in BrineryRoles]?: string } };
};
type ContractsWithRolesModel = { [P in ChainNetwork]?: IContractsWithRoles; };

const isValidPerm = (chain: string, role: string, address: string) => {
  const lowerAddr = address.toLowerCase();
  const goodRole: string | undefined = GOOD_ADDRESSES[lowerAddr];

  // Known bad addresses must never hold any permission
  if (BAD_ADDRESSES[lowerAddr]) return false;

  // Exception for chains with no gnosis safe multisig 
  // Larry holds all the permissions there
  if ((chain === "moonriver" || chain === "moonbeam" || chain === "metis" || chain === "cronos" || chain === "okex" || chain === "aurora") && role != "controller") {
    if (goodRole === "larry") { return true; } else { return false; }
  }

  switch (role) {
    case "strategist":
      // Any known address can hold the strategist permission
      if (goodRole) return true;
      break;
    case "controller":
      if (goodRole === `controller_${chain}`) return true;
      break;
    case "owner":
    case "governance":
    case "timelock":
    case "treasury":
    case "devfund":
      // Above roles can only be assigned to multisig or timelock
      if (goodRole === "multisig" || goodRole === "timelock") return true;
      break;
    default:
      console.log("Unknown Role! [" + role + "]");
      throw "Unknown Role!";
      break;
  }
  return false;
};


const getContractsAddresses = async (pfcore: PickleModelJson) => {
  const addresses: AddressesModel = {};
  // Initiate addresses
  const chains = Object.values(ChainNetwork);
  chains.forEach(chain => {
    if (!addresses[chain]) {
      addresses[chain] = {
        controllers: [],
        jars: [],
        strats: [],
        brineries: [],
        pickle: [],
        chef: [],
        rewarder: [],
      };
    }
    // Extract chain contracts
    const chainAddresses = ADDRESSES.get(chain);
    addresses[chain].controllers.push(chainAddresses.controller.toLowerCase());
    addresses[chain].pickle.push(chainAddresses.pickle.toLowerCase());
    addresses[chain].chef.push(chainAddresses.minichef?.toLowerCase() ?? chainAddresses.masterChef?.toLowerCase());
    addresses[chain].rewarder.push(chainAddresses.rewarder?.toLowerCase() ?? ethers.constants.AddressZero);
  })

  // Extract addresses from pfcore
  // JARS, STRATS and CONTROLLERS
  pfcore.assets.jars.forEach((jar) => {
    const chain = jar.chain;
    const jarAddr = jar.contract.toLowerCase();
    const stratAddr = jar.details?.strategyAddr?.toLowerCase();
    const controller = jar.details?.controller?.toLowerCase();
    addresses[chain].jars.push(jarAddr);
    addresses[chain].strats.push(stratAddr);
    addresses[chain].controllers.push(controller);
  });

  // BRINERIES
  pfcore.assets.brineries.forEach((brinery) => {
    const chain = brinery.chain;
    const brinAddr = brinery.contract.toLowerCase();
    addresses[chain].brineries.push(brinAddr);
  });

  // EXTERNAL ASSETS

  // cleanup duplicates
  Object.keys(addresses).forEach((chain) => {
    addresses[chain].controllers = [
      ...new Set(addresses[chain].controllers),
    ].filter((x) => x);
    addresses[chain].jars = [...new Set(addresses[chain].jars)].filter((x) => x);
    addresses[chain].strats = [...new Set(addresses[chain].strats)].filter((x) => x);
  });

  return addresses;
};


const getContractsWithRoles = async (pfcore: PickleModelJson, addresses: AddressesModel) => {
  const contractsWithRoles: ContractsWithRolesModel = {};

  const proms = Object.keys(addresses).map(async (chainStr) => {
    const chain = chainStr as ChainNetwork;
    const chainAddresses = addresses[chainStr];

    try {
      await fetchChainContractsRoles(pfcore, chainAddresses, contractsWithRoles, chain);
    } catch (error) {
      console.log("Something went wrong on :" + chainStr);
      console.log(error);
    }

    console.log(`Chain: ${chainStr} done!`);
  });

  await Promise.all(proms);
  return contractsWithRoles;
};


const fetchChainContractsRoles = async (
  pfcore: PickleModelJson,
  chainAddresses: IChainAddresses,
  contractsWithRoles: ContractsWithRolesModel,
  chain: ChainNetwork,
): Promise<void> => {
  const abi = [
    "function strategist() view returns(address)",
    "function timelock() view returns(address)",
    "function treasury() view returns(address)",
    "function governance() view returns(address)",
    "function devfund() view returns(address)",
    "function controller() view returns(address)",
    "function owner() view returns(address)"
  ];
  const multiProvider = await getMultiproviderFor(chain, pfcore);

  // CONTROLLERS
  const controllersProms = chainAddresses.controllers.map(async (controller) => {
    // treasury, strategist, governance, timelock, devfund
    const contract = new MultiContract(controller, abi);
    const [strategist, timelock, treasury, governance, devfund]: string[] =
      await multiProvider.all([
        contract.strategist(),
        contract.timelock(),
        contract.treasury(),
        contract.governance(),
        contract.devfund(),
      ]);
    initiateContractWithRolesObject(contractsWithRoles, chain, "controller", controller);
    contractsWithRoles[chain].controller[controller] = { treasury, devfund, timelock, governance, strategist };
  });

  // STRATEGIES
  const stratsProms = chainAddresses.strats.map(async (strat) => {
    // governance, strategist, timelock
    const contract = new MultiContract(strat, abi);
    const [governance, strategist, timelock, controller] =
      await multiProvider.all([
        contract.governance(),
        contract.strategist(),
        contract.timelock(),
        contract.controller(),
      ]);
    initiateContractWithRolesObject(contractsWithRoles, chain, "strat", strat);
    contractsWithRoles[chain].strat[strat] = { governance, strategist, timelock, controller }
  });

  // JARS
  const jarsProms = chainAddresses.jars.map(async (jar) => {
    // governance, timelock
    const contract = new MultiContract(jar, abi);
    const [governance, timelock, controller] = await multiProvider.all([
      contract.governance(),
      contract.timelock(),
      contract.controller(),
    ]);
    initiateContractWithRolesObject(contractsWithRoles, chain, "jar", jar);
    contractsWithRoles[chain].jar[jar] = { governance, timelock, controller }
  });

  // BRINERIES
  const brinProms = chainAddresses.brineries.map(async (brinery) => {
    // governance
    const contract = new MultiContract(brinery, abi);
    const [governance] = await multiProvider.all([contract.governance()]);
    initiateContractWithRolesObject(contractsWithRoles, chain, "brinery", brinery);
    contractsWithRoles[chain].brinery[brinery] = { governance };
  })

  // CHEF
  const chefProms = chainAddresses.chef.map(async (chef) => {
    if (chef === ethers.constants.AddressZero) return;
    // owner
    const contract = new MultiContract(chef, abi);
    const [owner] = await multiProvider.all([contract.owner()]);
    initiateContractWithRolesObject(contractsWithRoles, chain, "chef", chef);
    contractsWithRoles[chain].chef[chef] = { owner };
  });

  // REWARDER
  const rewarderProms = chainAddresses.rewarder.map(async (rewarder) => {
    if (rewarder === ethers.constants.AddressZero) return;
    // owner
    const contract = new MultiContract(rewarder, abi);
    const [owner] = await multiProvider.all([contract.owner()]);
    initiateContractWithRolesObject(contractsWithRoles, chain, "rewarder", rewarder);
    contractsWithRoles[chain].rewarder[rewarder] = { owner };
  })

  // TODO: GAUGES

  await Promise.all([controllersProms, stratsProms, jarsProms, brinProms, chefProms, rewarderProms].flat());
};

const getContractsWithBadRoles = (contractsWithRoles: ContractsWithRolesModel) => {
  const contractsWithBadRoles: ContractsWithRolesModel = {};

  Object.keys(contractsWithRoles).forEach((chain) => {
    Object.keys(contractsWithRoles[chain]).forEach(contractType => {
      Object.keys(contractsWithRoles[chain][contractType]).forEach(contractAddr => {
        Object.keys(contractsWithRoles[chain][contractType][contractAddr]).forEach(role => {
          const roleHolder: string = contractsWithRoles[chain][contractType][contractAddr][role].toLowerCase();
          if (!isValidPerm(chain, role, roleHolder)) {
            initiateContractWithRolesObject(contractsWithBadRoles, chain as ChainNetwork, contractType as keyof IContractsWithRoles, contractAddr);
            contractsWithBadRoles[chain][contractType][contractAddr][role] = roleHolder;
          }
        });
      });
    });
  });

  return contractsWithBadRoles;
}

const initiateContractWithRolesObject = (contractsWithRoles: ContractsWithRolesModel, chain: ChainNetwork, type: keyof IContractsWithRoles, contractAddr: string) => {
  if (!contractsWithRoles[chain]) contractsWithRoles[chain] = {};
  if (!contractsWithRoles[chain][type]) contractsWithRoles[chain][type] = {};
  if (!contractsWithRoles[chain][type][contractAddr]) contractsWithRoles[chain][type][contractAddr] = {};
}

const lookupAddressRoles = (contractsWithRoles: ContractsWithRolesModel, address: string) => {
  const result: ContractsWithRolesModel = {};

  Object.keys(contractsWithRoles).forEach((chain) => {
    Object.keys(contractsWithRoles[chain]).forEach(contractType => {
      Object.keys(contractsWithRoles[chain][contractType]).forEach(contractAddr => {
        Object.keys(contractsWithRoles[chain][contractType][contractAddr]).forEach(role => {
          const roleHolder: string = contractsWithRoles[chain][contractType][contractAddr][role].toLowerCase();
          if (roleHolder === address.toLowerCase()) {
            initiateContractWithRolesObject(result, chain as ChainNetwork, contractType as keyof IContractsWithRoles, contractAddr);
            result[chain][contractType][contractAddr][role] = roleHolder;
          }
        });
      });
    });
  });

  return result;
}

const filterTransferableRoles = (allContractsWithRoles: ContractsWithRolesModel, addressRoles: ContractsWithRolesModel) => {
  // true if current holder can transfer the role, otherwise returns the address of the permissioned address
  const isTransferable = (role: string, contractRoles: { [roles: string]: string }): true | string => {
    const holder = contractRoles[role].toLowerCase();
    if (role === "strategist" || role === "treasury" || role === "devfund") {
      // governance
      const governance = contractRoles["governance"].toLowerCase();
      if (governance === holder) return true;
      return governance;
    } else if (role === "controller") {
      // timelock
      // controller roles should be reviewed & transferred manually
      const timelock = contractRoles["timelock"].toLowerCase();
      return timelock;
    }
    return true;
  }

  const transferableRoles: { [P in ChainNetwork]?: [contract: string, role: string][] } = {};
  const nonTransferableRoles: { [P in ChainNetwork]?: [contract: string, role: string, permissionedAddr: string][] } = {};
  Object.keys(addressRoles).forEach((chainName) => {
    const chain = chainName as ChainNetwork;
    transferableRoles[chain] = [];
    nonTransferableRoles[chain] = [];
    Object.keys(addressRoles[chain]).forEach(contractType => {
      Object.keys(addressRoles[chain][contractType]).forEach(contractAddr => {
        // Insert governance and timelock to res after all other roles are inserted
        let insertFirst = [];
        let insertLast = [];
        Object.keys(addressRoles[chain][contractType][contractAddr]).forEach(role => {
          const contractRoles = allContractsWithRoles[chain][contractType][contractAddr];
          if (role === "governance" || role === "timelock") {
            insertLast.push([contractAddr, role])
          } else if (isTransferable(role, contractRoles) === true) {
            insertFirst.push([contractAddr, role]);
          } else {
            // non-transferable
            nonTransferableRoles[chain].push([contractAddr, role, isTransferable(role, contractRoles) as string])
          }
        });
        transferableRoles[chain].push(...insertFirst, ...insertLast);
      });
    });
  });
  return { transferableRoles, nonTransferableRoles }
}

const transferRoles = async (transferableRoles: { [P in ChainNetwork]?: [contract: string, role: string][] }, pfcore: PickleModelJson) => {
  const getPermissionedAddr = (chain: ChainNetwork, role: string) => {
    let permissionedAddr: string;
    switch (role) {
      case "strategist":
        permissionedAddr = defaultPermissionedAddress;
      case "treasury":
        if (!permissionedAddr) permissionedAddr = treasuries[chain];
      default:
        if (!permissionedAddr) permissionedAddr = multisigs[chain] ?? defaultPermissionedAddress;
        break;
    }
    return permissionedAddr;
  }

  const chains = Object.keys(transferableRoles);
  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i] as ChainNetwork;
    const chainCalls = transferableRoles[chain];
    const wallet = getWalletFor(chain, pfcore);

    if (chainCalls.length > 0) {
      console.log("Chain [" + chain + "]: There are a total of " + chainCalls.length + " calls to execute");
      const printObj = {};
      printObj[chain as string] = transferableRoles[chain];
      printCallsList(printObj)

      let feeData: ethers.providers.FeeData;
      if (chain === "arbitrum" || chain === "optimism") {
        feeData = await ethers.getDefaultProvider().getFeeData();
      } else {
        feeData = await wallet.getFeeData()
      }
      const gasPrice = ethers.utils.formatUnits(feeData.gasPrice, "gwei")
      console.log(`Current gas price: ${gasPrice} GWEI`);

      if (!readLine.keyInYNStrict(`Continue executing this chain calls?`)) {
        console.log(`Chain [${chain}]: Aborted.`);
        continue;
      }

      for (let j = 0; j < chainCalls.length; j++) {
        const chainCall = chainCalls[j];
        const role = chainCall[1];
        const permissionedAddr = getPermissionedAddr(chain, role);
        const abi: string[] = [];
        let call: string;
        const callParams: (string | boolean)[] = [];
        if (role === "owner") {
          abi.push("function transferOwnership(address newOwner, bool direct, bool renounce)");
          call = "transferOwnership";
          callParams.push(permissionedAddr, true, false)
        } else if (role === "devfund") {
          abi.push("function setDevFund(address)");
          call = "setDevFund";
          callParams.push(permissionedAddr);
        } else {
          call = `set${role[0].toUpperCase() + role.slice(1)}`;
          abi.push(`function ${call}(address)`);
          callParams.push(permissionedAddr);
        }

        const contract = new ethers.Contract(chainCall[0], abi, wallet)
        console.log(`Calling ${call}(${callParams.join(",")}) on contract: ${contract.address}`);
        try {
          const txnResp: ethers.providers.TransactionResponse = await contract[call](...callParams);
          await txnResp.wait();
          console.log("Success!");
        } catch (err) {
          // prettier-ignore
          console.log(`ERROR: Failed executing txn!\nContract: ${contract.address}\nMethod: ${call}(${callParams.join(",")}) \n` + err);
          process.exit(1);
        }
      }
      console.log(`Chain [${chain}]: done.`)
    } else { console.log(`Chain [${chain}]: has no calls to execute.`) }
  }

}

const printContractsWithRoles = (contractsWithRoles: ContractsWithRolesModel) => {
  const headers = ["CHAIN", "CONTRACT TYPE", "CONTRACT ADDRESS", "ROLE", "ROLE HOLDER", "HOLDER NAME"];
  const body = Object.keys(contractsWithRoles).map(chain => {
    const chainRows: string[][] = Object.keys(contractsWithRoles[chain]).map(contractType => {
      return Object.keys(contractsWithRoles[chain][contractType]).map(contractAddr => {
        return Object.keys(contractsWithRoles[chain][contractType][contractAddr]).map(role => {
          const roleHolder: string = contractsWithRoles[chain][contractType][contractAddr][role].toLowerCase();
          const roleName: string | undefined = GOOD_ADDRESSES[roleHolder] ?? BAD_ADDRESSES[roleHolder] ?? KNOWN_ADDRESSES[roleHolder] ?? "UNKNOWN";
          const row = [chain, contractType, contractAddr, role, roleHolder, roleName];
          return row;
        });
      }).flat();
    }).flat();
    return chainRows;
  }).flat();

  printTable(headers, body)
}

const printCallsList = (callsObj: { [P in ChainNetwork]?: [contract: string, role: string, permissionedAddr: string][] }) => {
  const headers = ["CHAIN", "CONTRACT ADDRESS", "ROLE", "PERMISSIONED ADDRESS"]
  const body = [];
  Object.keys(callsObj).forEach(chain => {
    callsObj[chain as ChainNetwork].forEach(callRow => {
      const row = [chain, callRow[0], callRow[1], callRow[2]]
      body.push(row);
    });
  });

  printTable(headers, body);
}

const start = async (constraint: "all" | "bad_only", model: ContractsWithRolesModel | undefined = undefined, address: string | undefined = undefined) => {
  let returnModel: ContractsWithRolesModel = model;

  if (!returnModel) {
    const pfcore = await getPickleModelJson();
    const addresses = await getContractsAddresses(pfcore);
    returnModel = await getContractsWithRoles(pfcore, addresses);
  }

  //if (constraint === "all") returnModel = returnModel;
  if (constraint === "bad_only") returnModel = getContractsWithBadRoles(returnModel);
  if (address) returnModel = lookupAddressRoles(returnModel, address);
  return returnModel;
};

const menu = async () => {
  const wallet = getWallet();
  const userAddress = wallet.address ?? undefined;
  if (userAddress) {
    console.log("Your address is: " + userAddress);
  } else {
    console.log("No wallet detected. Consider saving your private key in .env file:\nPRIVATE_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  }
  console.log("Fetching the current permissions state. Please wait...");
  const allContractsWithRoles = await start("all");
  let address: string;

  let done: boolean = false;
  while (!done) {
    console.log("Choose an option:");
    console.log("\t1) Print all roles");
    console.log("\t2) Print bad roles");
    console.log("\t3) Print an address roles");
    console.log("\t4) Print an address bad roles");
    console.log("\t5) Transfer your roles " + userAddress);
    console.log("\t0) Exit");
    const choice = readLine.question("\tChoice: ", { limit: ["1", "2", "3", "4", "5", "0"] });

    switch (choice) {
      case "0":
        done = true;
        break;
      case "1":
        printContractsWithRoles(await start("all", allContractsWithRoles))
        break;
      case "2":
        printContractsWithRoles(await start("bad_only", allContractsWithRoles))
        break;
      case "3":
        address = readLine.question("Enter an address: ");
        printContractsWithRoles(await start("all", allContractsWithRoles, address));
        break;
      case "4":
        address = readLine.question("Enter an address: ");
        printContractsWithRoles(await start("bad_only", allContractsWithRoles, address));
        break;
      case "5":
        const badUserRoles = await start("bad_only", allContractsWithRoles, userAddress);
        const transferableRolesObj = filterTransferableRoles(allContractsWithRoles, badUserRoles)
        await transferRoles(transferableRolesObj.transferableRoles, await getPickleModelJson())
        console.log("The following roles could not be transferred and can only be transferred by PERMISSIONED ADDRESS:")
        printCallsList(transferableRolesObj.nonTransferableRoles)
        break;
      default:
        console.log("Wrong Choice!");
        break;
    }
  }
}


const main = async () => {
  const arg = process.argv[2] ?? undefined;
  switch (arg) {
    case undefined:
      await menu();
      break;
    case "all":
      printContractsWithRoles(await start("all"));
      break;
    case "bad_only":
      printContractsWithRoles(await start("bad_only"));
      break;
    default:
      console.log("Wrong Argument!");
      break;
  }
}

main();
