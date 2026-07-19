#!/bin/sh
# Installs the RegTab RTL extension from a VSIX located next to this script.
# Download the VSIX for your platform from
# https://github.com/regtab/vscode-rtl/releases and put it beside install.sh.

set -e
dir="$(cd "$(dirname "$0")" && pwd)"

case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)               target=linux-x64 ;;
    Linux-aarch64|Linux-arm64)  target=linux-arm64 ;;
    Darwin-x86_64)              target=darwin-x64 ;;
    Darwin-arm64)               target=darwin-arm64 ;;
    *)                          target=universal ;;
esac

# Alpine (musl) ships its own build.
if [ "$target" = "linux-x64" ] && [ -f /etc/alpine-release ]; then
    target=alpine-x64
fi

vsix=$(ls "$dir"/regtab-rtl-*-"$target".vsix 2>/dev/null | sort | tail -n1 || true)
if [ -z "$vsix" ]; then
    vsix=$(ls "$dir"/regtab-rtl-*-universal.vsix 2>/dev/null | sort | tail -n1 || true)
fi

if [ -z "$vsix" ]; then
    echo "No regtab-rtl VSIX for '$target' found next to this script." >&2
    echo "Download one from https://github.com/regtab/vscode-rtl/releases" >&2
    exit 1
fi

echo "Installing $vsix ..."
if ! code --install-extension "$vsix"; then
    echo "" >&2
    echo "Installation failed. Make sure VS Code's 'code' command is on PATH" >&2
    echo "(in VS Code: Cmd/Ctrl+Shift+P, \"Shell Command: Install 'code' command\")." >&2
    exit 1
fi

echo "Done. Reload open VS Code windows to activate the extension."
