import { ethers } from "ethers";
import { MultiProvider } from "ethers-multiprovider";
import { ChainNetwork, Chains } from "picklefinance-core";
import { RAW_CHAIN_BUNDLED_DEF } from "picklefinance-core/lib/chain/Chains";
import { AssetEnablement, PickleModelJson } from "picklefinance-core/lib/model/PickleModelJson";
import fetch from "cross-fetch";



export const getRpc = (id: number | ChainNetwork, modelJson: PickleModelJson) => {
  if (typeof id === "number") return modelJson.chains.find(chain => chain.chainId === id).rpcs[0];
  return modelJson.chains.find(chain => chain.network === id).rpcs[0];
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



