#!/bin/bash
# smart-lint.sh - PostToolUse hook that lints edited files by extension
# Errors (E/F rules) block, style warnings are gentle additionalContext

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ] && exit 0

# Ruff: F (pyflakes) = real errors, E/W/I/N/D/UP/etc = style
# clj-kondo: ":error" vs ":warning"
# eslint compact: "Error" vs "Warning"
split_output() {
  local output="$1" lang="$2"
  ERRORS="" WARNINGS=""
  case "$lang" in
    python)
      ERRORS=$(echo "$output" | grep -E ': F[0-9]' || true)
      WARNINGS=$(echo "$output" | grep -E ': [A-Z]+[0-9]' | grep -vE ': F[0-9]' || true)
      ;;
    clojure)
      ERRORS=$(echo "$output" | grep ':error' || true)
      WARNINGS=$(echo "$output" | grep ':warning' || true)
      ;;
    js)
      ERRORS=$(echo "$output" | grep 'Error -' || true)
      WARNINGS=$(echo "$output" | grep 'Warning -' || true)
      ;;
  esac
}

LINT_OUTPUT="" LANG=""
case "$FILE_PATH" in
  *.clj|*.cljc|*.cljs|*.bb|*.edn)
    LANG=clojure
    command -v clj-kondo &>/dev/null && LINT_OUTPUT=$(clj-kondo --lint "$FILE_PATH" 2>&1)
    ;;
  *.py)
    LANG=python
    command -v ruff &>/dev/null && LINT_OUTPUT=$(ruff check --output-format concise "$FILE_PATH" 2>&1)
    ;;
  *.js|*.jsx|*.ts|*.tsx)
    LANG=js
    command -v npx &>/dev/null && LINT_OUTPUT=$(npx eslint --format compact "$FILE_PATH" 2>&1)
    ;;
esac
LINT_EXIT=$?

[ $LINT_EXIT -eq 0 ] || [ -z "$LINT_OUTPUT" ] && exit 0

split_output "$LINT_OUTPUT" "$LANG"

ERRORS=$(echo "$ERRORS" | sed '/^$/d')
WARNINGS=$(echo "$WARNINGS" | sed '/^$/d')

if [ -n "$ERRORS" ] && [ -n "$WARNINGS" ]; then
  jq -n --arg err "$ERRORS" --arg warn "$WARNINGS" \
    '{decision:"block",reason:$err,hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:("Style: "+$warn)}}'
elif [ -n "$ERRORS" ]; then
  jq -n --arg err "$ERRORS" '{decision:"block",reason:$err}'
elif [ -n "$WARNINGS" ]; then
  jq -n --arg warn "$WARNINGS" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:("Style: "+$warn)}}'
fi

exit 0
