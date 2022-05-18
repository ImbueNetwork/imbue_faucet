const crypto = require('crypto');

// Telegram API client
const { Telegraf } = require("telegraf");
// this is for address format verification
const UtilCrypto = require("@polkadot/util-crypto");
// connect to the node
const { ApiPromise, WsProvider, Keyring } = require("@polkadot/api");
const { BN } = require("bn.js");
const fs = require("fs");
// this is .json additional types file
const ADDITIONAL_TYPES = require("./types/types.json");


const commands = ["/request", "/schedule", "/approve", "/milestone"]

// this is the Generic Faucet Interface
class GenericFaucetInterface {
  constructor(config) {
    this.types = config.types;
    // pjs api
    this.api = undefined;
    this.mnemonic = config.mnemonic;
    this.keyRing = new Keyring();
    this.providerUrl = config.providerUrl;
    this.amount = config.amount;
    this.tokenName = config.tokenName;
    this.addressType = config.addressType;
    this.timeLimitHours = config.timeLimitHours;
    this.decimals = new BN(config.decimals);
    // Help message when user first starts or types help command
    this.helpMessage = `Welcome to the ${process.env.FAUCET_NAME}! 
    To request for tokens send the message: 

    "/request ADDRESS" 
    with your correct ${this.tokenName} address.
    
    To open your project for funding send the message:
    "/schedule ADDRESS" 

    To approve your project's funding send the message:
    "/approve ADDRESS" 

    To approve your project's first milestone send the message:
    "/milestone ADDRESS"

    with your correct ${this.tokenName} address.
    `;
    // Error Messages
    this.timeLimitMessage = `Sorry please wait for ${this.timeLimitHours} hours, between token requests from the same telegram account!`;
    this.invalidAddressMessage = `Invalid address! Please use the generic substrate format with address type ${this.addressType}!`;
    // record storage (for time limit)
    this.records = {};
  }


  // tries to get valid address from message, if fails, returns undefined
  getAddressFromMessage(message) {
    let address = message.text;
    commands.forEach((command) => {
      address = address.replace(command, '').replace(' ', '');
    });
    const check = UtilCrypto.checkAddress(address, this.addressType);
    if (check[0]) {
      // Address match
      return address;
    } else {
      // Not a valid address
      return undefined;
    }
  }

  // returns the help message
  getHelpMessage() {
    return this.helpMessage;
  }

  // loads json file and inits keyring
  initKeyring() {
    const keyring = new Keyring({ type: "sr25519" });
    // // TODO: better error handling
    this.keyRing = keyring.addFromMnemonic(this.mnemonic);
  }


  // This initializes api
  async initApi() {
    const ws = new WsProvider(this.providerUrl);
    // Instantiate the API

    this.api = await ApiPromise.create({ types: this.types, provider: ws });

    // Retrieve the chain & node information information via rpc calls
    const [chain, nodeName, nodeVersion] = await Promise.all([
      this.api.rpc.system.chain(),
      this.api.rpc.system.name(),
      this.api.rpc.system.version(),
    ]);

    // Log these stats
    console.log(
      `You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`
    );

  }

  async findProjectByAddress(address) {
    const projects = await (await this.api.query.imbueProposals.projects.entries());
    let projectsLength = Object.keys(projects).length;
    for (var i = projectsLength - 1; i >= 0; i--) {
      const [id, project] = projects[i];
      const readableProject = project.toHuman();
      if (readableProject.initiator == address) {
        return readableProject;
      }
    }
  }

  async scheduleRound(message) {
    let response;
    const now = Date.now();
    //   const username = message["from"]["username"];
    const senderId = message["from"]["id"];
    let nonce = crypto.randomBytes(16).toString('base64');
    const address = this.getAddressFromMessage(message);

    if (address) {
      const ws = new WsProvider(this.providerUrl);
      // Instantiate the API
      this.api = await ApiPromise.create({ types: this.types, provider: ws });
      // Retrieve the chain & node information information via rpc calls
      const [chain, nodeName, nodeVersion] = await Promise.all([
        this.api.rpc.system.chain(),
        this.api.rpc.system.name(),
        this.api.rpc.system.version(),
      ]);
      this.initKeyring();
      // Log these stats
      const readableProject = await this.findProjectByAddress(address);
      if (readableProject) {
        console.log("***** scheduling round for project *****");

        console.log(readableProject);
        const lastHeader = await this.api.rpc.chain.getHeader();
        const currentBlockNumber = lastHeader.number.toBigInt();
        const firstMilestone = readableProject.milestones[0]
        const projectId = BigInt(firstMilestone.projectKey);
        const startBlock = currentBlockNumber + BigInt(1);
        const endBlock = startBlock + BigInt(100);
        const hash = await this.api.tx.sudo.sudo(this.api.tx.imbueProposals.scheduleRound(startBlock, endBlock, [projectId])).signAndSend(this.keyRing, ({ events = [], status }) => {
        });
        response = `Project "${readableProject.name.toUpperCase()}" has been scheduled for funding.\n\n Contributors can fund between blocks ${startBlock} and ${endBlock}.`;
        await this.api.disconnect();
      }
    } else {
      response = this.invalidAddressMessage;
    }
    return response;
  }

  async approve(message) {
    let response;
    const now = Date.now();
    //   const username = message["from"]["username"];
    const senderId = message["from"]["id"];
    let nonce = crypto.randomBytes(16).toString('base64');
    const address = this.getAddressFromMessage(message);

    if (address) {
      const ws = new WsProvider(this.providerUrl);
      // Instantiate the API
      this.api = await ApiPromise.create({ types: this.types, provider: ws });
      // Retrieve the chain & node information information via rpc calls
      const [chain, nodeName, nodeVersion] = await Promise.all([
        this.api.rpc.system.chain(),
        this.api.rpc.system.name(),
        this.api.rpc.system.version(),
      ]);
      this.initKeyring();
      // Log these stats
      const readableProject = await this.findProjectByAddress(address);
      if (readableProject) {
        console.log("***** approving project *****");
        console.log(readableProject);
        const firstMilestone = readableProject.milestones[0];

        const projectId = BigInt(firstMilestone.projectKey);

        if (readableProject.contributions.length < 1) {
          response = `Project  "${readableProject.name.toUpperCase()}" has no contributions. Cannot approve funding!`;
        } else {
          const hash = await this.api.tx.sudo.sudo(this.api.tx.imbueProposals.approve(projectId, null)).signAndSend(this.keyRing, ({ events = [], status }) => {
          });
          response = `Project "${readableProject.name.toUpperCase()}" funding has been approved. You can now submit your milestones!`;
        }
        await this.api.disconnect();
      }
    } else {
      response = this.invalidAddressMessage;
    }
    return response;
  }

  async approveMilestone(message) {
    let response;
    const now = Date.now();
    //   const username = message["from"]["username"];
    const senderId = message["from"]["id"];
    let nonce = crypto.randomBytes(16).toString('base64');
    const address = this.getAddressFromMessage(message);

    if (address) {
      const ws = new WsProvider(this.providerUrl);
      // Instantiate the API
      this.api = await ApiPromise.create({ types: this.types, provider: ws });
      // Retrieve the chain & node information information via rpc calls
      const [chain, nodeName, nodeVersion] = await Promise.all([
        this.api.rpc.system.chain(),
        this.api.rpc.system.name(),
        this.api.rpc.system.version(),
      ]);
      this.initKeyring();
      // Log these stats
      const readableProject = await this.findProjectByAddress(address);
      if (readableProject) {
        console.log(readableProject);
        console.log("***** approving milestone *****");
        const firstMilestone = readableProject.milestones[0];
        const projectId = BigInt(firstMilestone.projectKey);
        if (firstMilestone.isApproved) {
          response = `Project "${readableProject.name.toUpperCase()}" first milestone [${firstMilestone.name.toUpperCase()}] has already been approved. You can now withdraw ${firstMilestone.percentageToUnlock}% of the total required funds`;
        } else if (readableProject.contributions.length < 1) {
          response = `Project "${readableProject.name.toUpperCase()}" has no contributions. Cannot approve milestone voting!`;
        } else {
          const hash = await this.api.tx.sudo.sudo(this.api.tx.imbueProposals.approve(projectId, [0])).signAndSend(this.keyRing, ({ events = [], status }) => {
          });
          response = `Project "${readableProject.name.toUpperCase()}" first milestone [${firstMilestone.name.toUpperCase()}] has been approved. You can now withdraw ${firstMilestone.percentageToUnlock}% of the total required funds`;
        }

        await this.api.disconnect();
      }
    } else {
      response = this.invalidAddressMessage;
    }
    return response;
  }

  async sendToken(address) {

    const ws = new WsProvider(this.providerUrl);
    // Instantiate the API
    this.api = await ApiPromise.create({ types: this.types, provider: ws });
    this.initKeyring();
    // Retrieve the chain & node information information via rpc calls
    const [chain, nodeName, nodeVersion] = await Promise.all([
      this.api.rpc.system.chain(),
      this.api.rpc.system.name(),
      this.api.rpc.system.version(),
    ]);
    // Log these stats
    console.log(
      `You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`
    );

    // const nonce = await this.api.rpc.system.accountNextIndex('5EhrCtDaQRYjVbLi7BafbGpFqcMhjZJdu8eW8gy6VRXh6HDp');
    // console.log('nonce:', nonce)
    let nonce = crypto.randomBytes(16).toString('base64');
    const parsedAmount = this.decimals.mul(new BN(this.amount));
    console.log(`Sending 100 ${this.tokenName} to ${address}`);
    const transfer = this.api.tx.balances.transfer(address, parsedAmount);

    // const hash = await transfer.signAndSend(this.keyRing,  { nonce: -1 });
    const hash = await this.api.tx.balances.transfer(address, parsedAmount)
      .signAndSend(this.keyRing, nonce)
    console.log("Transfer sent with hash", hash.toHex());
    await this.api.disconnect();
  }

  // function that telgram bot calls
  async requestToken(message) {
    let response;
    const now = Date.now();
    //   const username = message["from"]["username"];
    const senderId = message["from"]["id"];
    // Get the senders record
    const senderRecords = this.records[senderId];

    const address = this.getAddressFromMessage(message);
    if (address) {
      response = `Sending 100 ${this.tokenName} to ${address}!`;
      // if exists
      if (senderRecords) {
        // make sure last request was long time ago
        const last = senderRecords.slice(-1)[0];
        // check if now - last > timeLimitHours * 60 * 60 * 1000
        if (now - last > this.timeLimitHours * 1000 * 60 * 60) {
          // yes limit has passed
          await this.sendToken(address);
          // update the records to show this
          this.records[senderId].push(now);
        } else {
          // this means user requested tokens already
          response = this.timeLimitMessage;
        }
      } else {
        // this is users first request
        // yes limit has passed
        await this.sendToken(address);
        // create the record
        this.records[senderId] = [];
        // update the records to show this
        this.records[senderId].push(now);
      }
    } else {
      response = this.invalidAddressMessage;
    }
    return response;
  }

  //TODO WIP for multitoken faucet
  async chooseToken(message) {
    let list = ` Please use the /imbu /kusd /ksm command to receive a new fact`
    return list;
  }
}



// load env vars
require("dotenv").config();

const config = {
  types: ADDITIONAL_TYPES,
  providerUrl: process.env.NODE_WS_URL,
  amount: parseFloat(process.env.AMOUNT),
  tokenName: process.env.TOKEN_NAME,
  addressType: parseInt(process.env.ADDRESS_TYPE),
  timeLimitHours: parseFloat(process.env.TIME_LIMIT_HOURS),
  decimals: parseInt(process.env.DECIMALS),
  mnemonic: process.env.MNEMONIC,
};

const faucet = new GenericFaucetInterface(config);

// Initialize telegram bot
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
// Initialize the faucet


// On user starting convo
bot.start(async (ctx) => {
  await ctx.reply(faucet.getHelpMessage());
}).catch(function (error) {
  if (error.response && error.response.statusCode === 403) {
    console.log('error')
  }
});;

// On user types help
bot.help(async (ctx) => {
  await ctx.reply(faucet.getHelpMessage());
});

bot.command("type", async (ctx) => {
  const resp = await faucet.chooseToken(ctx.message);
  await ctx.reply(resp);
});

bot.command("request", async (ctx) => {
  const resp = await faucet.requestToken(ctx.message);
  await ctx.reply(resp);
});

bot.command("schedule", async (ctx) => {
  const resp = await faucet.scheduleRound(ctx.message);
  await ctx.reply(resp);
});


bot.command("approve", async (ctx) => {
  const resp = await faucet.approve(ctx.message);
  await ctx.reply(resp);
});


// On request token command
bot.command("milestone", async (ctx) => {
  const resp = await faucet.approveMilestone(ctx.message);
  await ctx.reply(resp);
});
// Run the bot
bot.launch();
