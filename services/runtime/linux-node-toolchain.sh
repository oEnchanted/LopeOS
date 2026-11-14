#!/usr/bin/env bash
# Sourced by the Linux host installer. WSL may append Windows executables to PATH.
lope_linux_node_toolchain() {
  # A supplied search path lets unprivileged tests model a Linux installation.
  export PATH="${1:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
  local node_command node_bin npm_command bundled_npm
  node_command=$(command -v node) || { echo 'Install native Linux Node 24+ before installing the workspace runtime.' >&2; return 1; }
  LOPE_NODE_EXE=$("$node_command" --eval '
    if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) < 24) {
      console.error("The workspace host requires native Linux Node 24+.");
      process.exit(1);
    }
    process.stdout.write(require("node:fs").realpathSync(process.execPath));
  ') || return 1
  node_bin=${LOPE_NODE_EXE%/*}
  # An installation may expose only a node symlink; npm lives beside its target.
  export PATH="$node_bin:$PATH"
  bundled_npm="$node_bin/../lib/node_modules/npm/bin/npm-cli.js"
  if [[ -f $bundled_npm ]]; then
    LOPE_NPM_CLI=$bundled_npm
  else
    npm_command=$(command -v npm) || { echo 'Install native Linux npm alongside Node before installing the workspace runtime.' >&2; return 1; }
    LOPE_NPM_CLI=$("$LOPE_NODE_EXE" --eval 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$npm_command") || return 1
  fi
  # Invoke the CLI with the verified Node, never an npm wrapper selecting node.exe.
  "$LOPE_NODE_EXE" "$LOPE_NPM_CLI" --version >/dev/null || { echo 'The workspace host requires an npm CLI that runs with native Linux Node.' >&2; return 1; }
}
