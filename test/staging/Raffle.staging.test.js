const {assert, expect} = require("chai");
const {getNamedAccounts, deployments, ethers, network } = require("hardhat");
const {developmentChains, networkConfig} = require("../../helper-hardhat-config");

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle staging tests", function() {
        let raffle, raffleEntranceFee, deployer, interval;

        beforeEach(async function() {
            deployer = (await getNamedAccounts()).deployer;
            raffle = await ethers.getContract("Raffle", deployer);
            raffleEntranceFee = await raffle.getEntranceFee();
        });

        describe("fulfillRandomWords", function(){

            it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async function () {
                console.log("Setting up test...")

                const startingTimestamp = await raffle.getLatestTimestamp();
                const accounts = await ethers.getSigners();

                console.log("Setting up Listener...")
                await new Promise(async (resolve, reject) => {
                    raffle.once("WinnerPicked", async () => {
                        console.log("WinnerPicked event fired!");

                        try {
                            const recentWinner = await raffle.getRecentWinner();
                            const raffleState = await raffle.getRaffleState();
                            const winnerEndingBalance = await accounts[0].getBalance();
                            const endingTimestamp = await raffle.getLatestTimestamp();

                            await expect(raffle.getPlayer(0)).to.be.reverted;
                            assert.equal(recentWinner.toString(), accounts[0].address);
                            assert.equal(raffleState.toString(), "0");
                            assert.equal(
                                winnerEndingBalance.toString(),
                                winnerStartingBalance
                                    .add(raffleEntranceFee)
                                    .toString()
                            );
                            assert(endingTimestamp > startingTimestamp);
                            resolve();
                        } catch(e) {
                            console.error(e);
                            reject(e)
                        }
                    })
                    console.log("Entering Raffle...")
                    const tx = await raffle.enterRaffle({value: raffleEntranceFee});
                    await tx.wait(1);
                    console.log("Ok, time to wait...")
                    const winnerStartingBalance = await accounts[0].getBalance()

                })
            })
        })
    })
