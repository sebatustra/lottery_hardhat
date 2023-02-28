const {assert, expect} = require("chai");
const { getNamedAccounts, deployments, ethers, network} = require("hardhat");
const {developmentChains, networkConfig} = require("../../helper-hardhat-config");


!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle uint tests", function () {
        let raffle, VRFCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
        const chaindId = network.config.chainId;

        beforeEach(async function() {
            accounts = await ethers.getSigners()
            deployer = (await getNamedAccounts()).deployer;
            await deployments.fixture(["all"]);
            raffle = await ethers.getContract("Raffle", deployer);
            VRFCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
            raffleEntranceFee = await raffle.getEntranceFee();
            interval = await raffle.getInterval();
        })

        describe("constructor", function() {
            it("initializes the raffle correctly", async function() {
                const raffleState = await raffle.getRaffleState();
                assert.equal(raffleState.toString(), "0");
                assert.equal(interval.toString(), networkConfig[chaindId]["interval"])
            })
        })

        describe("enterRaffle", function () {
            it("reverts when you dont pay enough", async function () {
                await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETHEntered")
            })
            it("Records players when they enter", async function() {
                await raffle.enterRaffle({value: raffleEntranceFee});
                const playerFromContract = await raffle.getPlayer(0);
                assert.equal(playerFromContract, deployer);
            })
            it("emits event on enter", async function() {
                await expect(raffle.enterRaffle({value: raffleEntranceFee})).to.emit(raffle, "RaffleEnter")
            })
            it("doesn't allow entrance when raffle is calculating", async function() {
                await raffle.enterRaffle({value: raffleEntranceFee});
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({method: "evm_mine", params: []});
                //pretend to be chainlink keeper
                await raffle.performUpkeep([]);
                await expect(raffle.enterRaffle({value: raffleEntranceFee})).to.be.revertedWith("Raffle__NotOpen")
            })
        })

        describe("checkUpkeep", function() {
            it("returns false if people haven't sent any ETH", async function() {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.send( "evm_mine",[]);
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                assert(!upkeepNeeded);
            })

            it("returns false if raffle isn't open", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                await raffle.performUpkeep("0x");
                const raffleState = await raffle.getRaffleState();
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                assert.equal(raffleState.toString(), "1");
                assert.equal(upkeepNeeded, false)
            })

            it("returns false if enough time hasn't passed", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(!upkeepNeeded)
            })
            it("returns true if enough time has passed, has players, eth, and is open", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(upkeepNeeded)
            })
        })

        describe("performUpkeep", function() {
            it("it can only run if performUpkeep is true", async function() {
                await raffle.enterRaffle({value: raffleEntranceFee});
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.send("evm_mine", []);
                const tx = await raffle.performUpkeep([]);
                assert(tx)
            })
            it("reverts when checkUpkeep is false", async function() {
                await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpkeepNotNeeded")
            })
            it("updates the raffle state, emits an event, and calls the vrf coordinator", async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.request({ method: "evm_mine", params: [] });
                const txResponse = await raffle.performUpkeep([]);
                const txReceipt = await txResponse.wait(1);
                const requestId = txReceipt.events[1].args.requestId;
                const raffleState = await raffle.getRaffleState();
                assert(requestId.toNumber() > 0)
                assert.equal(raffleState.toString(), "1");
                await expect(txResponse).to.emit(raffle, "RequestedRaffleWinner");

            })

        })

        describe("fulfillRandomWords", function() {

            beforeEach(async function() {
                await raffle.enterRaffle({ value: raffleEntranceFee });
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.send("evm_mine", []);
            })

            it("can only be called after performUpkeep", async function() {
               await expect(
                    VRFCoordinatorV2Mock.fulfillRandomWords(0, raffle.address))
                    .to.be.revertedWith("nonexistent request");
                await expect(
                    VRFCoordinatorV2Mock.fulfillRandomWords(1, raffle.address))
                    .to.be.revertedWith("nonexistent request");
            })

            it("picks a winner, resets the lottery, and sends money", async function () {
                const additionalEntrances = 3 // to test
                const startingIndex = 1
                for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) { // i = 2; i < 5; i=i+1
                    raffle = raffle.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                }
                const startingTimestamp = await raffle.getLatestTimestamp();

                await new Promise(async (resolve, reject) => {
                    raffle.once("WinnerPicked", async () => {
                        console.log("Found the event!");
                        try {
                            const recentWinner = await raffle.getRecentWinner();

                            const winnerEndingBalance = await accounts[1].getBalance()
                            const raffleState = await raffle.getRaffleState();
                            const endingTimestamp = await raffle.getLatestTimestamp();
                            const numPlayers = await raffle.getNumberOfPlayers();
                            assert.equal(numPlayers.toString(), "0");
                            assert.equal(raffleState.toString(), "0");
                            assert(endingTimestamp > startingTimestamp)
                            assert.equal(
                                winnerEndingBalance.toString(),
                                winnerStartingBalance.add(
                                    raffleEntranceFee
                                        .mul(additionalEntrances)
                                        .add(raffleEntranceFee)
                                        .toString()
                                ).toString()
                            )
                        } catch(e) {
                            reject(e)
                        }
                        resolve()
                    })
                    const tx = await raffle.performUpkeep([]);
                    const txReceipt = await tx.wait(1);
                    const winnerStartingBalance = await accounts[1].getBalance();
                    await VRFCoordinatorV2Mock.fulfillRandomWords(
                        txReceipt.events[1].args.requestId,
                        raffle.address
                    )

                })

            })
        })

    })
