#!/bin/bash
# Steady test battery — every suite at one viewport width.
# Usage: bash run_battery.sh <width> <r13-section|all>
# CHROME_PATH env (set by CI) overrides the suites' Chrome binary;
# unset, they fall back to the local puppeteer-cache Chrome.
W=${1:-390}
SEC=${2:-all}
mkdir -p /tmp/testbed
cd "$(dirname "$0")" || exit 1
FAIL=0
for f in r2a r2b r2c regression r3 r4 r5 r6 r7 r8 r9 r10 r11 r12; do
  OUT=$(WIDTH=$W node test-$f.mjs 2>&1)
  RC=$?
  echo "[$W] $f (rc=$RC): $(echo "$OUT" | tail -1)"
  if [ $RC -ne 0 ]; then echo "$OUT" | grep -E "FAIL" | head -5; FAIL=1; fi
done
OUT=$(WIDTH=$W node test-r13.mjs "$SEC" 2>&1)
RC=$?
echo "[$W] r13($SEC) (rc=$RC): $(echo "$OUT" | tail -1)"
if [ $RC -ne 0 ]; then echo "$OUT" | grep -E "FAIL" | head -8; FAIL=1; fi
OUT=$(WIDTH=$W node test-r14.mjs all 2>&1)
RC=$?
echo "[$W] r14 (rc=$RC): $(echo "$OUT" | tail -1)"
if [ $RC -ne 0 ]; then echo "$OUT" | grep -E "FAIL" | head -8; FAIL=1; fi
echo "BATTERY width=$W section=$SEC => $([ $FAIL -eq 0 ] && echo ALL-GREEN || echo FAILURES)"
exit $FAIL
