import { BigNumber, ethers } from "ethers";
import { Contract as MultiContract } from "ethers-multiprovider";
import { ChainNetwork } from "picklefinance-core";
import {
  AssetProtocol,
  IExternalToken,
  JarDefinition,
  PickleModelJson,
} from "picklefinance-core/lib/model/PickleModelJson.js";
import { getAbiWithCalls } from "./jars-fees.js";
import {
  getChainActiveJars,
  getMultiproviderFor,
  getPickleModelJson,
  getWalletFor,
} from "./utils/helpers.js";

const SecondsInYear = 60 * 60 * 24 * 365;
const maxAllocPoint = 10_000;
const TargetLiquidity: { [P in AssetProtocol]?: number } = {
  "ZipSwap": 0.2,
  "Uniswap V3": 0.05,
  "Velodrome": 0.2,
  "BeethovenX": 0.2,
  "Stargate": 0.2,
}

const start = async (
  chain: ChainNetwork,
  maxPicklePerSecond: BigNumber,
  maxOpPerSecond: BigNumber
) => {
  const modelJson = await getPickleModelJson();
  const jars = getChainActiveJars(chain, modelJson);
  const jarsFees = await Promise.all(
    jars.map((jar) => getPerfFeeForJar(jar, modelJson))
  );

  const pickle = modelJson.tokens.find((x) => x.id === "pickle");
  const op = modelJson.tokens.find((x) => x.id === "op");

  const annualPickleList = await Promise.all(jars.map((jar, idx) => {
    return getMatchingRewardPerSecond(jar, jarsFees[idx], pickle, modelJson);
  }));
  const opPerSecondList = await Promise.all(jars.map((jar, idx) => {
    return getMatchingRewardPerSecond(jar, jarsFees[idx], op, modelJson);
  }));

  const allocPoints = convertRewardPerSecondToAlloc(
    maxAllocPoint,
    annualPickleList
  );

  print(maxPicklePerSecond, maxOpPerSecond, annualPickleList, opPerSecondList, allocPoints, jars);

  await addAndSetNewPools(allocPoints, jars, modelJson);
};

const getPerfFeeForJar = async (
  jar: JarDefinition,
  modelJson: PickleModelJson
) => {
  const multiProvider = await getMultiproviderFor(jar.chain, modelJson);
  const abiWithCalls = getAbiWithCalls(jar);
  const strat = new MultiContract(jar.details.strategyAddr, abiWithCalls.abi);
  const promises = abiWithCalls.fee.map(async (_, idx) => {
    const [perf, perfMax] = await multiProvider.all([
      strat[abiWithCalls.fee[idx]](),
      strat[abiWithCalls.max[idx]](),
    ]);
    const fee = perf.mul(100).div(perfMax).toNumber();
    return fee / 100;
  });
  return Promise.all(promises).then((x) => x[0]);
};

/**
 *@description returns number of reward tokens, the value of which matches jar's annual USD profitability to the protocol
 */
const getMatchingRewardPerSecond = async (
  jar: JarDefinition,
  fee: number,
  rewardToken: IExternalToken,
  modelJson: PickleModelJson
): Promise<BigNumber> => {
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
  const profitMatchingReward = annualProfitUSD / rewardToken.price;
  const matchingRewardBN = ethers.utils.parseUnits(profitMatchingReward.toString(), rewardToken.decimals);

  return matchingRewardBN;
};

const convertRewardPerSecondToAlloc = (
  maxTotalAllocPoints: number,
  rewardPerSecondList: BigNumber[]
) => {
  const rewardPerSecondTotal = rewardPerSecondList.reduce(
    (cum, cur) => cum.add(cur),
    BigNumber.from(0)
  );
  const rewardPerSecondScales = rewardPerSecondList.map((rps) =>
    rps.mul(maxTotalAllocPoints).div(rewardPerSecondTotal).toNumber()
  );

  return rewardPerSecondScales;
};

/**
 * @desctiption returns the total staked value of the jar's deposit token (in underlying gauge/chef/staking contract)
 */
const getDepositTokenStakedBalanceUSD = async (
  jar: JarDefinition,
  modelJson: PickleModelJson
) => {
  //prettier-ignore
  const erc20Abi = ["function balanceOf(address) view returns(uint256)", "function decimals() view returns(uint8)"];
  //prettier-ignore
  const stratAbi = ["function gauge() view returns(address)", "function starchef() view returns(address)"];
  //prettier-ingore
  const uniV3PoolAbi = ["function token0() view returns(address)", "function token1() view returns(address)"];

  const getStakedBalanceUSD = async (stakingContractAddr: string) => {
    const [stakedBalance] = await multiProvider.all([
      new MultiContract(jar.depositToken.addr, erc20Abi).balanceOf(
        stakingContractAddr
      ),
    ]);
    const stakedBalanceUSD =
      parseFloat(
        ethers.utils.formatUnits(stakedBalance, jar.depositToken.decimals ?? 18)
      ) * jar.depositToken.price;
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
  }
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
      const [veloGauge] = await multiProvider.all([
        new MultiContract(jar.details.strategyAddr, stratAbi).gauge(),
      ]);
      stakedBalanceUSD = await getStakedBalanceUSD(veloGauge);
      break;
    case "BeethovenX":
      const [beetxGauge] = await multiProvider.all([
        new MultiContract(jar.details.strategyAddr, stratAbi).gauge(),
      ]);
      stakedBalanceUSD = await getStakedBalanceUSD(beetxGauge);
      break;
    case "Stargate":
      //const starChef = await multiProvider.all([new MultiContract(jar.details.strategyAddr, stratAbi).starchef()])
      const starChef = "0x4DeA9e918c6289a52cd469cAC652727B7b412Cd2";
      stakedBalanceUSD = await getStakedBalanceUSD(starChef);
      break;

    default:
      break;
  }
  return stakedBalanceUSD;
};

const print = (
  maxPicklePerSecond: BigNumber,
  maxOpPerSecond: BigNumber,
  picklePerSecondList: BigNumber[],
  opPerSecondList: BigNumber[],
  allocs: number[],
  jars: JarDefinition[]
) => {
  const totalAnnualPickles = picklePerSecondList.reduce(
    (cum, cur) => cum.add(cur),
    BigNumber.from(0)
  );
  const totalAnnualOps = opPerSecondList.reduce(
    (cum, cur) => cum.add(cur),
    BigNumber.from(0)
  );

  const calculatedPicklePerSecond = totalAnnualPickles.div(SecondsInYear);
  const calculatedOpPerSecond = totalAnnualOps.div(SecondsInYear);

  if (maxPicklePerSecond.gt(calculatedPicklePerSecond)) {
    // prettier-ignore
    console.log("❌❌ Warning: Max $PICKLE Per Second is higher than the suggested value.\n\tMax value: " + maxPicklePerSecond.toString() + "\tSuggested value: " + calculatedPicklePerSecond.toString());
  } //else {console.log("Suggested $PICKLE Per Second value: "+ calculatedPicklePerSecond.toString())}
  if (maxOpPerSecond.gt(calculatedOpPerSecond)) {
    // prettier-ignore
    console.log("❌❌ Warning: Max $OP Per Second is higher than the suggested value.\n\tMax value: " + maxOpPerSecond.toString() + "\tSuggested value: " + calculatedOpPerSecond.toString());
  } //else {console.log("Suggested $OP Per Second value: "+ calculatedOpPerSecond.toString())}

  const totalAllocs = allocs.reduce((cum, cur) => cum + cur, 0);

  console.log("|JAR|allocPoint|");
  jars.forEach((jar, idx) =>
    console.log(`|${jar.details.apiKey}|${allocs[idx]}|`)
  );
  console.log("|TOTAL|" + totalAllocs + "|");
  console.log();
};

const addAndSetNewPools = async (newAllocs: number[], jars: JarDefinition[], modelJson: PickleModelJson) => {

  const mcAbi = ["function poolInfo(uint256 pid) view returns(uint128 accPicklePerShare, uint64 lastRewardTime, uint64 allocPoint)", "function lpToken(uint256 pid) view returns(address)",
    "function add(uint256 allocPoint, address _lpToken, address _rewarder) external", "function set(uint256 _pid, uint256 _allocPoint, address _rewarder, bool overwrite) external", "function poolLength() view returns (uint256 pools)", "function massUpdatePools(uint256[] pids) external"];
  const rewarderAbi = ["function poolInfo(uint256 pid) view returns(uint128 accPicklePerShare, uint64 lastRewardTime, uint64 allocPoint)",
    "function add(uint256 allocPoint, uint256 _pid) external", "function set(uint256 _pid, uint256 _allocPoint) external", "function poolLength() view returns (uint256 pools)", "function massUpdatePools(uint256[] pids) external"];
  const multiProvider = await getMultiproviderFor(jars[0].chain, modelJson);
  const owner = getWalletFor(jars[0].chain, modelJson);
  // const owner = provider;

  const minichefMulti = new MultiContract(MiniChef, mcAbi);
  const rewarderMulti = new MultiContract(opRewarder, rewarderAbi);
  const minichef = new ethers.Contract(MiniChef, mcAbi, owner);
  const rewarder = new ethers.Contract(opRewarder, rewarderAbi, owner);

  let [mcPoolLength, rewarderPoolLength] = await multiProvider.all([minichefMulti.poolLength(), rewarderMulti.poolLength()]);
  mcPoolLength = mcPoolLength.toNumber();
  rewarderPoolLength = rewarderPoolLength.toNumber();
  if (mcPoolLength !== rewarderPoolLength) throw (`MiniChef poolLength (${mcPoolLength}) does not match OpRewarder poolLength (${rewarderPoolLength})`);
  let pids = Array.from({ length: mcPoolLength }, (_, i) => i);
  let lpTokens: string[] = await multiProvider.all(pids.map(pid => minichefMulti.lpToken(pid)));

  // Add new pools
  const newPools: { alloc: number, jar: JarDefinition }[] = [];
  jars.forEach((jar, idx) => {
    const found = lpTokens.findIndex(lpToken => jar.contract.toLowerCase() === lpToken.toLowerCase());
    if (found === -1) newPools.push({ alloc: newAllocs[idx], jar })
  });

  let shouldMassUpdate = false;
  if (newPools.length) {
    console.log(`There are ${newPools.length} new pools to be added to the rewarders`);
    for (let i = 0; i < newPools.length; i++) {
      const pool = newPools[i];
      const pid = mcPoolLength + i;

      console.log(`\nNew jar: ${pool.jar.details.apiKey} (${pool.jar.contract}) alloc: ${pool.alloc}`);

      console.log("Adding to MiniChef...");
      await waitForTransaction(minichef.add(pool.alloc, pool.jar.contract, opRewarder));
      shouldMassUpdate = true;

      // confirm the new pool registered
      const newPoolLp: string = await minichef.lpToken(pid);
      if (newPoolLp.toLowerCase() !== pool.jar.contract.toLowerCase()) throw (`New pool did not get added properly. PID ${pid} on MiniChef is: ${newPoolLp}`);

      console.log("Adding to opRewarder...");
      await waitForTransaction(rewarder.add(pool.alloc, pid));
      shouldMassUpdate = true;

      console.log("New jar added successfully");
    }
    console.log();
  }

  // Adjust the allocPoint for the pools that need to be changed. Then call massUpdate
  [mcPoolLength, rewarderPoolLength] = await multiProvider.all([minichefMulti.poolLength(), rewarderMulti.poolLength()]);
  mcPoolLength = mcPoolLength.toNumber();
  rewarderPoolLength = rewarderPoolLength.toNumber();
  pids = Array.from({ length: mcPoolLength }, (_, i) => i);
  lpTokens = await multiProvider.all(pids.map(pid => minichefMulti.lpToken(pid)));
  const mcPoolInfos = await multiProvider.all(pids.map(pid => minichefMulti.poolInfo(pid)));
  const rewarderPoolInfos = await multiProvider.all(pids.map(pid => minichefMulti.poolInfo(pid)));

  for (let i = 0; i < mcPoolInfos.length; i++) {
    const lpToken = lpTokens[i];
    const mcPoolInfo = mcPoolInfos[i];
    const mcAlloc = mcPoolInfo[2].toNumber();
    const rewarderPoolInfo = rewarderPoolInfos[i];
    const rewarderAlloc = rewarderPoolInfo[2].toNumber();
    const allocIndex = jars.findIndex(jar => jar.contract.toLowerCase() === lpToken.toLowerCase());
    let newAlloc = 0;
    if (allocIndex !== -1) newAlloc = newAllocs[allocIndex];

    const jarName = allocIndex === -1 ? lpToken : jars[allocIndex].details.apiKey;
    if (newAlloc === mcAlloc) {
      console.log(`Jar ${jarName} is set correctly on MiniChef: ${newAlloc} allocPoints.`);
    } else {
      console.log(`Jar ${jarName} is not set correctly on MiniChef: Current: ${mcAlloc} Expected: ${newAlloc}.`);
      console.log("Setting on MiniChef...");
      await waitForTransaction(minichef.set(i, newAlloc, opRewarder, false));
      console.log("Jar set correctly on MiniChef");
      shouldMassUpdate = true;
    }
    if (newAlloc === rewarderAlloc) {
      console.log(`Jar ${jarName} is set correctly on opRewarder: ${newAlloc} allocPoints.`);
    } else {
      console.log(`Jar ${jarName} is not set correctly on opRewarder: Current: ${rewarderAlloc} Expected: ${newAlloc}.`);
      console.log("Setting on opRewarder...");
      await waitForTransaction(rewarder.set(i, newAlloc));
      console.log("Jar set correctly on opRewarder");
      shouldMassUpdate = true;
    }
    console.log();
  }

  if (shouldMassUpdate) {
    const pids = Array.from({ length: mcPoolLength }, (_, i) => i);
    console.log("Calling massUpdate on MiniChef...");
    await waitForTransaction(minichef.massUpdatePools(pids));
    console.log("Calling massUpdate on opRewarder...");
    await waitForTransaction(rewarder.massUpdatePools(pids));
    console.log("Pools updated successfully");
  }
}

const waitForTransaction = async (txPromise: Promise<any>): Promise<boolean> => {
  const txResp: ethers.providers.TransactionResponse = await txPromise;
  await txResp.wait();
  await new Promise(r => setTimeout(r, 10000)); // wait for RPC to update chain state
  return true;
}

const MiniChef = "0x849C283375A156A6632E8eE928308Fcb61306b7B";
const opRewarder = "0xE039f8102319aF854fe11489a19d6b5d2799ADa7";
const auroraPickleEmissions = BigNumber.from("470038680555555");
const opEmissions = BigNumber.from("3000000000000000");//"12860082304500000"); // roughly = 200000*1e18/(60*60*24*30*6)
start(ChainNetwork.Optimism, auroraPickleEmissions, opEmissions);
