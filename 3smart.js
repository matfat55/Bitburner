import { getPotentialTargets } from "./find-targets.js";
import { penetrate, canPenetrate, hasRam, getNetworkNodes } from "./utils.js";

/** @param {NS} ns */
export async function main(ns) {
  //logs
  ns.disableLog('ALL');

  ns.enableLog('purchaseServer');
  ns.enableLog('deleteServer');
  ns.enableLog('nuke');
  ns.enableLog('killall');

  // Config shi
  const CONFIG = {
    virus: "gimme-money.js", //yes i stole that guy on youtubes name
    checkInterval: 60000,
    thresholdMultiplier: 1.1,
    serverPrefix: "farm-",
    minServerRam: 128,
    reserveMoney: 1e6,
    serverCheckInterval: 60000,
    ramUpgradeMultiplier: 4
  };

  //  script RAM usage
  const virusRam = ns.getScriptRam(CONFIG.virus);

  const cracks = {
    "BruteSSH.exe": ns.brutessh,
    "FTPCrack.exe": ns.ftpcrack,
    "relaySMTP.exe": ns.relaysmtp,
    "HTTPWorm.exe": ns.httpworm,
    "SQLInject.exe": ns.sqlinject
  };

  //  server limits
  const maxServers = ns.getPurchasedServerLimit();
  const maxRam = ns.getPurchasedServerMaxRam();

  /**
    * Deploys virus to a server
    * @param {string} server - Target server
    * @param {string} target - Server to hack
    * @returns {Promise<boolean>} - Success status
    */
  async function deployVirus(server, target) {
    try {
      if (!server || !target) {
        ns.print(`WARNING: Invalid server (${server}) or target (${target})`);
        return false;
      }
      await ns.scp(CONFIG.virus, server);

      if (!ns.hasRootAccess(server)) {
        const requiredPorts = ns.getServerNumPortsRequired(server);
        if (requiredPorts > 0) {
          penetrate(ns, server, cracks);
        }
        ns.nuke(server);
      }

      /**if (ns.scriptRunning(CONFIG.virus, server)) {
        ns.scriptKill(CONFIG.virus, server);
      }**/
      ns.killall(server);

      const maxThreads = Math.floor(ns.getServerMaxRam(server) / virusRam);
      if (maxThreads > 0) {
        ns.exec(CONFIG.virus, server, maxThreads, target);
        return true;
      }
      return false;
    } catch (error) {
      // error handle
      ns.tprint(`ERROR deploying to ${server}: ${error.message}`);
      return false;
    }
  }


  /**
   * Gets list of hackable servers
   * @returns {string[]} - List of hackable servers
   */
  function getHackableServers() {
    const targets = new Set();

    // Add network servers
    for (const node of getNetworkNodes(ns)) {
      if (node !== 'home' &&
        node &&  // null check
        canPenetrate(ns, node, cracks) &&
        hasRam(ns, node, virusRam, true)) {
        targets.add(node);
      }
    }

    // Add purchased servers
    for (const server of ns.getPurchasedServers()) {
      if (server && hasRam(ns, server, virusRam, true)) { //null check
        targets.add(server);
      }
    }

    return Array.from(targets);
  }

  /**
   * Gets servers without virus running
   * @param {string[]} servers - List of servers
   * @returns {string[]} - Servers without virus
   */
  const getServersWithoutVirus = servers =>
    servers.filter(server => server && !ns.scriptRunning(CONFIG.virus, server));

  /**
   * Deploys hacks to servers
   * @param {string[]} servers - Target servers
   * @param {string} target - Server to hack
   * @param {boolean} forceAll - Force deployment to all servers
   */
  async function deployHacks(servers, target, forceAll = false) {
    if (!target) {
      ns.print("WARNING: No target specified for deployment");
      return;
    }
    const serversNeedingDeployment = forceAll ? servers : getServersWithoutVirus(servers);

    if (serversNeedingDeployment.length === 0) return; //if none need deployment

    ns.tprint(`Deploying virus to ${serversNeedingDeployment.length} servers, targeting ${target}`);

    const results = await Promise.all(
      serversNeedingDeployment.map(server => deployVirus(server, target))
    );

    const successCount = results.filter(Boolean).length;
    const failCount = results.length - successCount;

    ns.tprint(
      `Deployment complete:\n` +
      `- Successfully deployed to ${successCount} servers\n` +
      (failCount > 0 ? `- Failed to deploy to ${failCount} servers` : '')
    );
  }

  /**
   * Checks if new target is  better by set amount (config threshhold multi)
   * @param {string} newTarget - Potential new target
   * @param {string} currentTarget - Current target
   * @param {Array} potentialTargets - List of potential targets
   * @returns {boolean} - True if new target is better
   */
  function isSignificantlyBetter(newTarget, currentTarget, potentialTargets) {
    if (!currentTarget) return true;
    if (!newTarget) return false;
    const newTargetInfo = potentialTargets.find(t => t.node === newTarget);
    const currentTargetInfo = potentialTargets.find(t => t.node === currentTarget);

    if (!newTargetInfo || !currentTargetInfo) {
      ns.print(`WARNING: Could not find target info for comparison`);
      return false;
    }
  const improvement = newTargetInfo.revYield / (currentTargetInfo.revYield || 1);
  
    ns.tprint(
      `Potential improvement: ${(improvement * 100 - 100).toFixed(2)}% ` +
      `(Current: $${ns.formatNumber(currentTargetInfo.revYield)}, ` +
      `New: $${ns.formatNumber(newTargetInfo.revYield)})`
    );

    return improvement >= CONFIG.thresholdMultiplier;
  }

  /**
   * Gets next available server name
   * @returns {string|null} - Next server name or null if none available
   */
  function getNextServerName() {
    const currentServers = new Set(ns.getPurchasedServers());

    for (let i = 0; i < maxServers; i++) {
      const name = `${CONFIG.serverPrefix}${i}`;
      if (!currentServers.has(name)) return name;
    }

    return null;
  }

  /**
   * Manages server purchases and upgrades
   * @param {string} currentTarget - Current target server
   */
  async function manageServers(currentTarget) {
    try {
      const money = ns.getServerMoneyAvailable("home");
      const currentServers = ns.getPurchasedServers();

      // Buy new servers
      while (currentServers.length < maxServers) {
        const serverCost = ns.getPurchasedServerCost(CONFIG.minServerRam);
        if (money - serverCost < CONFIG.reserveMoney) break;

        const serverName = getNextServerName();
        if (!serverName) break;

        if (ns.purchaseServer(serverName, CONFIG.minServerRam)) {
          // server acquisition message
          ns.tprint(`SUCCESS: Purchased new server ${serverName} with ${CONFIG.minServerRam}GB RAM`);
          currentServers.push(serverName);
          if (currentTarget) {
            await ns.sleep(1000);
            await deployVirus(serverName, currentTarget);
          }
        }
      }

      // Upgrade existing servers
      for (const server of currentServers) {
        const currentRam = ns.getServerMaxRam(server);
        if (currentRam >= maxRam) continue;

        const targetRam = Math.min(maxRam, currentRam * CONFIG.ramUpgradeMultiplier);
        const upgradeCost = ns.getPurchasedServerCost(targetRam);

        if (money - upgradeCost > CONFIG.reserveMoney) {
          if (await upgradeServer(server, targetRam, currentTarget)) {
            //  upgrade message
            ns.tprint(`SUCCESS: Upgraded server ${server} from ${currentRam}GB to ${targetRam}GB RAM`);
          }
        }
      }
    } catch (error) {
      // Log server management errors as they're critical
      ns.tprint(`CRITICAL ERROR in manageServers: ${error.message}`);
    }
  }
  /**
   * Upgrades a server
   * @param {string} server - Server to upgrade
   * @param {number} targetRam - Target RAM
   * @param {string} currentTarget - Current target server
   * @returns {Promise<boolean>} - Success status
   */
  async function upgradeServer(server, targetRam, currentTarget) {
    const currentRam = ns.getServerMaxRam(server);

    ns.killall(server);
    await ns.sleep(1000);

    if (!ns.deleteServer(server)) return false;

    if (!ns.purchaseServer(server, targetRam)) {
      // Recovery attempt
      if (ns.purchaseServer(server, currentRam)) {
        await ns.sleep(1000);
        if (currentTarget) await deployVirus(server, currentTarget);
      }
      return false;
    }

    await ns.sleep(1000);
    if (currentTarget) await deployVirus(server, currentTarget);
    return true;
  }

  // Main loop
  let currentTarget = "";
  let lastServerCheck = 0;
  let lastMoney = 0;
  let lastSecurity = 0;
  while (true) {
    try {
      const currentTime = Date.now();

      // Server management
      if (currentTime - lastServerCheck >= CONFIG.serverCheckInterval) {
        await manageServers(currentTarget);
        lastServerCheck = currentTime;
      }

      // Target management
      const potentialTargets = getPotentialTargets(ns, "revYield");
      if (potentialTargets.length === 0) {
        ns.print(`WARNING: No viable targets found. Waiting...`);
        await ns.sleep(CONFIG.checkInterval);
        continue;
      }

      const bestTarget = potentialTargets[0].node;
      const hackableServers = getHackableServers();

      if (bestTarget !== currentTarget &&
        isSignificantlyBetter(bestTarget, currentTarget, potentialTargets)) {

        var crevYield = 0;
        if (currentTarget) {  // Only calculate if currentTarget exists
          var cmaxMoney = ns.getServerMaxMoney(currentTarget);
          var cplayer = ns.getPlayer();
          var chackChance = ns.formulas.hacking.hackChance(currentTarget, cplayer);
          crevYield = cmaxMoney * chackChance;
        }

        ns.tprint(
          `TARGET CHANGE: Switching to ${bestTarget}\n` +
          `Max Money: $${ns.formatNumber(potentialTargets[0].maxMoney)}\n` +
          `New Rev Yield: ${potentialTargets[0].revYield.toFixed(2)}\n` +
          `Old Rev Yield: ${crevYield.toFixed(2)}\n`
        );

        ns.run("abt.js", 1, bestTarget);  // abt.js shows info about a server
        currentTarget = bestTarget;
        lastMoney = ns.getServerMoneyAvailable(currentTarget);
        lastSecurity = ns.getServerSecurityLevel(currentTarget);
        await deployHacks(hackableServers, bestTarget, true);
      }

      // Check for stat changes
      const currentMoney = ns.getServerMoneyAvailable(currentTarget);
      const currentSecurity = ns.getServerSecurityLevel(currentTarget);
      const minimumSecurity = ns.getServerMinSecurityLevel(currentTarget);
      const maximumMoney = ns.getServerMaxMoney(currentTarget);

      if (currentMoney !== lastMoney || currentSecurity !== lastSecurity) {
        // Money change message
        let moneyMessage = "";
        if (currentMoney > lastMoney) {
          moneyMessage = `Grew to $${ns.formatNumber(currentMoney)}, was previously $${ns.formatNumber(lastMoney)}, maximum is $${ns.formatNumber(maximumMoney)}`;
        } else if (currentMoney < lastMoney) {
          moneyMessage = `Reduced to $${ns.formatNumber(currentMoney)}, was previously $${ns.formatNumber(lastMoney)}, maximum is $${ns.formatNumber(maximumMoney)}`;
        }

        // Security change message
        let securityMessage = "";
        if (currentSecurity > lastSecurity) {
          securityMessage = `Security increased to ${currentSecurity.toFixed(2)}, was previously ${lastSecurity.toFixed(2)}, minimum is ${minimumSecurity.toFixed(2)}`;
        } else if (currentSecurity < lastSecurity) {
          securityMessage = `Weakened to ${currentSecurity.toFixed(2)}, was previously ${lastSecurity.toFixed(2)}, minimum is ${minimumSecurity.toFixed(2)}`;
        }

        // Print the update message if there were changes
        ns.tprint(`UPDATE: ${currentTarget} - ${moneyMessage}; ${securityMessage}`);

        // Update last known values
        lastMoney = currentMoney;
        lastSecurity = currentSecurity;
      }

      await ns.sleep(CONFIG.checkInterval);
    } catch (error) {
      ns.tprint(`CRITICAL ERROR in main loop: ${error.message}`);
      await ns.sleep(CONFIG.checkInterval);
    }
  }
}
