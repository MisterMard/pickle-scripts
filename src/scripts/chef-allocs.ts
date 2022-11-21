import { BigNumber, ethers } from "ethers";
import { Contract as MultiContract } from "ethers-multiprovider";
import { ChainNetwork } from "picklefinance-core";
import { AssetProtocol, JarDefinition, PickleModelJson } from "picklefinance-core/lib/model/PickleModelJson.js";
import { getAbiWithCalls } from "./jars-fees.js";
import { getChainActiveJars, getMultiproviderFor, getPickleModelJson, getWallet, getWalletFor, printTable, promptChain } from "./utils/helpers.js";
import readLine from "readline-sync";

const maxAllocPoint = 10_000;
const TargetLiquidity: { [P in AssetProtocol]?: number } = {
  ZipSwap: 0.2,
  "Uniswap V3": 0.05,
  Velodrome: 0.2,
  BeethovenX: 0.2,
  Stargate: 0.2,
  Hop: 0.2,
};
const proxies: { [P in ChainNetwork]?: string } = {
  "optimism": "0x12e6749C4320d6f9F583646374F2763cB87C0bB0",
};
const chefs: { [P in ChainNetwork]?: string } = { "optimism": "0x849C283375A156A6632E8eE928308Fcb61306b7B" };
const rewarders: { [P in ChainNetwork]?: string } = { "optimism": "0xE039f8102319aF854fe11489a19d6b5d2799ADa7" };

type RegisteredChefPool = { jar: JarDefinition, newAllocPoints: number, currentAllocPoints: number, pid: number };
type NewChefPool = Omit<RegisteredChefPool, "currentAllocPoints" | "pid">
interface PoolsDataModel { newPools: NewChefPool[]; registeredPools: RegisteredChefPool[]; }

//prettier-ignore
const mcAbi = ["function poolInfo(uint256 pid) view returns(uint128 accPicklePerShare, uint64 lastRewardTime, uint64 allocPoint)", "function lpToken(uint256 pid) view returns(address)", "function add(uint256 allocPoint, address _lpToken, address _rewarder) external", "function set(uint256 _pid, uint256 _allocPoint, address _rewarder, bool overwrite) external", "function poolLength() view returns (uint256 pools)", "function massUpdatePools(uint256[] pids) external", "function picklePerSecond() view returns(uint256)"];
//prettier-ignore
const rewarderAbi = ["function poolInfo(uint256 pid) view returns(uint128 accPicklePerShare, uint64 lastRewardTime, uint64 allocPoint)", "function add(uint256 allocPoint, uint256 _pid) external", "function set(uint256 _pid, uint256 _allocPoint) external", "function poolLength() view returns (uint256 pools)", "function massUpdatePools(uint256[] pids) external", "function rewardPerSecond() view returns(uint256)", "function pendingTokens(uint256 pid,address user, uint256 pickleAmount) view returns(address[] rewardTokens,uint256[] rewardAmounts)", "function poolIds(uint256) view returns(uint256)"];
//prettier-ignore
const proxyAbi = ["function add(address[] _lpTokens, uint256[] _allocPoints)", "function set(uint256[] _pids, uint256[] _allocPoints)"];
//prettier-ignore
const erc20Abi = ["function balanceOf(address) view returns(uint256)", "function decimals() view returns(uint8)", "function symbol() view returns(string)"];

const getPerfFeeForJar = async (jar: JarDefinition, modelJson: PickleModelJson) => {
  const multiProvider = await getMultiproviderFor(jar.chain, modelJson);
  const abiWithCalls = getAbiWithCalls(jar);
  const strat = new MultiContract(jar.details.strategyAddr, abiWithCalls.abi);
  const promises = abiWithCalls.fee.map(async (_, idx) => {
    const [perf, perfMax] = await multiProvider.all([strat[abiWithCalls.fee[idx]](), strat[abiWithCalls.max[idx]]()]);
    const fee = perf.mul(100).div(perfMax).toNumber();
    return fee / 100;
  });
  return Promise.all(promises).then((x) => x[0]);
};

const getJarAnnualProfitUSD = async (
  jar: JarDefinition,
  fee: number,
  modelJson: PickleModelJson,
): Promise<number> => {
  //if (jar.id === "opJar 2a") return BigNumber.from(0);
  const jarApr = jar.aprStats?.components.reduce((cum, cur) => {
    let total = cum;
    if (cur.compoundable) {
      // get jar's actual APR before performance fees
      const aprBeforePerfFees = cur.apr + cur.apr * fee;
      total += aprBeforePerfFees;
    }
    return total;
  }, 0);
  const currentBalanceUSD = jar.details.harvestStats?.balanceUSD;
  const stakedBalanceUSD = await getDepositTokenStakedBalanceUSD(jar, modelJson);
  const stakedTargetLiquidity = stakedBalanceUSD * TargetLiquidity[jar.protocol];

  const targetLiquidityUSD = Math.max(stakedTargetLiquidity, currentBalanceUSD); //the amount of liquidity we want to capture/maintain

  const perfAprShare = (jarApr / 100) * fee;
  const annualProfitUSD = targetLiquidityUSD * perfAprShare;

  return annualProfitUSD;
};

const convertAnnualProfitToAlloc = (maxTotalAllocPoints: number, jarsAnnualProfitList: number[]) => {
  const annualProfitTotal = jarsAnnualProfitList.reduce((cum, cur) => cum + cur, 0);
  const allocPoints = jarsAnnualProfitList.map((jap) =>
    Math.floor(jap * maxTotalAllocPoints / annualProfitTotal),
  );

  return allocPoints;
};

/**
 * @desctiption returns the total staked value of the jar's deposit token (in underlying gauge/chef/staking contract)
 */
const getDepositTokenStakedBalanceUSD = async (jar: JarDefinition, modelJson: PickleModelJson) => {
  //prettier-ignore
  const stratAbi = ["function gauge() view returns(address)", "function starchef() view returns(address)", "function staking() view returns(address)"];
  //prettier-ingore
  const uniV3PoolAbi = ["function token0() view returns(address)", "function token1() view returns(address)"];

  const getStakedBalanceUSD = async (stakingContractAddr: string) => {
    const [stakedBalance] = await multiProvider.all([
      new MultiContract(jar.depositToken.addr, erc20Abi).balanceOf(stakingContractAddr),
    ]);
    const stakedBalanceUSD =
      parseFloat(ethers.utils.formatUnits(stakedBalance, jar.depositToken.decimals ?? 18)) * jar.depositToken.price;
    return stakedBalanceUSD;
  };

  const getUniV3BalanceUSD = async (pool: string) => {
    const poolContract = new MultiContract(pool, uniV3PoolAbi);
    const [token0Addr, token1Addr] = await multiProvider.all([poolContract.token0(), poolContract.token1()]);
    const [token0BN, token1BN] = await multiProvider.all([
      new MultiContract(token0Addr, erc20Abi).balanceOf(pool),
      new MultiContract(token1Addr, erc20Abi).balanceOf(pool),
    ]);
    const token0 = modelJson.tokens.find((x) => x.contractAddr.toLowerCase() === token0Addr.toLowerCase());
    const token1 = modelJson.tokens.find((x) => x.contractAddr.toLowerCase() === token1Addr.toLowerCase());
    const token0Value = parseFloat(ethers.utils.formatUnits(token0BN, token0.decimals)) * token0.price;
    const token1Value = parseFloat(ethers.utils.formatUnits(token1BN, token1.decimals)) * token1.price;
    return token0Value + token1Value;
  };
  const multiProvider = await getMultiproviderFor(jar.chain, modelJson);

  let stakedBalanceUSD: number;
  switch (jar.protocol) {
    case "ZipSwap":
      const zipChef = "0x1e2F8e5f94f366eF5Dc041233c0738b1c1C2Cb0c";
      stakedBalanceUSD = await getStakedBalanceUSD(zipChef);
      break;
    case "Uniswap V3":
      stakedBalanceUSD = await getUniV3BalanceUSD(jar.depositToken.addr);
      break;
    case "Velodrome":
      const [veloGauge] = await multiProvider.all([new MultiContract(jar.details.strategyAddr, stratAbi).gauge()]);
      stakedBalanceUSD = await getStakedBalanceUSD(veloGauge);
      break;
    case "BeethovenX":
      const [beetxGauge] = await multiProvider.all([new MultiContract(jar.details.strategyAddr, stratAbi).gauge()]);
      stakedBalanceUSD = await getStakedBalanceUSD(beetxGauge);
      break;
    case "Stargate":
      //const starChef = await multiProvider.all([new MultiContract(jar.details.strategyAddr, stratAbi).starchef()])
      const starChef = "0x4DeA9e918c6289a52cd469cAC652727B7b412Cd2";
      stakedBalanceUSD = await getStakedBalanceUSD(starChef);
      break;
    case "Hop":
      const [rewards] = await multiProvider.all([new MultiContract(jar.details.strategyAddr, stratAbi).staking()]);
      stakedBalanceUSD = await getStakedBalanceUSD(rewards);
      break;

    default:
      break;
  }
  return stakedBalanceUSD;
};

const printEmissions = async (chain: ChainNetwork, model: PickleModelJson) => {
  const multiProvider = await getMultiproviderFor(chain, model);
  const minichefMulti = new MultiContract(chefs[chain], mcAbi);
  const rewarderMulti = new MultiContract(rewarders[chain], rewarderAbi);
  const [picklesPerSecondBN, rewardsPerSecondBN, pendingTokens] = await multiProvider.all([
    minichefMulti.picklePerSecond(),
    rewarderMulti.rewardPerSecond(),
    rewarderMulti.pendingTokens(0, ethers.constants.AddressZero, 0)
  ]) as [BigNumber, BigNumber, [string[], BigNumber[]]];

  const rewardMulti = new MultiContract(pendingTokens[0][0], erc20Abi);
  const [decimals, symbol] = await multiProvider.all([
    rewardMulti.decimals(),
    rewardMulti.symbol()
  ]) as [number, string];

  const picklesPerSecond = parseFloat(ethers.utils.formatEther(picklesPerSecondBN));
  const picklesPerWeek = parseFloat(ethers.utils.formatEther(picklesPerSecondBN.mul(60 * 60 * 24 * 7)));

  const rewardsPerSecond = parseFloat(ethers.utils.formatUnits(rewardsPerSecondBN, decimals));
  const rewardsPerWeek = parseFloat(ethers.utils.formatUnits(rewardsPerSecondBN.mul(60 * 60 * 24 * 7), decimals));

  const headers = ["REWARD", "PER SECOND", "PER WEEK"];
  const body = [
    ["PICKLE", picklesPerSecond.toString(), picklesPerWeek.toString()],
    [symbol, rewardsPerSecond.toString(), rewardsPerWeek.toString()],
  ]
  printTable(headers, body)
}

const printAllocs = (poolsData: PoolsDataModel) => {
  const headers = ["PID", "JAR", "CURRENT ALLOC", "NEW ALLOC"];
  const body: string[][] = []

  poolsData.registeredPools.forEach(pool => {
    const row = [pool.pid.toString(), pool.jar.details.apiKey, pool.currentAllocPoints.toString(), pool.newAllocPoints.toString()];
    body.push(row);
  });

  poolsData.newPools.forEach(pool => {
    const row = ["NEW", pool.jar.details.apiKey, "-", pool.newAllocPoints.toString()]
    body.push(row);
  });

  const currentTotalAllocs = poolsData.registeredPools.reduce((cum, cur) => cum + cur.currentAllocPoints, 0);
  const newTotalAllocs = poolsData.registeredPools.reduce((cum, cur) => cum + cur.newAllocPoints, 0) + poolsData.newPools.reduce((cum, cur) => cum + cur.newAllocPoints, 0);
  body.push(["-", "TOTAL", currentTotalAllocs.toString(), newTotalAllocs.toString()]);

  printTable(headers, body);
}

/**
 * @notice returns registered pools current and new allocs, along with new pools allocs (pools not registered yet)
 */
const fetchPoolsData = async (newAllocs: number[], activeJars: JarDefinition[], modelJson: PickleModelJson, chain: ChainNetwork): Promise<PoolsDataModel> => {
  // Jars registered on minichef
  const registeredPools: RegisteredChefPool[] = await fetchRegisteredPools(chain, modelJson);

  // New active jars not registered on minichef yet
  const newPools: NewChefPool[] = [];

  // Update registered pools new allocPoints & extract new pools
  activeJars.forEach((jar, idx) => {
    const found = registeredPools.findIndex((rpool) => rpool.jar.contract.toLowerCase() === jar.contract.toLowerCase());
    if (found === -1) {
      newPools.push({ newAllocPoints: newAllocs[idx], jar });
    } else {
      registeredPools[found].newAllocPoints = newAllocs[idx];
    }
  })

  return { newPools, registeredPools };
}

const fetchRegisteredPools = async (chain: ChainNetwork, modelJson: PickleModelJson) => {
  const allJars = modelJson.assets.jars.filter((jar) => jar.chain === chain);
  const multiProvider = await getMultiproviderFor(chain, modelJson);
  const minichefMulti = new MultiContract(chefs[chain], mcAbi);

  let [mcPoolLength] = await multiProvider.all([minichefMulti.poolLength()]);
  mcPoolLength = mcPoolLength.toNumber();

  const pids = Array.from({ length: mcPoolLength }, (_, i) => i);
  const lpTokens: string[] = await multiProvider.all(pids.map((pid) => minichefMulti.lpToken(pid)));
  const currentAllocs: number[] = (await multiProvider.all(pids.map((pid) => minichefMulti.poolInfo(pid)))).map(poolInfo => poolInfo[2].toNumber());

  // Jars registered on minichef
  const registeredPools: RegisteredChefPool[] = [];

  lpTokens.forEach((lpToken, idx) => {
    const jar = allJars.find(jar => jar.contract.toLowerCase() === lpToken.toLowerCase());
    if (!jar) throw "could not find jar";
    registeredPools.push({ pid: idx, jar, currentAllocPoints: currentAllocs[idx], newAllocPoints: 0 });
  })

  return registeredPools;
}

const addNewPools = async (chain: ChainNetwork, modelJson: PickleModelJson, newPools: NewChefPool[]) => {
  if (!newPools.length) {
    console.log("There are no new pools to add!");
    return
  }

  const signer = getWalletFor(chain, modelJson);
  const proxyContract = new ethers.Contract(proxies[chain], proxyAbi, signer);

  const tokens: string[] = [];
  const allocPoints: number[] = [];
  newPools.forEach(pool => {
    tokens.push(pool.jar.contract);
    allocPoints.push(pool.newAllocPoints);
  });

  // Sanity check to verify pools are not already added
  const registeredPools = await fetchRegisteredPools(chain, modelJson);
  newPools.forEach(npool => {
    const found = registeredPools.findIndex(rpool => rpool.jar.contract.toLowerCase() === npool.jar.contract.toLowerCase())
    if (found !== -1) {
      console.log(`failed adding new pool ${npool.jar.details.apiKey} on MiniChef. Jar is already registered.`)
      return;
    }
  })

  console.log(`Adding ${tokens.length} new pools to the MiniChef...`);
  try {
    await waitForTransaction(proxyContract.add(tokens, allocPoints));
    console.log("Success!\n");
  } catch (err) {
    console.log("Failed adding new pools to the MiniChef\n" + err);
  }
};

const updatePools = async (chain: ChainNetwork, modelJson: PickleModelJson, registeredPools: RegisteredChefPool[]) => {
  const signer = getWalletFor(chain, modelJson);
  const proxyContract = new ethers.Contract(proxies[chain], proxyAbi, signer);

  const pids: number[] = [];
  const allocPoints: number[] = [];
  registeredPools.forEach(pool => {
    if (pool.currentAllocPoints != pool.newAllocPoints) {
      pids.push(pool.pid);
      allocPoints.push(pool.newAllocPoints);
    }
  });

  if (!pids.length) { console.log("No pools to update, allocPoints are already set correctly."); return; }

  console.log(`Updating ${pids.length} pools allocPoints on the MiniChef and Rewarder...`);
  try {
    await waitForTransaction(proxyContract.set(pids, allocPoints));
    console.log("Success!\n");
  } catch (err) {
    console.log("Failed adding new pools to the MiniChef\n" + err);
  }
}

const waitForTransaction = async (txPromise: Promise<any>): Promise<boolean> => {
  const txResp: ethers.providers.TransactionResponse = await txPromise;
  await txResp.wait();
  await new Promise((r) => setTimeout(r, 10000)); // wait for RPC to update chain state
  return true;
};

const printPIDs = async (chain: ChainNetwork, modelJson: PickleModelJson) => {
  const allJars = modelJson.assets.jars.filter((jar) => jar.chain === chain);
  const multiProvider = await getMultiproviderFor(chain, modelJson);
  const minichefMulti = new MultiContract(chefs[chain], mcAbi);
  const rewarderMulti = new MultiContract(rewarders[chain], rewarderAbi);

  let [mcPoolLength] = await multiProvider.all([minichefMulti.poolLength()]);
  mcPoolLength = mcPoolLength.toNumber();

  const mcPids = Array.from({ length: mcPoolLength }, (_, i) => i);
  const mcLpTokens: string[] = await multiProvider.all(mcPids.map((pid) => minichefMulti.lpToken(pid)));
  const currentMCAllocs: number[] = (await multiProvider.all(mcPids.map((pid) => minichefMulti.poolInfo(pid)))).map(poolInfo => poolInfo[2]);
  const currentRewarderAllocs: number[] = (await multiProvider.all(mcPids.map((pid) => rewarderMulti.poolInfo(pid)))).map(poolInfo => poolInfo[2]);

  const headers = ["PID", "JAR", "CHEF ALLOC", "REWARDER ALLOC"];
  const body: string[][] = [];

  mcPids.forEach((mcPid) => {
    const row: string[] = [mcPid.toString()];

    row.push(allJars.find(jar => jar.contract.toLowerCase() === mcLpTokens[mcPid].toLowerCase()).details.apiKey);
    row.push(currentMCAllocs[mcPid].toString());
    row.push(currentRewarderAllocs[mcPid].toString());

    body.push(row);
  })

  printTable(headers, body)
}


export const chefAllocMenu = async () => {
  const wallet = getWallet();
  const userAddress = wallet.address ?? undefined;
  if (userAddress) {
    console.log("Your address is: " + userAddress);
  } else {
    console.log("No wallet detected. Consider saving your private key in .env file:\nPRIVATE_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  }
  const chain = promptChain();

  console.log(`Fetching ${chain} MiniChef data. Please wait...`);
  const modelJson = await getPickleModelJson()
  const activeJars = getChainActiveJars(chain, modelJson);
  const jarsFees = await Promise.all(activeJars.map((jar) => getPerfFeeForJar(jar, modelJson)));
  const jarsAnnualProfitList = await Promise.all(activeJars.map((jar, idx) => {
    return getJarAnnualProfitUSD(jar, jarsFees[idx], modelJson);
  }));
  const activeJarsAllocPoints = convertAnnualProfitToAlloc(maxAllocPoint, jarsAnnualProfitList);
  const poolsData = await fetchPoolsData(activeJarsAllocPoints, activeJars, modelJson, chain);

  let done: boolean = false;
  while (!done) {
    console.log("Choose an option:");
    console.log("\t1) Print full report.");
    console.log("\t2) Add new pools.");
    console.log("\t3) Update pools allocPoints.");
    console.log("\t4) Set emission rates.");
    console.log("\t0) Back.");
    const choice = readLine.question("\tChoice: ", { limit: ["1", "2", "3", "4", "0"] });

    switch (choice) {
      case "0":
        done = true;
        break;
      case "1":
        console.log("\n--- EMISSIONS ---\n");
        await printEmissions(chain, modelJson);
        console.log("\n--- CURRENT ALLOCS ---\n");
        await printPIDs(chain, modelJson);
        console.log("\n--- NEW SUGGESTED ALLOCS ---\n");
        printAllocs(poolsData);
        break;
      case "2":
        await addNewPools(chain, modelJson, poolsData.newPools);
        break;
      case "3":
        await updatePools(chain, modelJson, poolsData.registeredPools);
        break;
      case "4":
        // TODO: Implement
        console.log("NOT IMPLEMENTED YET");
        break;
      default:
        console.log("Wrong Choice!");
        break;
    }
  }
}


