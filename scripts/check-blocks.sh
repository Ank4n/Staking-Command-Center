#!/bin/bash

# Script to check for missing blocks in the database

DB_PATH="${1:-./data/staking-kusama.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database not found at $DB_PATH"
    exit 1
fi

echo "==================================="
echo "Block Database Validation Report"
echo "==================================="
echo ""

# Check RC blocks
echo "📊 Relay Chain (RC) Blocks:"
echo "-----------------------------------"
RC_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM blocks_rc;")
RC_MIN=$(sqlite3 "$DB_PATH" "SELECT MIN(block_number) FROM blocks_rc;")
RC_MAX=$(sqlite3 "$DB_PATH" "SELECT MAX(block_number) FROM blocks_rc;")
RC_RANGE=$((RC_MAX - RC_MIN + 1))
RC_MISSING=$((RC_RANGE - RC_COUNT))

echo "Total blocks stored: $RC_COUNT"
echo "Block range: $RC_MIN to $RC_MAX"
echo "Expected blocks: $RC_RANGE"
echo "Missing blocks: $RC_MISSING"

if [ $RC_MISSING -gt 0 ]; then
    echo ""
    echo "⚠️  Missing blocks (first 20):"
    sqlite3 "$DB_PATH" "
    WITH RECURSIVE cnt(x) AS (
      SELECT $RC_MIN
      UNION ALL
      SELECT x+1 FROM cnt WHERE x < $RC_MAX
    )
    SELECT x FROM cnt
    WHERE x NOT IN (SELECT block_number FROM blocks_rc)
    LIMIT 20;
    " | while read block; do
        echo "  - $block"
    done
fi

echo ""
echo "📊 Asset Hub (AH) Blocks:"
echo "-----------------------------------"
AH_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM blocks_ah;")
AH_MIN=$(sqlite3 "$DB_PATH" "SELECT MIN(block_number) FROM blocks_ah;")
AH_MAX=$(sqlite3 "$DB_PATH" "SELECT MAX(block_number) FROM blocks_ah;")
AH_RANGE=$((AH_MAX - AH_MIN + 1))
AH_MISSING=$((AH_RANGE - AH_COUNT))

echo "Total blocks stored: $AH_COUNT"
echo "Block range: $AH_MIN to $AH_MAX"
echo "Expected blocks: $AH_RANGE"
echo "Missing blocks: $AH_MISSING"

if [ $AH_MISSING -gt 0 ]; then
    echo ""
    echo "⚠️  Missing blocks (first 20):"
    sqlite3 "$DB_PATH" "
    WITH RECURSIVE cnt(x) AS (
      SELECT $AH_MIN
      UNION ALL
      SELECT x+1 FROM cnt WHERE x < $AH_MAX
    )
    SELECT x FROM cnt
    WHERE x NOT IN (SELECT block_number FROM blocks_ah)
    LIMIT 20;
    " | while read block; do
        echo "  - $block"
    done
fi

echo ""
echo "📊 Events Count:"
echo "-----------------------------------"
RC_EVENTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM events_rc;")
AH_EVENTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM events_ah;")
echo "RC Events: $RC_EVENTS"
echo "AH Events: $AH_EVENTS"

echo ""
echo "📊 Indexer State:"
echo "-----------------------------------"
sqlite3 "$DB_PATH" "SELECT key, value FROM indexer_state WHERE key LIKE '%Height%' OR key LIKE '%syncing%' OR key LIKE '%Block%';" | while IFS='|' read -r key value; do
    echo "$key: $value"
done

echo ""
if [ $RC_MISSING -eq 0 ] && [ $AH_MISSING -eq 0 ]; then
    echo "✅ All blocks are present!"
else
    echo "⚠️  There are missing blocks. Run the indexer again to fill gaps."
fi
echo "==================================="
