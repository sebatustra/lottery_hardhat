const { run } = require("hardhat")

async function verify(contractAdress, args) {
    console.log("verifying contract");
    try {
        await run("verify:verify", {
            address: contractAdress,
            constructorArguments: args,
        })
    } catch (e) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log("contract already verified")
        } else {
            console.error(e);
        }
    }

}

module.exports = { verify }
