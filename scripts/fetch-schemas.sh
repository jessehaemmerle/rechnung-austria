#!/usr/bin/env bash
# Lädt die offiziellen XSD-Schemas für ebInterface 6.1, UBL 2.1 und CII D16B nach .schemas/
# (wird von tests/schema.test.ts verwendet; benötigt curl, unzip und xmllint).
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/.schemas"
mkdir -p "$dir" && cd "$dir"
fetch() { for i in 1 2 3 4; do curl -sSfLo "$2" "$1" && return 0; sleep $((i * 5)); done; return 1; }
fetch https://repo1.maven.org/maven2/com/helger/ph-ebinterface/7.1.0/ph-ebinterface-7.1.0.jar eb.jar
fetch https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip ubl.zip
fetch https://repo1.maven.org/maven2/com/helger/cii/ph-cii-d16b/10.1.0/ph-cii-d16b-10.1.0.jar cii.jar
rm -rf eb ubl cii && mkdir eb ubl cii
unzip -qo eb.jar -d eb && unzip -qo ubl.zip -d ubl && unzip -qo cii.jar -d cii
rm -f eb.jar ubl.zip cii.jar
echo "Schemas in $dir"
