#!/bin/sh
# Hook: Nixpacks runs this during install. Ensure pnpm is enabled and
# install workspace dependencies for whichever service is building.
set -e
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
