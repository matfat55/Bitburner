/** @param {NS} ns */
function scan(ns, parent, server, list) {
    const children = ns.scan(server);
    for (let child of children) {
        if (parent == child) {
            continue;
        }
        list.push(child);
        scan(ns, server, child, list);
    }
}

function getServerPath(ns, target, origin = 'home') {
    // Ignore purchased servers
    const ignored = ["farm"];
    
    function hasIgnoredString(text) {
        return ignored.some(str => text.includes(str));
    }

    function getNetworkNodePairs() {
        const visited = {};
        const stack = [origin];
        const nodePairs = [];

        while (stack.length > 0) {
            const node = stack.pop();
            if (!visited[node]) {
                if (node === target) {
                    break;
                }
                visited[node] = node;
                const neighbours = ns.scan(node);
                for (const child of neighbours) {
                    if (hasIgnoredString(child) || visited[child]) {
                        continue;
                    }
                    stack.push(child);
                    nodePairs.push({
                        parent: node,
                        current: child
                    });
                }
            }
        }
        return nodePairs;
    }

    function reconstructPath(nodes) {
        const parentMap = nodes.reduce((acc, node) => {
            acc[node.current] = node.parent;
            return acc;
        }, {});

        const path = [];
        let curNode = target;
        while (curNode !== origin) {
            path.push(curNode);
            const parent = parentMap[curNode];
            if (!parent) {
                break;
            }
            curNode = parent;
        }
        path.push(origin);
        return path.reverse();
    }

    const nodes = getNetworkNodePairs();
    return reconstructPath(nodes);
}

function list_servers(ns) {
    const list = [];
    scan(ns, '', 'home', list);
    return list;
}

function formatConnectCommands(path) {
    return path.slice(1).map(server => `connect ${server}`).join(';');
}

function createContractKey(server, contract) {
    return `${server}-${contract}`;
}

async function monitorContracts(ns) {
    // Keep track of contracts we've already seen
    const knownContracts = new Set();
    
    while (true) {
        let servers = list_servers(ns);
        const boughtServers = ns.getPurchasedServers(ns);
        servers = servers.filter(s => !boughtServers.includes(s));
        
        // Find all contracts
        for (const server of servers) {
            const contracts = ns.ls(server, ".cct");
            for (const contract of contracts) {
                const contractKey = createContractKey(server, contract);
                
                // Only notify about new contracts
                if (!knownContracts.has(contractKey)) {
                    const path = getServerPath(ns, server);
                    const connectCommands = formatConnectCommands(path);
                    
                    // Add visual and sound notification
                    ns.tprint("=".repeat(50));
                    ns.tprint(`NEW CONTRACT FOUND!`);
                    ns.tprint(`Contract: '${contract}' on server '${server}'`);
                    ns.tprint(connectCommands);
                    ns.tprint("=".repeat(50));
                    
                    // Play notification sound (if available in the game)
                    try {
                        ns.toast(`New contract found on ${server}!`, "success", 10000);
                    } catch (error) {
                        // Ignore if toast isn't available
                    }
                    
                    // Add to known contracts
                    knownContracts.add(contractKey);
                }
            }
        }
        
        // Wait for 1 minute before next check
        await ns.sleep(30000);
    }
}

export async function main(ns) {
    const args = ns.flags([["help", false]]);
    if (args.help) {
        ns.tprint("This script monitors for new coding contracts in the background.");
        ns.tprint(`Usage: run ${ns.getScriptName()}`);
        ns.tprint("Example:");
        ns.tprint(`> run ${ns.getScriptName()}`);
        return;
    }

    ns.tprint("Starting contract monitor...");
    ns.tprint("Will notify when new contracts are found.");
    
    // Start the monitoring loop
    await monitorContracts(ns);
}
