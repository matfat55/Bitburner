import { getPotentialTargets } from "./find-targets.js";
import { penetrate, canPenetrate, hasRam, getNetworkNodes } from "./utils.js";

/** @param {NS} ns */
export async function main(ns) {
  // Configuration
  const homeServer = "home";
  const virus = "gimme-money.js";
  const virusRam = ns.getScriptRam(virus);
  const checkInterval = 60000; // Check for better target every x milliseconds
  const THRESHOLD_MULTIPLIER = 1.1; // New target must be x times better than current

  // Server purchasing configuration
  const SERVER_PREFIX = "farm-";
  const MIN_SERVER_RAM = 8; // Starting RAM size
  const RESERVE_MONEY = 1e6; // Keep this much money in reserve
  const SERVER_CHECK_INTERVAL = 30000; // Check for server upgrades every 30 seconds
  const RAM_UPGRADE_MULTIPLIER = 4; // Upgrade RAM by this factor

  const cracks = {
    "BruteSSH.exe": ns.brutessh,
    "FTPCrack.exe": ns.ftpcrack,
    "relaySMTP.exe": ns.relaysmtp,
    "HTTPWorm.exe": ns.httpworm,
    "SQLInject.exe": ns.sqlinject
  };

  async function copyAndRunVirus(server, target) {
    try {
      ns.print(`Copying virus to server: ${server} targeting ${target}`);
      await ns.scp(virus, server);

      if (!ns.hasRootAccess(server)) {
        const requiredPorts = ns.getServerNumPortsRequired(server);
        if (requiredPorts > 0) {
          penetrate(ns, server, cracks);
        }
        ns.print(`Gaining root access on ${server}`);
        ns.nuke(server);
      }

      if (ns.scriptRunning(virus, server)) {
        ns.scriptKill(virus, server);
      }

      const maxThreads = Math.floor(ns.getServerMaxRam(server) / virusRam);
      if (maxThreads > 0) {
        ns.exec(virus, server, maxThreads, target);
        return true;
      }
      return false;
    } catch (error) {
      ns.print(`ERROR deploying to ${server}: ${error.message}`);
      return false;
    }
  }

  function getHackableServers() {
    const targets = [];

    // Add all network servers using deep scan
    const networkNodes = getNetworkNodes(ns);
    for (const node of networkNodes) {
      if (node !== 'home' && // Skip home server
        canPenetrate(ns, node, cracks) &&
        hasRam(ns, node, virusRam, true)) {
        targets.push(node);
      }
    }

    // Add purchased servers
    const purchasedServers = ns.getPurchasedServers();
    for (const server of purchasedServers) {
      if (hasRam(ns, server, virusRam, true)) {
        targets.push(server);
      }
    }

    return targets;
  }

  function getServersWithoutVirus(servers) {
    return servers.filter(server => !ns.scriptRunning(virus, server));
  }

  async function deployHacks(servers, target, forceAll = false) {
    const serversNeedingDeployment = forceAll ? servers : getServersWithoutVirus(servers);

    if (serversNeedingDeployment.length === 0) {
      ns.print("No servers need deployment at this time");
      return;
    }

    ns.tprint(`Deploying virus to ${serversNeedingDeployment.length} servers, targeting ${target}`);
    let successCount = 0;
    let failCount = 0;

    for (const server of serversNeedingDeployment) {
      const success = await copyAndRunVirus(server, target);
      if (success) {
        successCount++;
      } else {
        failCount++;
        ns.print(`Failed to deploy to ${server} - insufficient RAM or server unavailable`);
      }
    }

    ns.tprint(`Deployment complete:`);
    ns.tprint(`- Successfully deployed to ${successCount} servers`);
    if (failCount > 0) {
      ns.tprint(`- Failed to deploy to ${failCount} servers`);
    }
  }

  function isSignificantlyBetter(newTarget, currentTarget, potentialTargets) {
    if (!currentTarget) return true;

    const newTargetInfo = potentialTargets.find(t => t.node === newTarget);
    const currentTargetInfo = potentialTargets.find(t => t.node === currentTarget);

    if (!currentTargetInfo) return true;

    const newYield = newTargetInfo.revYield;
    const currentYield = currentTargetInfo.revYield;
    const improvement = newYield / currentYield;

    ns.print(`Potential improvement: ${(improvement * 100 - 100).toFixed(2)}% ` +
      `(Current: $${ns.formatNumber(currentYield)}, ` +
      `New: $${ns.formatNumber(newYield)})`);

    return improvement >= THRESHOLD_MULTIPLIER;
  }

  function getNextServerName() {
    const maxServers = ns.getPurchasedServerLimit();
    const currentServers = ns.getPurchasedServers();

    // Create a set of existing server numbers
    const usedNumbers = new Set();
    for (const server of currentServers) {
      const match = server.match(new RegExp(`^${SERVER_PREFIX}(\\d+)$`));
      if (match) {
        usedNumbers.add(parseInt(match[1]));
      }
    }

    // Find the first unused number
    for (let i = 0; i < maxServers; i++) {
      if (!usedNumbers.has(i)) {
        return `${SERVER_PREFIX}${i}`;
      }
    }

    return null; // No available slots
  }

  async function manageServers(currentTarget) {
    try {
      const maxRam = ns.getPurchasedServerMaxRam();
      const maxServers = ns.getPurchasedServerLimit();
      const currentServers = ns.getPurchasedServers();
      const money = ns.getServerMoneyAvailable("home");

      // First, try to buy new servers
      while (currentServers.length < maxServers) {
        const serverCost = ns.getPurchasedServerCost(MIN_SERVER_RAM);
        if (money - serverCost < RESERVE_MONEY) break;

        const serverName = getNextServerName();
        if (!serverName) break;

        try {
          if (ns.purchaseServer(serverName, MIN_SERVER_RAM)) {
            ns.tprint(`Purchased new server: ${serverName} with ${MIN_SERVER_RAM}GB RAM`);
            currentServers.push(serverName);
            if (currentTarget) {
              await ns.sleep(1000);
              await copyAndRunVirus(serverName, currentTarget);
            }
          }
        } catch (error) {
          ns.print(`ERROR purchasing server ${serverName}: ${error.message}`);
        }
      }

      // Then, try to upgrade existing servers
      for (const server of currentServers) {
        try {
          const currentRam = ns.getServerMaxRam(server);
          if (currentRam >= maxRam) continue;

          const targetRam = Math.min(maxRam, currentRam * RAM_UPGRADE_MULTIPLIER);
          const upgradeCost = ns.getPurchasedServerCost(targetRam);

          if (money - upgradeCost > RESERVE_MONEY) {
            // Create temporary name for new server
            const tempServerName = `${server}-upgrade`;

            // First purchase the new server
            if (!ns.purchaseServer(tempServerName, targetRam)) {
              ns.print(`Failed to purchase upgrade server ${tempServerName}`);
              continue;
            }

            // Kill scripts on old server
            ns.killall(server);
            await ns.sleep(1000);

            // Delete the old server
            if (!ns.deleteServer(server)) {
              // If we can't delete the old server, delete the new one to avoid waste
              ns.deleteServer(tempServerName);
              ns.print(`Failed to delete server ${server}`);
              continue;
            }

            // Rename new server to old name
            try {
              await ns.sleep(1000);
              // In some versions of Bitburner we need to rename, in others we don't
              // So we'll try the upgrade without rename first
              if (ns.serverExists(tempServerName)) {
                if (!ns.deleteServer(tempServerName)) {
                  ns.print(`Warning: Could not clean up temporary server ${tempServerName}`);
                  continue;
                }
              }

              // Purchase with final name
              if (ns.purchaseServer(server, targetRam)) {
                ns.tprint(`Upgraded server ${server} from ${currentRam}GB to ${targetRam}GB RAM`);
                await ns.sleep(1000);
                if (currentTarget) {
                  await copyAndRunVirus(server, currentTarget);
                }
              } else {
                ns.print(`Failed to finalize upgrade for ${server}`);
                // Try to recover by purchasing original size
                if (ns.purchaseServer(server, currentRam)) {
                  ns.print(`Recovered ${server} with original RAM`);
                  await ns.sleep(1000);
                  if (currentTarget) {
                    await copyAndRunVirus(server, currentTarget);
                  }
                }
              }
            } catch (error) {
              ns.print(`Error during server rename/finalization: ${error.message}`);
              // Try to recover by purchasing original size
              if (ns.purchaseServer(server, currentRam)) {
                ns.print(`Recovered ${server} with original RAM`);
                await ns.sleep(1000);
                if (currentTarget) {
                  await copyAndRunVirus(server, currentTarget);
                }
              }
            }
          }
        } catch (error) {
          ns.print(`ERROR upgrading server ${server}: ${error.message}`);
        }
      }
    } catch (error) {
      ns.print(`ERROR in manageServers: ${error.message}`);
    }
  }
  let currentTarget = "";
  let lastServerCheck = 0;

  while (true) {
    try {
      const currentTime = Date.now();

      // Check for server purchases/upgrades periodically
      if (currentTime - lastServerCheck >= SERVER_CHECK_INTERVAL) {
        await manageServers(currentTarget);
        lastServerCheck = currentTime;
      }

      // Get the best target
      const potentialTargets = getPotentialTargets(ns, "revYield");
      if (potentialTargets.length === 0) {
        ns.print("No viable targets found. Waiting...");
        await ns.sleep(checkInterval);
        continue;
      }

      const bestTarget = potentialTargets[0].node;
      const hackableServers = getHackableServers();

      // Check if we need to switch targets
      if (bestTarget !== currentTarget &&
        isSignificantlyBetter(bestTarget, currentTarget, potentialTargets)) {

        ns.tprint(`Found significantly better target: ${bestTarget} (previous: ${currentTarget || "none"})`);
        ns.tprint(`Money available: $${ns.formatNumber(potentialTargets[0].maxMoney)}`);
        ns.tprint(`Hack chance: ${(potentialTargets[0].hackChance * 100).toFixed(2)}%`);
        ns.tprint(`Improvement threshold of ${((THRESHOLD_MULTIPLIER - 1) * 100).toFixed(0)}% exceeded`);

        await deployHacks(hackableServers, bestTarget, true);
        currentTarget = bestTarget;
      } else {
        await deployHacks(hackableServers, bestTarget, false);

        if (bestTarget !== currentTarget) {
          ns.print(`Better target found (${bestTarget}), but improvement not significant enough to switch`);
        } else {
          ns.print(`Current target ${currentTarget} is still optimal`);
          ns.run("abt.js", 1, currentTarget);
        }
      }

      await ns.sleep(checkInterval);
    } catch (error) {
      ns.print(`ERROR in main loop: ${error.message}`);
      await ns.sleep(checkInterval);
    }
  }
}
