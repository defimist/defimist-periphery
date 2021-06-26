import { Wallet, Contract } from 'ethers'
import { Web3Provider } from 'ethers/providers'
import { deployContract } from 'ethereum-waffle'

import { expandTo18Decimals } from './utilities'

import DefimistFactory from 'defimist-core/build/DefimistFactory.json'
import IDefimistPair from 'defimist-core/build/IDefimistPair.json'

import ERC20 from '../../build/ERC20.json'
import WETH9 from '../../build/WETH9.json'
import DefimistRouter from '../../build/DefimistRouter.json'
import RouterEventEmitter from '../../build/RouterEventEmitter.json'
import DefimistRelayer from '../../build/DefimistRelayer.json'
import OracleCreator from '../../build/OracleCreator.json'


const overrides = {
  gasLimit: 9999999
}

interface DefimistFixture {
  token0: Contract
  token1: Contract
  WETH: Contract
  WETHPartner: Contract
  defimistFactory: Contract
  routerEventEmitter: Contract
  router: Contract
  pair: Contract
  WETHPair: Contract
  defimistPair: Contract
  defimistRouter: Contract
  uniFactory: Contract
  uniRouter: Contract
  uniPair: Contract
  oracleCreator: Contract
  dmRelayer: Contract
}

export async function defimistFixture(provider: Web3Provider, [wallet]: Wallet[]): Promise<DefimistFixture> {
  // deploy tokens
  const tokenA = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const tokenB = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])
  const WETH = await deployContract(wallet, WETH9)
  const WETHPartner = await deployContract(wallet, ERC20, [expandTo18Decimals(10000)])

  // deploy DefimistFactory
  const defimistFactory = await deployContract(wallet, DefimistFactory, [wallet.address])

  // deploy router
  const router = await deployContract(wallet, DefimistRouter, [defimistFactory.address, WETH.address], overrides)
  const defimistRouter = await deployContract(wallet, DefimistRouter, [defimistFactory.address, WETH.address], overrides)
  const uniRouter = await deployContract(wallet, DefimistRouter, [defimistFactory.address, WETH.address], overrides)

  // event emitter for testing
  const routerEventEmitter = await deployContract(wallet, RouterEventEmitter, [])

  // initialize DefimistFactory
  await defimistFactory.createPair(tokenA.address, tokenB.address)
  const pairAddress = await defimistFactory.getPair(tokenA.address, tokenB.address)
  const pair = new Contract(pairAddress, JSON.stringify(IDefimistPair.abi), provider).connect(wallet)
  const defimistPair = new Contract(pairAddress, JSON.stringify(IDefimistPair.abi), provider).connect(wallet)

  const token0Address = await pair.token0()
  const token0 = tokenA.address === token0Address ? tokenA : tokenB
  const token1 = tokenA.address === token0Address ? tokenB : tokenA

  await defimistFactory.createPair(WETH.address, WETHPartner.address)
  const WETHPairAddress = await defimistFactory.getPair(WETH.address, WETHPartner.address)
  const WETHPair = new Contract(WETHPairAddress, JSON.stringify(IDefimistPair.abi), provider).connect(wallet)

  // deploy UniswapFactory
  const uniFactory = await deployContract(wallet, DefimistFactory, [wallet.address])

  // initialize DefimistFactory
  await uniFactory.createPair(tokenA.address, tokenB.address)
  const uniPairAddress = await uniFactory.getPair(tokenA.address, tokenB.address)
  const uniPair = new Contract(uniPairAddress, JSON.stringify(IDefimistPair.abi), provider).connect(wallet)

  // deploy oracleCreator
  const oracleCreator = await deployContract(wallet, OracleCreator)

  const dmRelayer = await deployContract(
    wallet,
    DefimistRelayer,
    [wallet.address, defimistFactory.address, defimistRouter.address, uniFactory.address, uniRouter.address, WETH.address, oracleCreator.address],
    overrides
  )

  return {
    token0,
    token1,
    WETH,
    WETHPartner,
    defimistFactory,
    routerEventEmitter,
    router,
    pair,
    WETHPair,
    defimistPair,
    defimistRouter,
    uniFactory,
    uniRouter,
    uniPair,
    oracleCreator,
    dmRelayer
  }
}