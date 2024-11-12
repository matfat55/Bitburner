import { getPotentialTargets } from "./find-targets.js";
import { penetrate, canPenetrate, hasRam, getNetworkNodes } from "./utils.js";

/** @param {NS} ns */
export async function main(ns) {
  // Parse command line arguments
  const flags = ns.flags([
    ['targetCount', 1],
    ['help', false]
  ]);

  if (flags.help) {
    ns.tprint(`
    Usage: run script.js [--targetCount n]
    Options:
      --targetCount n    Number of servers to target simultaneously (default: 1)
      --help            Show this help message
    `);
    return;
  }

  // Config 
  const CONFIG = {
    virus: "gimme-money.js",
    checkInterval: 60000,
    thresholdMultiplier: 1.1,
    serverPrefix: "farm-",
    minServerRam: 128,
    reserveMoney: 5e9,
    serverCheckInterval: 60000,
    ramUpgradeMultiplier: 4,
    maxMoneySpendPercent: 0.4,
    statsInterval: 180000,
  };

  class TargetStats {
    constructor(ns, target) {
      this.ns = ns;
      this.target = target;
      this.startTime = Date.now();
      this.moneyGained = 0;
      this.attacksAttempted = 0;
      this.attacksSucceeded = 0;
      this.lastMoney = ns.getServerMoneyAvailable(target);
      this.lastSecurity = ns.getServerSecurityLevel(target);
      this.peakMoney = this.lastMoney;
      this.lowestSecurity = this.lastSecurity;
    }

    update() {
      const currentMoney = this.ns.getServerMoneyAvailable(this.target);
      const currentSecurity = this.ns.getServerSecurityLevel(this.target);
      const moneyDiff = currentMoney - this.lastMoney;

      if (moneyDiff < 0) {
        this.moneyGained += Math.abs(moneyDiff);
        this.attacksSucceeded++;
      }
      this.attacksAttempted++;

      if (currentMoney > this.peakMoney) this.peakMoney = currentMoney;
      if (currentSecurity < this.lowestSecurity) this.lowestSecurity = currentSecurity;

      this.lastMoney = currentMoney;
      this.lastSecurity = currentSecurity;

      return {
        moneyDiff,
        securityDiff: currentSecurity - this.lastSecurity
      };
    }

    getStats() {
      const runTime = (Date.now() - this.startTime) / 1000;
      return {
        target: this.target,
        moneyPerSecond: this.moneyGained / runTime,
        successRate: (this.attacksAttempted > 0 ? (this.attacksSucceeded / this.attacksAttempted) * 100 : 0),
        peakMoney: this.peakMoney,
        lowestSecurity: this.lowestSecurity,
        runTime
      };
    }
  }

  const virusRam = ns.getScriptRam(CONFIG.virus);

  const cracks = {
    "BruteSSH.exe": ns.brutessh,
    "FTPCrack.exe": ns.ftpcrack,
    "relaySMTP.exe": ns.relaysmtp,
    "HTTPWorm.exe": ns.httpworm,
    "SQLInject.exe": ns.sqlinject
  };

  const maxServers = ns.getPurchasedServerLimit();
  const maxRam = ns.getPurchasedServerMaxRam();

  function getMaxServerSpend() {
    return Math.max(0, ns.getServerMoneyAvailable("home") - CONFIG.reserveMoney) * CONFIG.maxMoneySpendPercent;
  }

  async function deployVirus(server, targets) {
    try {
      if (!server || !targets || targets.length === 0) {
        ns.print(`WARNING: Invalid server (${server}) or targets`);
        return false;
      }

      // Debug output
      ns.print(`DEBUG: Deploying virus to ${server} targeting ${targets.join(', ')}`);

      await ns.scp(CONFIG.virus, server);

      if (!ns.hasRootAccess(server)) {
        const requiredPorts = ns.getServerNumPortsRequired(server);
        if (requiredPorts > 0) {
          penetrate(ns, server, cracks);
        }
        ns.nuke(server);
      }

      ns.killall(server);

      const maxThreads = Math.floor(ns.getServerMaxRam(server) / virusRam);
      if (maxThreads > 0) {
        const threadsPerTarget = Math.floor(maxThreads / targets.length);
        if (threadsPerTarget > 0) {
          targets.forEach(target => {
            const pid = ns.exec(CONFIG.virus, server, threadsPerTarget, target);
            ns.print(`DEBUG: Launched virus on ${server} targeting ${target} with ${threadsPerTarget} threads. PID: ${pid}`);
          });
          return true;
        }
      }
      return false;
    } catch (error) {
      ns.tprint(`ERROR deploying to ${server}: ${error.toString()}`);
      return false;
    }
  }

  function getHackableServers() {
    const targets = new Set();
    for (const node of getNetworkNodes(ns)) {
      if (node !== 'home' &&
        node &&
        canPenetrate(ns, node, cracks) &&
        hasRam(ns, node, virusRam, true)) {
        targets.add(node);
      }
    }
    for (const server of ns.getPurchasedServers()) {
      if (server && hasRam(ns, server, virusRam, true)) {
        targets.add(server);
      }
    }
    return Array.from(targets);
  }

  const getServersWithoutVirus = servers =>
    servers.filter(server => server && !ns.scriptRunning(CONFIG.virus, server));

  async function deployHacks(servers, targets, forceAll = false) {
    if (!targets || targets.length === 0) {
      ns.print("WARNING: No targets specified for deployment");
      return;
    }

    const serversNeedingDeployment = forceAll ? servers : getServersWithoutVirus(servers);
    if (serversNeedingDeployment.length === 0) return;

    ns.tprint(`Deploying virus to ${serversNeedingDeployment.length} servers, targeting ${targets.join(', ')}`);

    const results = await Promise.all(
      serversNeedingDeployment.map(server => deployVirus(server, targets))
    );

    const successCount = results.filter(Boolean).length;
    const failCount = results.length - successCount;

    ns.tprint(
      `Deployment complete:\n` +
      `- Successfully deployed to ${successCount} servers\n` +
      (failCount > 0 ? `- Failed to deploy to ${failCount} servers` : '')
    );
  }

  function isSignificantlyBetter(newTargets, currentTargets, potentialTargets) {
    if (!currentTargets || currentTargets.length === 0) return true;
    if (!newTargets || newTargets.length === 0) return false;

    const currentYields = currentTargets.map(t => ({
      target: t,
      yield: (potentialTargets.find(pt => pt.node === t) || {}).revYield || 0
    })).sort((a, b) => b.yield - a.yield);  // Changed to sort descending

    const newYields = newTargets.map(t => ({
      target: t,
      yield: (potentialTargets.find(pt => pt.node === t) || {}).revYield || 0
    })).sort((a, b) => b.yield - a.yield);  // Changed to sort descending

    let replacements = [];
    for (let i = 0; i < Math.min(currentYields.length, newYields.length); i++) {
      const improvement = newYields[i].yield / (currentYields[i].yield || 1);
      if (improvement >= CONFIG.thresholdMultiplier) {
        replacements.push({
          old: currentYields[i].target,
          new: newYields[i].target,
          improvement: improvement
        });
      }
    }

    if (replacements.length > 0) {
      ns.tprint("POTENTIAL REPLACEMENTS:");
      replacements.forEach(r => {
        ns.tprint(
          `  ${r.old} → ${r.new}\n` +
          `  Improvement: ${((r.improvement - 1) * 100).toFixed(2)}%\n` +
          `  Details:\n` +
          `    - Old target yield: $${ns.formatNumber((potentialTargets.find(pt => pt.node === r.old) || {}).revYield || 0)}/sec\n` +
          `    - New target yield: $${ns.formatNumber((potentialTargets.find(pt => pt.node === r.new) || {}).revYield || 0)}/sec\n`
        );
      });
    }

    return replacements;
  }

  async function manageServers(currentTargets) {
    try {
      const maxSpend = getMaxServerSpend();
      const currentServers = ns.getPurchasedServers();
      let totalPlannedCost = 0;
      const plannedOperations = [];

      // Debug output
      ns.print(`DEBUG: Managing servers. Max spend: $${ns.formatNumber(maxSpend)}`);

      while (currentServers.length < maxServers) {
        const serverCost = ns.getPurchasedServerCost(CONFIG.minServerRam);
        if (serverCost + totalPlannedCost > maxSpend) break;

        const serverName = getNextServerName();
        if (!serverName) break;

        totalPlannedCost += serverCost;
        plannedOperations.push({
          type: 'purchase',
          name: serverName,
          ram: CONFIG.minServerRam,
          cost: serverCost
        });
      }

      for (const server of currentServers) {
        const currentRam = ns.getServerMaxRam(server);
        if (currentRam >= maxRam) continue;

        const targetRam = Math.min(maxRam, currentRam * CONFIG.ramUpgradeMultiplier);
        const upgradeCost = ns.getPurchasedServerCost(targetRam);

        if (upgradeCost + totalPlannedCost <= maxSpend) {
          totalPlannedCost += upgradeCost;
          plannedOperations.push({
            type: 'upgrade',
            name: server,
            ram: targetRam,
            cost: upgradeCost
          });
        }
      }

      for (const op of plannedOperations) {
        if (op.type === 'purchase') {
          if (ns.purchaseServer(op.name, op.ram)) {
            ns.tprint(`SUCCESS: Purchased new server ${op.name} with ${op.ram}GB RAM`);
            if (currentTargets && currentTargets.length > 0) {
              await ns.sleep(1000);
              await deployVirus(op.name, currentTargets);
            }
          }
        } else {
          if (await upgradeServer(op.name, op.ram, currentTargets)) {
            ns.tprint(`SUCCESS: Upgraded server ${op.name} to ${op.ram}GB RAM`);
          }
        }
      }
    } catch (error) {
      ns.tprint(`CRITICAL ERROR in manageServers: ${error.toString()}`);
    }
  }

  function getNextServerName() {
    const currentServers = new Set(ns.getPurchasedServers());
    for (let i = 0; i < maxServers; i++) {
      const name = `${CONFIG.serverPrefix}${i}`;
      if (!currentServers.has(name)) return name;
    }
    return null;
  }

  async function upgradeServer(server, targetRam, currentTargets) {
    const currentRam = ns.getServerMaxRam(server);

    ns.killall(server);
    await ns.sleep(1000);

    if (!ns.deleteServer(server)) return false;

    if (!ns.purchaseServer(server, targetRam)) {
      if (ns.purchaseServer(server, currentRam)) {
        await ns.sleep(1000);
        if (currentTargets && currentTargets.length > 0) {
          await deployVirus(server, currentTargets);
        }
      }
      return false;
    }

    await ns.sleep(1000);
    if (currentTargets && currentTargets.length > 0) {
      await deployVirus(server, currentTargets);
    }
    return true;
  }

  // Main loop
  let currentTargets = [];
  let lastServerCheck = 0;
  let lastMoneyMap = new Map();
  let lastSecurityMap = new Map();
  let targetStats = new Map();
  let lastStatsReport = 0;

  // Initialize with first set of targets
  const initialTargets = getPotentialTargets(ns, "revYield");
  if (initialTargets.length > 0) {
    currentTargets = initialTargets.slice(0, flags.targetCount).map(t => t.node);
    ns.tprint(`Initial targets selected: ${currentTargets.join(', ')}`);
    
    // Deploy to initial targets
    const hackableServers = getHackableServers();
    await deployHacks(hackableServers, currentTargets, true);
  }

  while (true) {
    try {
      const currentTime = Date.now();

      if (currentTime - lastServerCheck >= CONFIG.serverCheckInterval) {
        await manageServers(currentTargets);
        lastServerCheck = currentTime;
      }

      const potentialTargets = getPotentialTargets(ns, "revYield");
      if (potentialTargets.length === 0) {
        ns.print(`WARNING: No viable targets found. Waiting...`);
        await ns.sleep(CONFIG.checkInterval);
        continue;
      }

      const bestTargets = potentialTargets
        .slice(0, flags.targetCount)
        .map(t => t.node);

      if (bestTargets.some(t => !currentTargets.includes(t))) {
        const replacements = isSignificantlyBetter(bestTargets, currentTargets, potentialTargets);
        
        if (replacements.length > 0) {
          replacements.forEach(r => {
            const idx = currentTargets.indexOf(r.old);
            if (idx !== -1) {
              currentTargets[idx] = r.new;
              ns.run("abt.js", 1, r.new);

              // Reset statistics for new target
              targetStats.set(r.new, new TargetStats(ns, r.new));

              // Log final stats for old target
              if (targetStats.has(r.old)) {
                const stats = targetStats.get(r.old).getStats();
                ns.tprint(
                  `FINAL STATS FOR ${r.old}:\n` +
                  `  - Total money gained: $${ns.formatNumber(stats.moneyPerSecond * stats.runTime)}\n` +
                  `  - Average $/sec: $${ns.formatNumber(stats.moneyPerSecond)}\n` +
                  `  - Success rate: ${stats.successRate.toFixed(2)}%\n` +
                  `  - Peak money: $${ns.formatNumber(stats.peakMoney)}\n` +
                  `  - Best security: ${stats.lowestSecurity.toFixed(2)}\n` +
                  `  - Total runtime: ${(stats.runTime / 60).toFixed(2)} minutes`
                );
                targetStats.delete(r.old);
              }
            }
          });

          // Deploy to all servers with new target list
          const hackableServers = getHackableServers();
          await deployHacks(hackableServers, currentTargets, true);
        }
      }

      // Check for stat changes
      for (const target of currentTargets) {
        const currentMoney = ns.getServerMoneyAvailable(target);
        const currentSecurity = ns.getServerSecurityLevel(target);
        const minimumSecurity = ns.getServerMinSecurityLevel(target);
        const maximumMoney = ns.getServerMaxMoney(target);

        if (currentMoney !== lastMoneyMap.get(target) ||
          currentSecurity !== lastSecurityMap.get(target)) {

          let moneyMessage = "";
          if (currentMoney > lastMoneyMap.get(target)) {
            moneyMessage = `Grew to $${ns.formatNumber(currentMoney)}, was previously $${ns.formatNumber(lastMoneyMap.get(target))}, maximum is $${ns.formatNumber(maximumMoney)}`;
          } else if (currentMoney < lastMoneyMap.get(target)) {
            moneyMessage = `Reduced to $${ns.formatNumber(currentMoney)}, was previously $${ns.formatNumber(lastMoneyMap.get(target))}, maximum is $${ns.formatNumber(maximumMoney)}`;
          }

          let securityMessage = "";
          if (currentSecurity > lastSecurityMap.get(target)) {
            securityMessage = `Security increased to ${currentSecurity.toFixed(2)}, was previously ${lastSecurityMap.get(target).toFixed(2)}, minimum is ${minimumSecurity.toFixed(2)}`;
          } else if (currentSecurity < lastSecurityMap.get(target)) {
            securityMessage = `Weakened to ${currentSecurity.toFixed(2)}, was previously ${lastSecurityMap.get(target).toFixed(2)}, minimum is ${minimumSecurity.toFixed(2)}`;
          }

          ns.tprint(`UPDATE: ${target} - ${moneyMessage}; ${securityMessage}`);

          lastMoneyMap.set(target, currentMoney);
          lastSecurityMap.set(target, currentSecurity);
        }
      }
        // 6. Add the periodic stats reporting right before the sleep at the end of the main loop
        if (currentTime - lastStatsReport >= CONFIG.statsInterval) {
            ns.tprint("\nCURRENT PERFORMANCE REPORT:");
            for (const [target, stats] of targetStats) {
                const currentStats = stats.getStats();
                ns.tprint(
                    `${target}:\n` +
                    `  - Money/sec: $${ns.formatNumber(currentStats.moneyPerSecond)}\n` +
                    `  - Success rate: ${currentStats.successRate.toFixed(2)}%\n` +
                    `  - Runtime: ${(currentStats.runTime / 60).toFixed(2)} minutes`
                );
            }
            lastStatsReport = currentTime;
        }

        // 7. Update stats for all current targets
        for (const target of currentTargets) {
            if (!targetStats.has(target)) {
                targetStats.set(target, new TargetStats(ns, target));
            }
            const stats = targetStats.get(target);
            stats.update();
        }

        await ns.sleep(CONFIG.checkInterval);
    } catch (error) {
        ns.tprint(`CRITICAL ERROR in main loop: ${error.name}`);
        await ns.sleep(CONFIG.checkInterval);
    }
}
}
