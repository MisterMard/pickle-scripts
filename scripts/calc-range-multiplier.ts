import { Contract } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";

const poolAbi = [
  "function observe(uint32[]) view returns(int56[], uint160[])",
  "function tickSpacing() view returns(int24)",
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function slot0() view returns(uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

const tokenAbi = [
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
];

const stratAbi = [
  "function tick_lower() view returns(int24)",
  "function tick_upper() view returns(int24)"
];

function roundToMultiple(x: number, multiple: number) {
  let value = x;
  while (value % multiple > 0) {
    value++;
  }
  return value;
}

function getBaseLog(x: number, decimalMultiplier: number) {
  const price = x / decimalMultiplier;
  const baseLog = Math.log(price) / Math.log(1.0001);
  return baseLog;
}

const main = async () => {
  const poolAddr = "0x85149247691df622eaF1a8Bd0CaFd40BC45154a9";
  const stratAddr = "0x1570B5D17a0796112263F4E3FAeee53459B41A49"
  // Max and min price range for a set period (token1 per token0)
  const periodPriceRange = [ 0.0008, 0.0004,];

  const provider = new JsonRpcProvider(
    "https://opt-mainnet.g.alchemy.com/v2/mk-iKUdTO7nJqOgCsa1E_bFYU7l6aecl"
    // "https://rpc.ankr.com/eth"
  );
  const pool = new Contract(poolAddr, poolAbi, provider);
  const strat = new Contract(stratAddr,stratAbi,provider);

  const token0 = new Contract(await pool.token0(), tokenAbi, provider);
  const token1 = new Contract(await pool.token1(), tokenAbi, provider);

  const symbol0 = await token0.symbol();
  const symbol1 = await token1.symbol();
  console.log(`Max price: ${periodPriceRange[0]} ${symbol1}/${symbol0}`);
  console.log(`Min price: ${periodPriceRange[1]} ${symbol1}/${symbol0}`);
  console.log("");

  const decimal0 = await token0.decimals();
  const decimal1 = await token1.decimals();
  const decimalMultiplier = Math.pow(10, decimal0 - decimal1);

  const periodTicks = [
    getBaseLog(periodPriceRange[0], decimalMultiplier),
    getBaseLog(periodPriceRange[1], decimalMultiplier),
  ];
  const periodTickRange = periodTicks[0] - periodTicks[1];

  const tickSpacing = await pool.tickSpacing();

  // Get current average tick value for the the past 5 mins
  const [cumulativeTicks] = await pool.observe([300, 0]);
  const averageTick = Math.ceil(
    (cumulativeTicks[1].toNumber() - cumulativeTicks[0].toNumber()) / 300
  );

  const tickRangeMultiplier = Math.ceil(periodTickRange / 2 / tickSpacing);

  // Round currentTick to the nearest tickSpacing multiple to keep things even
  const currentTickRounded = roundToMultiple(averageTick, tickSpacing);

  const calculatedUpperTick = currentTickRounded + tickRangeMultiplier * tickSpacing;
  const calculatedLowerTick = currentTickRounded - tickRangeMultiplier * tickSpacing;

  const calculatedPriceRange = [
    Math.pow(1.0001, calculatedUpperTick) * decimalMultiplier,
    Math.pow(1.0001, calculatedLowerTick) * decimalMultiplier,
  ];

  const expectedRange = periodPriceRange[0] - periodPriceRange[1];
  const calculatedRange = calculatedPriceRange[0] - calculatedPriceRange[1];

  const currentUpperTick = await strat.tick_upper();
  const currentLowerTick = await strat.tick_lower();
  const currentTickRange = currentUpperTick-currentLowerTick;
  const currentTickMultiplier = Math.ceil(currentTickRange / 2 / tickSpacing);

  const currentPriceRange = [
    Math.pow(1.0001, currentUpperTick) * decimalMultiplier,
    Math.pow(1.0001, currentLowerTick) * decimalMultiplier,
  ]

  console.log(`Expected Price Range: ${expectedRange}`);
  console.log(`Expected Tick Range: ${periodTickRange}`);
  console.log(``);
  console.log(`Calculated Price Range: ${calculatedRange}`);
  console.log(`Calculated Tick Range: ${calculatedUpperTick - calculatedLowerTick}`);
  console.log(`Calculated Tick Multiplier: ${tickRangeMultiplier}`);
  console.log(``);
  console.log(`Current Max Price: ${currentPriceRange[0]} ${symbol1}/${symbol0}`);
  console.log(`Current Min Price: ${currentPriceRange[1]} ${symbol1}/${symbol0}`);
  console.log(`Current Tick Range: ${currentTickRange}`);
  console.log(`Current Tick Multiplier: ${currentTickMultiplier}`);
  console.log(``);
};

main();
