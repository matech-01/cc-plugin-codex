#!/usr/bin/env node

/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { callCodexAppServer } from "./lib/codex-app-server.mjs";
import { resolveCodexHome } from "./lib/codex-paths.mjs";
import {
  cleanupManagedGlobalIntegrations,
  resolveManagedMarketplacePluginPath,
} from "./lib/managed-global-integration.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = path.resolve(SCRIPT_DIR, "..");
const MARKETPLACE_NAME = "local-plugins";
const MARKETPLACE_DISPLAY_NAME = "Local Plugins";
const PLUGIN_NAME = "cc";
const HOME_DIR = os.homedir();
const CODEX_HOME = resolveCodexHome();
const MARKETPLACE_FILE = path.join(HOME_DIR, ".agents", "plugins", "marketplace.json");
const CODEX_CONFIG_FILE = path.join(CODEX_HOME, "config.toml");
const PLUGIN_CONFIG_HEADER = `[plugins."${PLUGIN_NAME}@${MARKETPLACE_NAME}"]`;

function usage() {
  console.error(
    "Usage: node scripts/local-plugin-install.mjs <install|uninstall> " +
      "[--plugin-root <path>] [--skip-hook-install]"
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!command || !["install", "uninstall"].includes(command)) {
    usage();
  }

  let pluginRoot = DEFAULT_PLUGIN_ROOT;
  let skipHookInstall = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--plugin-root") {
      const next = args.shift();
      if (!next) usage();
      pluginRoot = path.resolve(next);
      continue;
    }
    if (arg === "--skip-hook-install") {
      skipHookInstall = true;
      continue;
    }
    usage();
  }

  return { command, pluginRoot, skipHookInstall };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function normalizeTrailingNewline(text) {
  return `${text.replace(/\s*$/, "")}\n`;
}

function loadMarketplaceFile() {
  const existing = readText(MARKETPLACE_FILE);
  if (!existing) {
    return {
      name: MARKETPLACE_NAME,
      interface: {
        displayName: MARKETPLACE_DISPLAY_NAME,
      },
      plugins: [],
    };
  }

  const parsed = JSON.parse(existing);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid marketplace file at ${MARKETPLACE_FILE}`);
  }

  if (!Array.isArray(parsed.plugins)) {
    parsed.plugins = [];
  }
  if (!parsed.name) {
    parsed.name = MARKETPLACE_NAME;
  }
  if (!parsed.interface || typeof parsed.interface !== "object") {
    parsed.interface = {};
  }
  if (!parsed.interface.displayName) {
    parsed.interface.displayName = MARKETPLACE_DISPLAY_NAME;
  }
  return parsed;
}

function saveMarketplaceFile(data) {
  if (!Array.isArray(data.plugins) || data.plugins.length === 0) {
    if (fs.existsSync(MARKETPLACE_FILE)) {
      fs.rmSync(MARKETPLACE_FILE, { force: true });
    }
    return;
  }
  writeText(MARKETPLACE_FILE, `${JSON.stringify(data, null, 2)}\n`);
}

function upsertMarketplaceEntry(pluginRoot) {
  const pluginPath = resolveManagedMarketplacePluginPath(pluginRoot);
  const marketplace = loadMarketplaceFile();
  const nextEntry = {
    name: PLUGIN_NAME,
    source: {
      source: "local",
      path: pluginPath,
    },
    policy: {
      installation: "INSTALLED_BY_DEFAULT",
      authentication: "ON_USE",
    },
    category: "Coding",
  };

  const existingIndex = marketplace.plugins.findIndex(
    (plugin) => plugin?.name === PLUGIN_NAME
  );
  if (existingIndex >= 0) {
    marketplace.plugins.splice(existingIndex, 1, nextEntry);
  } else {
    marketplace.plugins.push(nextEntry);
  }

  saveMarketplaceFile(marketplace);
}

function removeMarketplaceEntry(pluginRoot) {
  const existing = readText(MARKETPLACE_FILE);
  if (!existing) {
    return;
  }

  const pluginPath = resolveManagedMarketplacePluginPath(pluginRoot);
  const marketplace = loadMarketplaceFile();
  marketplace.plugins = marketplace.plugins.filter((plugin) => {
    if (plugin?.name !== PLUGIN_NAME) {
      return true;
    }
    return plugin?.source?.path !== pluginPath;
  });
  saveMarketplaceFile(marketplace);
}

function removeTomlSections(content, headers) {
  const lines = content.split("\n");
  const kept = [];
  let skip = false;
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (skip && trimmed.startsWith("[")) {
      skip = false;
    }
    if (!skip && headers.has(trimmed)) {
      skip = true;
      changed = true;
      continue;
    }
    if (!skip) {
      kept.push(line);
    }
  }

  return {
    changed,
    content: normalizeTrailingNewline(
      kept.join("\n").replace(/\n{3,}/g, "\n\n")
    ),
  };
}

function ensurePluginEnabled(content) {
  const lines = content.split("\n");
  const next = [];
  let inPluginSection = false;
  let foundPluginSection = false;
  let foundEnabled = false;
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inPluginSection && !foundEnabled) {
        next.push("enabled = true");
        foundEnabled = true;
        changed = true;
      }
      inPluginSection = trimmed === PLUGIN_CONFIG_HEADER;
      foundPluginSection ||= inPluginSection;
      next.push(line);
      continue;
    }

    if (inPluginSection && /^enabled\s*=/.test(trimmed)) {
      foundEnabled = true;
      if (trimmed !== "enabled = true") {
        next.push("enabled = true");
        changed = true;
      } else {
        next.push(line);
      }
      continue;
    }

    next.push(line);
  }

  if (inPluginSection && !foundEnabled) {
    next.push("enabled = true");
    changed = true;
  }

  if (!foundPluginSection) {
    if (next.length > 0 && next[next.length - 1].trim() !== "") {
      next.push("");
    }
    next.push(PLUGIN_CONFIG_HEADER, "enabled = true");
    changed = true;
  }

  return {
    changed,
    content: normalizeTrailingNewline(next.join("\n").replace(/\n{3,}/g, "\n\n")),
  };
}

function ensureCodexHooksEnabled(content) {
  const lines = content.split("\n");
  const next = [];
  let inFeatures = false;
  let foundFeatures = false;
  let foundCodexHooks = false;
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inFeatures && !foundCodexHooks) {
        next.push("codex_hooks = true");
        foundCodexHooks = true;
        changed = true;
      }
      inFeatures = trimmed === "[features]";
      foundFeatures ||= inFeatures;
      next.push(line);
      continue;
    }

    if (inFeatures && /^codex_hooks\s*=/.test(trimmed)) {
      foundCodexHooks = true;
      if (trimmed !== "codex_hooks = true") {
        next.push("codex_hooks = true");
        changed = true;
      } else {
        next.push(line);
      }
      continue;
    }

    next.push(line);
  }

  if (inFeatures && !foundCodexHooks) {
    next.push("codex_hooks = true");
    foundCodexHooks = true;
    changed = true;
  }

  if (!foundFeatures) {
    if (next.length > 0 && next[next.length - 1].trim() !== "") {
      next.push("");
    }
    next.push("[features]", "codex_hooks = true");
    changed = true;
  }

  return {
    changed,
    content: normalizeTrailingNewline(next.join("\n").replace(/\n{3,}/g, "\n\n")),
  };
}

function readConfigFile() {
  return readText(CODEX_CONFIG_FILE) ?? "";
}

function writeConfigFile(content) {
  writeText(CODEX_CONFIG_FILE, normalizeTrailingNewline(content));
}

function removePluginConfigBlock() {
  const existing = readConfigFile();
  const pluginRemoval = removeTomlSections(existing, new Set([PLUGIN_CONFIG_HEADER]));
  if (pluginRemoval.changed) {
    writeConfigFile(pluginRemoval.content);
  }
}

function configureCodexHooks() {
  const existing = readConfigFile();
  const { content } = ensureCodexHooksEnabled(existing);
  writeConfigFile(content);
}

function enablePluginThroughConfigFallback() {
  const existing = readConfigFile();
  const { content } = ensurePluginEnabled(existing);
  writeConfigFile(content);
}

function runInstallHooks(pluginRoot) {
  const result = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "install-hooks.mjs")], {
    cwd: pluginRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function installPluginThroughCodex() {
  await callCodexAppServer({
    cwd: path.dirname(MARKETPLACE_FILE),
    method: "plugin/install",
    params: {
      marketplacePath: MARKETPLACE_FILE,
      pluginName: PLUGIN_NAME,
      forceRemoteSync: false,
    },
  });
}

function isCodexInstallFallbackEligible(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Method not found/i.test(message) ||
    /Failed to start .*codex/i.test(message) ||
    /app-server exited before responding to plugin\/install/i.test(message) ||
    /app-server timed out waiting for plugin\/install/i.test(message)
  );
}

async function uninstallPluginThroughCodex() {
  await callCodexAppServer({
    cwd: CODEX_HOME,
    method: "plugin/uninstall",
    params: {
      pluginId: `${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
      forceRemoteSync: false,
    },
  });
}

export async function install(pluginRoot, skipHookInstall) {
  upsertMarketplaceEntry(pluginRoot);
  configureCodexHooks();
  let usedFallback = false;
  try {
    await installPluginThroughCodex();
  } catch (error) {
    if (!isCodexInstallFallbackEligible(error)) {
      throw error;
    }
    enablePluginThroughConfigFallback();
    usedFallback = true;
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(
      `Warning: Codex plugin/install unavailable; enabled the plugin through config fallback. ${detail}`
    );
  }
  if (!skipHookInstall) {
    runInstallHooks(pluginRoot);
  }
  if (usedFallback) {
    console.log("Installed using fallback local-plugin activation.");
  }
  console.log(`Installed ${PLUGIN_NAME} from ${pluginRoot}`);
}

export async function uninstall(pluginRoot) {
  cleanupManagedGlobalIntegrations(pluginRoot);
  removeMarketplaceEntry(pluginRoot);
  try {
    await uninstallPluginThroughCodex();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(
      `Warning: Codex plugin uninstall failed; continuing managed cleanup. ${detail}`
    );
  }
  removePluginConfigBlock();
  console.log(`Uninstalled ${PLUGIN_NAME} from ${pluginRoot}`);
}

async function main() {
  const { command, pluginRoot, skipHookInstall } = parseArgs(process.argv.slice(2));

  if (command === "install") {
    await install(pluginRoot, skipHookInstall);
  } else {
    await uninstall(pluginRoot);
  }
}

await main();
