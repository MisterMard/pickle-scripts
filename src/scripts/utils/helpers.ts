import { ethers } from "ethers";
import { MultiProvider } from "ethers-multiprovider";
import { ChainNetwork, Chains } from "picklefinance-core";
import { RAW_CHAIN_BUNDLED_DEF } from "picklefinance-core/lib/chain/Chains.js";
import { AssetEnablement, PickleModelJson } from "picklefinance-core/lib/model/PickleModelJson.js";
import fetch from "cross-fetch";
import readLine from "readline-sync";
import * as dotenv from "dotenv";
dotenv.config();

const RPCs = {
  10: "https://1rpc.io/op",//"https://mainnet.optimism.io",//"https://rpc.ankr.com/optimism",  // optimism
  1: "https://rpc.ankr.com/eth",
};

const getRpc = (id: number | ChainNetwork, modelJson: PickleModelJson) => {
  const chainId = typeof id === "number" ? id : Chains.get(id).id;
  let rpc = RPCs[chainId];
  if (!rpc) rpc = modelJson.chains.find(chain => chain.chainId === id).rpcs[0];
  return rpc;
}

const initializedMPs: { [chainId: number]: { q: boolean; multiProvider?: MultiProvider } } = {};
export const getMultiproviderFor = async (chain: number | ChainNetwork, modelJson: PickleModelJson) => {
  const chainId = typeof chain === "number" ? chain : Chains.get(chain).id;
  while (initializedMPs[chainId]?.q) {
    await new Promise(r => setTimeout(r, Math.random() * 1000 + 1000));
  }
  if (initializedMPs[chainId]?.multiProvider) return initializedMPs[chainId].multiProvider;

  initializedMPs[chainId] = { q: true };
  const opts: { batchSize: number; multicallAddress?: string } = {
    batchSize: 50,
  };

  const multicallAddress = RAW_CHAIN_BUNDLED_DEF.find((x) => x.network === chain)?.multicallAddress;
  if (multicallAddress) opts.multicallAddress = multicallAddress;
  const multiProvider = new MultiProvider(chainId, opts);
  await multiProvider.addProvider(new ethers.providers.JsonRpcProvider(getRpc(chainId, modelJson)));

  initializedMPs[chainId].multiProvider = multiProvider;
  initializedMPs[chainId].q = false;
  return multiProvider;
}

export const getProviderFor = (chain: number | ChainNetwork, modelJson: PickleModelJson) => {
  const chainId = typeof chain === "number" ? chain : Chains.get(chain).id;
  const provider = new ethers.providers.JsonRpcProvider(getRpc(chainId, modelJson));
  return provider;
}

export const getChainActiveJars = (chain: ChainNetwork, modelJson: PickleModelJson) => {
  const jars = modelJson.assets.jars.filter(
    (jar) => jar.chain === chain && jar.enablement === AssetEnablement.ENABLED
  );
  return jars;
}

export const getPickleModelJson = async () => {
  const pfcore: PickleModelJson = await fetch(
    "https://api.pickle.finance/prod/protocol/pfcore/"
  ).then(async (x) => await x.json());
  return pfcore;
}

export const getWallet = () => {
  return new ethers.Wallet(process.env.PRIVATE_KEY);
}

export const getWalletFor = (chain: number | ChainNetwork, modelJson: PickleModelJson) => {
  const provider = getProviderFor(chain, modelJson);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  return wallet;
}


export const printTable = (headers: string[], body: string[][]) => {
  const fmtStrLen = (str: string, len: number) => {
    const pre = " ".repeat(Math.floor((len - str.length) / 2));
    const trail = " ".repeat(Math.ceil((len - str.length) / 2));
    return pre.concat(str).concat(trail);
  };
  const getFieldLength = (fieldOrder: number) => {
    let len = headers[fieldOrder].length;
    body?.forEach(row => {
      const rowLength = row[fieldOrder]?.length ?? 0;
      len = len > rowLength ? len : rowLength;
    });
    return Math.ceil((len + 2) / 2) * 2;
  }
  const fieldsLengths: number[] = body[0].map((_, idx) => getFieldLength(idx));
  const rowWidth = fieldsLengths.reduce((cum, cur) => cum + cur + 1, 1);
  const separator = { horizontal: "-", vertical: "|" };

  headers.forEach((header, idx) => process.stdout.write(separator.vertical + fmtStrLen(header, fieldsLengths[idx])));

  console.log(separator.vertical);
  console.log("-".repeat(rowWidth));
  body.forEach(row => {
    row.forEach((field, idx) => process.stdout.write(separator.vertical + fmtStrLen(field??"", fieldsLengths[idx])))
    console.log(separator.vertical);
  });
  console.log("-".repeat(rowWidth));
}

export const promptChain = (): ChainNetwork => {
  const allChains = Object.keys(ChainNetwork)
  console.log("Choose a chain:");
  allChains.forEach((chain, idx) => console.log(`\t${idx}) ${chain}`))
  const choice = readLine.question("\tChoice: ", { limit: allChains.map((_, idx) => `${idx}`) });
  return ChainNetwork[allChains[choice]]
}

