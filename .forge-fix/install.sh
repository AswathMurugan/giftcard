#!/bin/sh
# Installs everything staged here into the app.
#   1. carve-out cost fix        deal-helpers.ts, AllocationPanel.tsx
#   2. Order Close tick + block  stage-helpers.ts, fulfilment-helpers.ts,
#                                FulfilmentPanel.tsx, OrderWorkspacePage.tsx
#   3. Clients page wiring       PrivateApp.tsx, saved-queries.generated.ts
# Run from anywhere:  sh .forge-fix/install.sh
set -e
here=$(cd "$(dirname "$0")" && pwd)
orders="$here/../src/pages/orders"
for f in deal-helpers.ts AllocationPanel.tsx stage-helpers.ts fulfilment-helpers.ts FulfilmentPanel.tsx OrderWorkspacePage.tsx; do
  cp "$here/$f" "$orders/$f"
  echo "installed src/pages/orders/$f"
done
cp "$here/PrivateApp.tsx" "$here/../src/PrivateApp.tsx"
echo "installed src/PrivateApp.tsx"
cp "$here/saved-queries.generated.ts" "$here/../src/types/saved-queries.generated.ts"
echo "installed src/types/saved-queries.generated.ts"
echo
echo "Originals of the two carve-out files are kept as *.ORIGINAL.* in $here"
echo "Now run:  npx tsc --noEmit -p tsconfig.app.json"
