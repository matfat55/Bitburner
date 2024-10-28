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

  const cracks = {
    "BruteSSH.exe": ns.brutessh,
    "FTPCrack.exe": ns.ftpcrack,
    "relaySMTP.exe": ns.relaysmtp,
    "HTTPWorm.exe": ns.httpworm,
    "SQLInject.exe": ns.sqlinject
  };

  async function copyAndRunVirus(server, target) {
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
    // If forceAll is true, we'll redeploy to all servers
    // Otherwise, only deploy to servers without the virus
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
        ns.print(`Failed to deploy to ${server} - insufficient RAM`);
      }
    }

    ns.tprint(`Deployment complete:`);
    ns.tprint(`- Successfully deployed to ${successCount} servers`);
    if (failCount > 0) {
      ns.tprint(`- Failed to deploy to ${failCount} servers due to insufficient RAM`);
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

  let currentTarget = "";

  while (true) {
    // First, get the best target
    const potentialTargets = getPotentialTargets(ns, "revYield");
    if (potentialTargets.length === 0) {
      ns.print("No viable targets found. Waiting...");
      await ns.sleep(checkInterval);
      continue;
    }

    const bestTarget = potentialTargets[0].node;
    
    // Get current list of hackable servers
    const hackableServers = getHackableServers();

    // Check if we need to switch targets
    if (bestTarget !== currentTarget &&
      isSignificantlyBetter(bestTarget, currentTarget, potentialTargets)) {

      ns.tprint(`Found significantly better target: ${bestTarget} (previous: ${currentTarget || "none"})`);
      ns.tprint(`Money available: $${ns.formatNumber(potentialTargets[0].maxMoney)}`);
      ns.tprint(`Hack chance: ${(potentialTargets[0].hackChance * 100).toFixed(2)}%`);
      ns.tprint(`Improvement threshold of ${((THRESHOLD_MULTIPLIER - 1) * 100).toFixed(0)}% exceeded`);

      // Deploy to all servers with the new target
      await deployHacks(hackableServers, bestTarget, true);
      currentTarget = bestTarget;
    } else {
      // Just check for and deploy to servers that don't have the virus
      await deployHacks(hackableServers, bestTarget, false);
      
      if (bestTarget !== currentTarget) {
        ns.print(`Better target found (${bestTarget}), but improvement not significant enough to switch`);
      } else {
        ns.print(`Current target ${currentTarget} is still optimal`);
        ns.run("abt.js", 1, currentTarget);
      }
    }

    await ns.sleep(checkInterval);
  }
}
