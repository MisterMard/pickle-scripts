import { BigNumber, ethers } from "ethers";
import { Contract as MultiContract } from "ethers-multiprovider";
import { ChainNetwork } from "picklefinance-core";
import {
  AssetProtocol,
  IExternalToken,
  JarDefinition,
  PickleModelJson,
} from "picklefinance-core/lib/model/PickleModelJson";
import { getAbiWithCalls } from "./jars-fees";
import {
  getChainActiveJars,
  getMultiproviderFor,
  getPickleModelJson,
} from "./utils/helpers";

const SecondsInYear = 60 * 60 * 24 * 365;
const maxAllocPoint = 10_000;
const TargetLiquidity: { [P in AssetProtocol]?: number } = {
  "ZipSwap": 0.2,
  "Uniswap V3": 0.1,
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

  const picklePerSecondList = await Promise.all(jars.map((jar, idx) => {
    return getMatchingRewardPerSecond(jar, jarsFees[idx], pickle, modelJson);
  }));
  const opPerSecondList = await Promise.all(jars.map((jar, idx) => {
    return getMatchingRewardPerSecond(jar, jarsFees[idx], op, modelJson);
  }));

  const allocPoints = convertRewardPerSecondToAlloc(
    maxAllocPoint,
    picklePerSecondList
  );
  const opAllocs = convertRewardPerSecondToAlloc(
    maxAllocPoint,
    opPerSecondList
  );

  print(maxPicklePerSecond, maxOpPerSecond, picklePerSecondList, opPerSecondList, allocPoints, opAllocs, jars);
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
  const matchingRewardPerSecond = ethers.utils.parseUnits(profitMatchingReward.toString(), rewardToken.decimals);

  return matchingRewardPerSecond;
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
  pickleAllocs: number[],
  opAllocs: number[],
  jars: JarDefinition[]
) => {
  const calculatedPicklePerSecond = picklePerSecondList.reduce(
    (cum, cur) => cum.add(cur),
    BigNumber.from(0)
  );
  const calculatedOpPerSecond = opPerSecondList.reduce(
    (cum, cur) => cum.add(cur),
    BigNumber.from(0)
  );
  if (maxPicklePerSecond.gt(calculatedPicklePerSecond)) {
    // prettier-ignore
    console.log("❌❌ Warning: Max $PICKLE Per Second is higher than the suggested value.\n\tMax value: " + maxPicklePerSecond.toString() + "\tSuggested value: " + calculatedPicklePerSecond.toString());
  } //else {console.log("Suggested $PICKLE Per Second value: "+ calculatedPicklePerSecond.toString())}
  if (maxOpPerSecond.gt(calculatedOpPerSecond)) {
    // prettier-ignore
    console.log("❌❌ Warning: Max $OP Per Second is higher than the suggested value.\n\tMax value: " + maxOpPerSecond.toString() + "\tSuggested value: " + calculatedOpPerSecond.toString());
  } //else {console.log("Suggested $OP Per Second value: "+ calculatedOpPerSecond.toString())}

  const totalPickleAllocs = pickleAllocs.reduce((cum, cur) => cum + cur, 0);
  const totalOpAllocs = opAllocs.reduce((cum, cur) => cum + cur, 0);
  console.log("|JAR|pickleAllocPoint|opAllocPoint|");
  jars.forEach((jar, idx) =>
    console.log(`|${jar.details.apiKey}|${pickleAllocs[idx]}|${opAllocs[idx]}|`)
  );
  console.log("|TOTAL|" + totalPickleAllocs + "|" + totalOpAllocs + "|");
};

const auroraPickleEmissions = BigNumber.from("218057692300000");
const opEmissions = BigNumber.from("12860082304500000"); // roughly = 200000*1e18/(60*60*24*30*6)
start(ChainNetwork.Optimism, auroraPickleEmissions, opEmissions);
