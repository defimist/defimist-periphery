import chai, { expect } from 'chai'
import { Contract, utils } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { BigNumber, bigNumberify, Interface } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { expandTo18Decimals, mineBlock, MINIMUM_LIQUIDITY } from './shared/utilities'
import { defimistFixture } from './shared/fixtures'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('DefimistRelayer', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet, wallet2] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let token0: Contract
  let token1: Contract
  let weth: Contract
  let wethPartner: Contract
  let wethPair: Contract
  let defimistPair: Contract
  let defimistFactory: Contract
  let defimistRouter: Contract
  let uniPair: Contract
  let uniFactory: Contract
  let uniRouter: Contract
  let oracleCreator: Contract
  let dmRelayer: Contract
  let tokenPair: Contract
  let owner: String

  async function addLiquidity(amount0: BigNumber = defaultAmountA, amount1: BigNumber = defaultAmountB) {
    if (!amount0.isZero()) await token0.transfer(defimistPair.address, amount0)
    if (!amount1.isZero()) await token1.transfer(defimistPair.address, amount1)
    await defimistPair.mint(dmRelayer.address, overrides)
  }

  const defaultAmountA = expandTo18Decimals(1)
  const defaultAmountB = expandTo18Decimals(4)
  const expectedLiquidity = expandTo18Decimals(2)
  const defaultPriceTolerance = 10000 // 1%
  const defaultMinReserve = expandTo18Decimals(2)
  const defaultMaxWindowTime = 300 // 5 Minutes

  beforeEach('deploy fixture', async function() {
    const fixture = await loadFixture(defimistFixture)
    token0 = fixture.token0
    token1 = fixture.token1
    weth = fixture.WETH
    wethPartner = fixture.WETHPartner
    wethPair = fixture.WETHPair
    defimistPair = fixture.pair
    defimistFactory = fixture.defimistFactory
    defimistRouter = fixture.defimistRouter
    uniPair = fixture.uniPair
    uniFactory = fixture.uniFactory
    uniRouter = fixture.uniRouter
    oracleCreator = fixture.oracleCreator
    dmRelayer = fixture.dmRelayer
  })

  beforeEach('fund the relayer contract to spend ERC20s and ETH', async () => {
    await token0.transfer(dmRelayer.address, expandTo18Decimals(999))
    await token1.transfer(dmRelayer.address, expandTo18Decimals(999))
    await wethPartner.transfer(dmRelayer.address, expandTo18Decimals(999))
    await wallet.sendTransaction({
      to: dmRelayer.address,
      value: utils.parseEther('999')
    })
    owner = await dmRelayer.owner()
  })

  // 1/1/2020 @ 12:00 am UTC
  // cannot be 0 because that instructs ganache to set it to current timestamp
  // cannot be 86400 because then timestamp 0 is a valid historical observation
  const startTime = 1577836800
  const defaultDeadline = 1577836800 + 86400 // 24 hours

  // must come before adding liquidity to pairs for correct cumulative price computations
  // cannot use 0 because that resets to current timestamp
  beforeEach(`set start time to ${startTime}`, () => mineBlock(provider, startTime))

  describe('Liquidity provision', () => {
    it('requires correct order input', async () => {
      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          token0.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_FACTORY')

      const dmRelayerFromWallet2 = dmRelayer.connect(wallet2)
      await expect(
        dmRelayerFromWallet2.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: CALLER_NOT_OWNER')

      await expect(
        dmRelayer.orderLiquidityProvision(
          token1.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_PAIR')

      await expect(
        dmRelayer.orderLiquidityProvision(
          token1.address,
          token0.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_TOKEN_ORDER')

      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          0,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_TOKEN_AMOUNT')

      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_TOLERANCE')

      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          1577836800,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: DEADLINE_REACHED')
    })

    it('provides initial liquidity immediately with ERC20/ERC20 pair', async () => {
      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)
        .to.emit(defimistPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(defimistPair, 'Transfer')
        .withArgs(AddressZero, dmRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(defimistPair, 'Sync')
        .withArgs(defaultAmountA, defaultAmountB)
        .to.emit(defimistPair, 'Mint')
        .withArgs(defimistRouter.address, defaultAmountA, defaultAmountB)
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await defimistPair.balanceOf(dmRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides initial liquidity with ERC20/ERC20 pair after Uniswap price observation', async () => {
      await token0.transfer(uniPair.address, expandTo18Decimals(10))
      await token1.transfer(uniPair.address, expandTo18Decimals(40))
      await uniPair.mint(wallet.address, overrides)

      await mineBlock(provider, startTime + 10)
      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(dmRelayer.executeOrder(0))
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(defimistPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(defimistPair, 'Transfer')
        .withArgs(AddressZero, dmRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(defimistPair, 'Sync')
        .withArgs(defaultAmountA, defaultAmountB)
        .to.emit(defimistPair, 'Mint')
        .withArgs(defimistRouter.address, defaultAmountA, defaultAmountB)

      expect(await defimistPair.balanceOf(dmRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides initial liquidity immediately with ETH/ERC20 pair', async () => {
      await expect(
        dmRelayer.orderLiquidityProvision(
          AddressZero,
          wethPartner.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address,
          { ...overrides, value: defaultAmountA }
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, dmRelayer.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPair, 'Sync')
        .withArgs(defaultAmountB, defaultAmountA)
        .to.emit(wethPair, 'Mint')
        .withArgs(defimistRouter.address, defaultAmountB, defaultAmountA)
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await wethPair.balanceOf(dmRelayer.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    })

    it('provides liquidity with ERC20/ERC20 pair after price observation', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(dmRelayer.executeOrder(0))
        .to.emit(defimistPair, 'Transfer')
        .withArgs(AddressZero, dmRelayer.address, expectedLiquidity)
        .to.emit(defimistPair, 'Sync')
        .withArgs(defaultAmountA.add(expandTo18Decimals(10)), defaultAmountB.add(expandTo18Decimals(40)))
        .to.emit(defimistPair, 'Mint')
        .withArgs(defimistRouter.address, defaultAmountA, defaultAmountB)
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await defimistPair.balanceOf(dmRelayer.address)).to.eq(expandTo18Decimals(22).sub(MINIMUM_LIQUIDITY))
    })

    it('provides liquidity with ETH/ERC20 pair after price observation', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(10) })
      await weth.transfer(wethPair.address, expandTo18Decimals(10))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(40))
      await wethPair.mint(wallet.address)
      const liquidityBalance = await wethPair.balanceOf(dmRelayer.address)

      await expect(
        dmRelayer.orderLiquidityProvision(
          AddressZero,
          wethPartner.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address,
          { ...overrides, value: defaultAmountA }
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      await mineBlock(provider, startTime + 10)
      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(dmRelayer.executeOrder(0))
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Transfer')
        .withArgs(AddressZero, dmRelayer.address, expectedLiquidity)
        .to.emit(wethPair, 'Sync')
        .withArgs(defaultAmountB.add(expandTo18Decimals(40)), defaultAmountA.add(expandTo18Decimals(10)))
        .to.emit(wethPair, 'Mint')
        .withArgs(defimistRouter.address, defaultAmountB, defaultAmountA)

      expect(await wethPair.balanceOf(dmRelayer.address)).to.eq(expectedLiquidity.add(liquidityBalance))
    })

    it('withdraws an order after expiration', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      const startBalance0 = await token0.balanceOf(owner)
      const startBalance1 = await token1.balanceOf(owner)

      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          0,
          0,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      await mineBlock(provider, startTime + 10)
      await dmRelayer.updateOracle(0)
      await expect(dmRelayer.withdrawExpiredOrder(0)).to.be.revertedWith('DefimistRelayer: DEADLINE_NOT_REACHED')
      await mineBlock(provider, defaultDeadline + 500)
      await dmRelayer.withdrawExpiredOrder(0)
      expect(await token0.balanceOf(owner)).to.eq(startBalance0.add(defaultAmountA))
      expect(await token1.balanceOf(owner)).to.eq(startBalance1.add(defaultAmountB))
    })
  })

  describe('Liquidity removal', () => {
    it('requires correct order input', async () => {
      const liquidityAmount = expandTo18Decimals(1)

      await expect(
        dmRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          token0.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_FACTORY')

      const dmRelayerFromWallet2 = dmRelayer.connect(wallet2)
      await expect(
        dmRelayerFromWallet2.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: CALLER_NOT_OWNER')

      await expect(
        dmRelayer.orderLiquidityRemoval(
          token1.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_PAIR')

      await expect(
        dmRelayer.orderLiquidityRemoval(
          token1.address,
          token0.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_TOKEN_ORDER')

      await expect(
        dmRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          0,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_LIQUIDITY_AMOUNT')

      await expect(
        dmRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          1000000000,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: INVALID_TOLERANCE')

      await expect(
        dmRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          liquidityAmount,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          startTime - 1200,
          defimistFactory.address
        )
      ).to.be.revertedWith('DefimistRelayer: DEADLINE_REACHED')
    })

    it('removes liquidity with ERC20/ERC20 pair after price observation', async () => {
      await addLiquidity(expandTo18Decimals(2), expandTo18Decimals(8))
      await mineBlock(provider, startTime + 20)
      await expect(
        dmRelayer.orderLiquidityRemoval(
          token0.address,
          token1.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          10,
          10,
          0,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 2)

      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)
      await expect(await defimistPair.balanceOf(dmRelayer.address)).to.eq(expandTo18Decimals(4).sub(MINIMUM_LIQUIDITY))

      await expect(dmRelayer.executeOrder(0))
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(defimistPair, 'Transfer')
        .withArgs(dmRelayer.address, defimistPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(defimistPair, 'Transfer')
        .withArgs(defimistPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(token0, 'Transfer')
        .withArgs(defimistPair.address, dmRelayer.address, expandTo18Decimals(1).sub(500))
        .to.emit(token1, 'Transfer')
        .withArgs(defimistPair.address, dmRelayer.address, expandTo18Decimals(4).sub(2000))
        .to.emit(defimistPair, 'Sync')
        .withArgs(expandTo18Decimals(1).add(500), expandTo18Decimals(4).add(2000))
        .to.emit(defimistPair, 'Burn')
        .withArgs(
          defimistRouter.address,
          expandTo18Decimals(1).sub(500),
          expandTo18Decimals(4).sub(2000),
          dmRelayer.address
        )

      await expect(await defimistPair.balanceOf(dmRelayer.address)).to.eq(expandTo18Decimals(2))
    })

    it('removes liquidity with ETH/ERC20 pair after price observation', async () => {
      await weth.deposit({ ...overrides, value: expandTo18Decimals(10) })
      await weth.transfer(wethPair.address, expandTo18Decimals(10))
      await wethPartner.transfer(wethPair.address, expandTo18Decimals(40))
      await wethPair.mint(dmRelayer.address)
      await mineBlock(provider, startTime + 100)

      await expect(
        dmRelayer.orderLiquidityRemoval(
          AddressZero,
          wethPartner.address,
          expectedLiquidity.sub(MINIMUM_LIQUIDITY),
          10,
          10,
          0,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 2)

      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 350)
      await dmRelayer.updateOracle(0)
      await mineBlock(provider, startTime + 700)

      expect(await wethPair.balanceOf(dmRelayer.address)).to.eq(expandTo18Decimals(20).sub(1000))
      await expect(dmRelayer.executeOrder(0))
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)
        .to.emit(wethPair, 'Transfer')
        .withArgs(dmRelayer.address, wethPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPair, 'Transfer')
        .withArgs(wethPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
        .to.emit(wethPartner, 'Transfer')
        .withArgs(wethPair.address, dmRelayer.address, expandTo18Decimals(4).sub(2000))
        .to.emit(weth, 'Transfer')
        .withArgs(wethPair.address, dmRelayer.address, expandTo18Decimals(1).sub(500))
        .to.emit(wethPair, 'Sync')
        .withArgs(expandTo18Decimals(36).add(2000), expandTo18Decimals(9).add(500))
        .to.emit(wethPair, 'Burn')
        .withArgs(
          defimistRouter.address,
          expandTo18Decimals(4).sub(2000),
          expandTo18Decimals(1).sub(500),
          dmRelayer.address
        )

      expect(await wethPair.balanceOf(dmRelayer.address)).to.eq(expandTo18Decimals(18))
    })
  })

  describe('Oracle price calulation', () => {
    it('reverts oracle update if minReserve is not reached', async () => {
      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      await expect(dmRelayer.updateOracle(0)).to.be.revertedWith('DefimistRelayer: RESERVE_TO_LOW')
    })

    it('updates price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dmRelayer.updateOracle(0)
      await expect(dmRelayer.updateOracle(0)).to.be.revertedWith('OracleCreator: PERIOD_NOT_ELAPSED')
      await mineBlock(provider, startTime + 350)
      await dmRelayer.updateOracle(0)
    })

    it('consumes 168339 to update the price oracle', async () => {
      await addLiquidity(expandTo18Decimals(10), expandTo18Decimals(40))
      await mineBlock(provider, startTime + 10)
      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          defimistFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      let tx = await dmRelayer.updateOracle(0)
      let receipt = await provider.getTransactionReceipt(tx.hash)
      expect(receipt.gasUsed).to.eq(bigNumberify('168339'))
    })

    it('provides the liquidity with the correct price based on uniswap price', async () => {
      let timestamp = startTime

      /* Defimist price of 1:4 */
      await token0.transfer(defimistPair.address, expandTo18Decimals(100))
      await token1.transfer(defimistPair.address, expandTo18Decimals(400))
      await defimistPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      /* Uniswap starting price of 1:2 */
      await token0.transfer(uniPair.address, expandTo18Decimals(100))
      await token1.transfer(uniPair.address, expandTo18Decimals(200))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 100))

      await expect(
        dmRelayer.orderLiquidityProvision(
          token0.address,
          token1.address,
          defaultAmountA,
          defaultAmountB,
          defaultPriceTolerance,
          defaultMinReserve,
          defaultMinReserve,
          defaultMaxWindowTime,
          defaultDeadline,
          uniFactory.address
        )
      )
        .to.emit(dmRelayer, 'NewOrder')
        .withArgs(0, 1)

      await dmRelayer.updateOracle(0)
      await mineBlock(provider, (timestamp += 30))

      // Uniswap move price ratio to 1:5
      await token0.transfer(uniPair.address, expandTo18Decimals(200))
      await token1.transfer(uniPair.address, expandTo18Decimals(1300))
      await uniPair.mint(wallet.address, overrides)
      await mineBlock(provider, (timestamp += 150))
      await dmRelayer.updateOracle(0)

      // Uniswap price should be more then four
      expect(await oracleCreator.consult(0, token0.address, 100)).to.eq(451)

      await expect(dmRelayer.executeOrder(0))
        .to.emit(dmRelayer, 'ExecutedOrder')
        .withArgs(0)

      expect(await defimistPair.balanceOf(dmRelayer.address)).to.eq(bigNumberify('1988826815642458100'))
    }).retries(3)
  })
})
