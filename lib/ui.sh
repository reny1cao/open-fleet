#!/bin/bash
# lib/ui.sh — Colors and output helpers

green='\033[0;32m'  red='\033[0;31m'  yellow='\033[0;33m'
cyan='\033[0;36m'   bold='\033[1m'    dim='\033[2m'    reset='\033[0m'

ok()   { printf "  ${green}✔${reset} %s\n" "$1"; }
warn() { printf "  ${yellow}⚠${reset} %s\n" "$1"; }
fail() { printf "  ${red}✘${reset} %s\n" "$1"; }
info() { printf "  ${cyan}ℹ${reset} %s\n" "$1"; }
step() { printf "\n${bold}%s${reset}\n" "$1"; }
