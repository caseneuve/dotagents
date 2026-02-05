#!/usr/bin/env bash

# detect-and-lint.sh - Detect project type and run available linting/formatting/test tools
# Usage: detect-and-lint.sh [project-dir] [--skip-tests|--run-tests|--host-tests]
# Runs all detected tools and reports results
#
# Flags:
#   --skip-tests    Force skip test execution (only run linters/formatters)
#   --run-tests     Force run tests even without containerization detected
#   --host-tests    Alias for --run-tests (explicit intent to run on host)

set -uo pipefail

SKIP_TESTS=false
RUN_TESTS=false
PROJECT_DIR=""

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --skip-tests)
            SKIP_TESTS=true
            ;;
        --run-tests|--host-tests)
            RUN_TESTS=true
            ;;
        *)
            if [[ -z "$PROJECT_DIR" ]]; then
                PROJECT_DIR="$arg"
            fi
            ;;
    esac
done

PROJECT_DIR="${PROJECT_DIR:-$PWD}"
cd "$PROJECT_DIR" || exit 1

# -----------------------------------------------------------------------------
# Test Safety Checks
# -----------------------------------------------------------------------------

# Detect whether the project's test commands run inside containers.
# Sets CONTAINER_TOOL to the detected runtime name on success.
CONTAINER_TOOL=""

check_containerized_tests() {
    # Explicit container config files
    if [[ -f "docker-compose.yml" ]] || [[ -f "docker-compose.test.yml" ]]; then
        CONTAINER_TOOL="docker-compose"; return 0
    fi
    if [[ -f "docker-compose.yaml" ]] || [[ -f "docker-compose.test.yaml" ]]; then
        CONTAINER_TOOL="docker-compose"; return 0
    fi
    if [[ -f "Dockerfile.test" ]]; then
        CONTAINER_TOOL="Docker"; return 0
    fi
    if [[ -f ".devcontainer/devcontainer.json" ]]; then
        CONTAINER_TOOL="devcontainer"; return 0
    fi

    # Check build/task files for container runtime invocations.
    # bb.edn is handled separately — its test tasks are checked individually
    # in run_bb_tests() for per-task isolation awareness.
    local patterns='docker run|podman run|nerdctl run|docker-compose run|docker compose run'
    for f in Makefile Justfile Taskfile.yml package.json pyproject.toml Rakefile; do
        if [[ -f "$f" ]] && grep -qE "$patterns" "$f" 2>/dev/null; then
            CONTAINER_TOOL="$(grep -oE 'docker|podman|nerdctl' "$f" | head -1)"
            return 0
        fi
    done

    # For bb.edn, check if ANY test task uses containers (partial containerization)
    if [[ -f "bb.edn" ]] && grep -qE "$patterns" bb.edn 2>/dev/null; then
        CONTAINER_TOOL="$(grep -oE 'docker|podman|nerdctl' bb.edn | head -1)"
        return 0
    fi

    return 1
}

# Warn about prerequisites that may need manual setup before tests can run.
check_test_prerequisites() {
    local warnings=()

    if [[ -f ".env.test" ]] || [[ -f ".env.testing" ]]; then
        warnings+=("Test environment files detected - may need setup")
    fi

    if [[ -f "scripts/test-setup.sh" ]] || [[ -x "bin/test-setup" ]]; then
        warnings+=("Test setup scripts detected - may require initialization")
    fi

    if [[ -f "TESTING.md" ]] || [[ -f "docs/testing.md" ]]; then
        warnings+=("Test documentation found - review before running tests")
    fi

    if [[ ${#warnings[@]} -gt 0 ]]; then
        echo "=== TEST PREREQUISITES ==="
        printf '  ! %s\n' "${warnings[@]}"
        echo
    fi
}

echo "=== PROJECT ANALYSIS ==="
echo "Directory: $PROJECT_DIR"
echo

# Informational warnings about test prerequisites
check_test_prerequisites

# Decide whether to run tests based on containerization detection.
# Priority: --skip-tests (force skip) > --run-tests (force run) > auto-detect.
if [[ "$SKIP_TESTS" != "true" && "$RUN_TESTS" != "true" ]]; then
    if check_containerized_tests; then
        echo "=== TEST SAFETY ==="
        echo "  Tests run inside $CONTAINER_TOOL — safe to execute"
        echo
    else
        echo "=== TEST SAFETY ==="
        echo "  No containerization detected — skipping tests"
        echo "  Override with --run-tests if you know tests are safe"
        echo
        SKIP_TESTS=true
    fi
elif [[ "$RUN_TESTS" == "true" ]]; then
    echo "=== TEST SAFETY ==="
    echo "  --run-tests: forcing test execution (user override)"
    echo
fi

# Track results
declare -A RESULTS
DETECTED_LANGS=()
SUGGESTIONS=()

# -----------------------------------------------------------------------------
# Detection Functions
# -----------------------------------------------------------------------------

detect_node() {
    [[ -f "package.json" ]]
}

detect_python() {
    [[ -f "pyproject.toml" ]] || [[ -f "setup.py" ]] || [[ -f "requirements.txt" ]] || \
    [[ -f "Pipfile" ]] || [[ -f "setup.cfg" ]]
}

detect_clojure() {
    [[ -f "deps.edn" ]] || [[ -f "project.clj" ]] || [[ -f "bb.edn" ]]
}

detect_rust() {
    [[ -f "Cargo.toml" ]]
}

detect_go() {
    [[ -f "go.mod" ]]
}

detect_ruby() {
    [[ -f "Gemfile" ]]
}

detect_elixir() {
    [[ -f "mix.exs" ]]
}

# -----------------------------------------------------------------------------
# Runner Functions (return 0=pass, 1=fail, 2=skipped)
# -----------------------------------------------------------------------------

run_tool() {
    local name="$1"
    local cmd="$2"

    echo "--- $name ---"
    if eval "$cmd"; then
        echo "Result: PASS"
        RESULTS["$name"]="PASS"
        return 0
    else
        echo "Result: FAIL"
        RESULTS["$name"]="FAIL"
        return 1
    fi
}

skip_tool() {
    local name="$1"
    local reason="$2"
    RESULTS["$name"]="SKIP ($reason)"
}

suggest_tool() {
    local suggestion="$1"
    SUGGESTIONS+=("$suggestion")
}

# -----------------------------------------------------------------------------
# Node.js / JavaScript / TypeScript
# -----------------------------------------------------------------------------

run_node_tools() {
    DETECTED_LANGS+=("Node.js/JavaScript/TypeScript")

    local pkg_manager="npm"
    [[ -f "yarn.lock" ]] && pkg_manager="yarn"
    [[ -f "pnpm-lock.yaml" ]] && pkg_manager="pnpm"
    [[ -f "bun.lockb" ]] && pkg_manager="bun"

    echo "Package manager: $pkg_manager"
    echo

    # ESLint
    if [[ -f ".eslintrc" ]] || [[ -f ".eslintrc.js" ]] || [[ -f ".eslintrc.json" ]] || \
       [[ -f ".eslintrc.yml" ]] || [[ -f "eslint.config.js" ]] || \
       grep -q '"eslint"' package.json 2>/dev/null; then
        if command -v npx &>/dev/null; then
            run_tool "ESLint" "npx eslint . --max-warnings=0 2>&1 || npx eslint . 2>&1"
        fi
    else
        skip_tool "ESLint" "not configured"
        suggest_tool "ESLint (JavaScript/TypeScript linter)|$pkg_manager install --save-dev eslint|Catches common JS errors and enforces code style"
    fi

    # Prettier
    if [[ -f ".prettierrc" ]] || [[ -f ".prettierrc.js" ]] || [[ -f ".prettierrc.json" ]] || \
       [[ -f "prettier.config.js" ]] || grep -q '"prettier"' package.json 2>/dev/null; then
        if command -v npx &>/dev/null; then
            run_tool "Prettier" "npx prettier --check . 2>&1"
        fi
    else
        skip_tool "Prettier" "not configured"
        suggest_tool "Prettier (code formatter)|$pkg_manager install --save-dev prettier|Automatic code formatting for consistent style"
    fi

    # TypeScript
    if [[ -f "tsconfig.json" ]]; then
        if command -v npx &>/dev/null; then
            run_tool "TypeScript" "npx tsc --noEmit 2>&1"
        fi
    else
        skip_tool "TypeScript" "no tsconfig.json"
    fi

    # Biome (newer alternative to ESLint+Prettier)
    if [[ -f "biome.json" ]] || [[ -f "biome.jsonc" ]]; then
        if command -v npx &>/dev/null; then
            run_tool "Biome" "npx @biomejs/biome check . 2>&1"
        fi
    fi

    # Tests - check package.json for test script
    if [[ "$SKIP_TESTS" == "true" ]]; then
        skip_tool "Tests (npm)" "skipped via --skip-tests"
    elif grep -q '"test"' package.json 2>/dev/null; then
        run_tool "Tests (npm)" "$pkg_manager test 2>&1"
    else
        skip_tool "Tests (npm)" "no test script in package.json"
    fi
}

# -----------------------------------------------------------------------------
# Python
# -----------------------------------------------------------------------------

run_python_tools() {
    DETECTED_LANGS+=("Python")

    # Ruff (fast linter + formatter)
    if command -v ruff &>/dev/null; then
        run_tool "Ruff (lint)" "ruff check . 2>&1"
        run_tool "Ruff (format)" "ruff format --check . 2>&1"
    elif [[ -f "pyproject.toml" ]] && grep -q 'ruff' pyproject.toml 2>/dev/null; then
        skip_tool "Ruff" "configured but not installed"
    else
        # Only suggest if no other linters detected
        if ! command -v black &>/dev/null && ! command -v flake8 &>/dev/null; then
            suggest_tool "Ruff (fast Python linter + formatter)|pip install ruff|Fast linter and formatter, replaces multiple tools (flake8, black, isort)"
        fi
    fi

    # Black
    if command -v black &>/dev/null; then
        run_tool "Black" "black --check . 2>&1"
    elif [[ -f "pyproject.toml" ]] && grep -q 'black' pyproject.toml 2>/dev/null; then
        skip_tool "Black" "configured but not installed"
    fi

    # isort
    if command -v isort &>/dev/null; then
        run_tool "isort" "isort --check-only . 2>&1"
    fi

    # Flake8
    if command -v flake8 &>/dev/null && [[ -f ".flake8" ]] || [[ -f "setup.cfg" ]]; then
        run_tool "Flake8" "flake8 . 2>&1"
    fi

    # Pylint
    if command -v pylint &>/dev/null && [[ -f ".pylintrc" ]] || [[ -f "pylintrc" ]]; then
        run_tool "Pylint" "pylint **/*.py 2>&1"
    fi

    # MyPy
    if command -v mypy &>/dev/null; then
        if [[ -f "mypy.ini" ]] || [[ -f ".mypy.ini" ]] || \
           ([[ -f "pyproject.toml" ]] && grep -q '\[tool.mypy\]' pyproject.toml 2>/dev/null); then
            run_tool "MyPy" "mypy . 2>&1"
        fi
    fi

    # Pyright
    if command -v pyright &>/dev/null; then
        if [[ -f "pyrightconfig.json" ]] || \
           ([[ -f "pyproject.toml" ]] && grep -q '\[tool.pyright\]' pyproject.toml 2>/dev/null); then
            run_tool "Pyright" "pyright 2>&1"
        fi
    fi

    # Bandit (security)
    if command -v bandit &>/dev/null; then
        run_tool "Bandit (security)" "bandit -r . -q 2>&1"
    fi

    # Tests - pytest
    if [[ "$SKIP_TESTS" == "true" ]]; then
        skip_tool "Pytest" "skipped via --skip-tests"
    elif command -v pytest &>/dev/null; then
        if [[ -d "tests" ]] || [[ -d "test" ]] || find . -maxdepth 1 -name '*_test.py' -o -name 'test_*.py' 2>/dev/null | head -1 | grep -q .; then
            run_tool "Pytest" "pytest --tb=short 2>&1"
        else
            skip_tool "Pytest" "no tests directory found"
        fi
    fi

    # Tests - unittest via pyproject.toml or setup.py
    if [[ "$SKIP_TESTS" == "true" ]]; then
        skip_tool "Unittest" "skipped via --skip-tests"
    elif [[ -f "pyproject.toml" ]] && grep -q 'unittest' pyproject.toml 2>/dev/null; then
        run_tool "Unittest" "python -m unittest discover 2>&1"
    fi
}

# -----------------------------------------------------------------------------
# Clojure / Babashka
# -----------------------------------------------------------------------------

run_clojure_tools() {
    DETECTED_LANGS+=("Clojure/Babashka")

    # clj-kondo
    if command -v clj-kondo &>/dev/null; then
        run_tool "clj-kondo" "clj-kondo --lint src:test 2>&1 || clj-kondo --lint src 2>&1 || clj-kondo --lint . 2>&1"
    else
        skip_tool "clj-kondo" "not installed"
        suggest_tool "clj-kondo (Clojure linter)|brew install borkdude/brew/clj-kondo (or see https://github.com/clj-kondo/clj-kondo)|Fast, comprehensive Clojure/ClojureScript linter"
    fi

    # clojure-lsp diagnostics
    if command -v clojure-lsp &>/dev/null; then
        run_tool "clojure-lsp" "clojure-lsp diagnostics -p \"$PROJECT_DIR\" 2>&1"
    else
        skip_tool "clojure-lsp" "not installed"
    fi

    # cljfmt (check formatting)
    if command -v cljfmt &>/dev/null; then
        run_tool "cljfmt" "cljfmt check 2>&1"
    elif [[ -f "deps.edn" ]] && grep -q 'cljfmt' deps.edn 2>/dev/null; then
        run_tool "cljfmt (deps)" "clojure -M:cljfmt check 2>&1"
    fi

    # Eastwood (linter)
    if [[ -f "deps.edn" ]] && grep -q 'eastwood' deps.edn 2>/dev/null; then
        run_tool "Eastwood" "clojure -M:eastwood 2>&1"
    fi

    # Tests
    if [[ "$SKIP_TESTS" == "true" ]]; then
        skip_tool "Tests (Clojure)" "skipped via --skip-tests"
    elif [[ -f "bb.edn" ]]; then
        run_bb_tests
    elif [[ -f "deps.edn" ]]; then
        if grep -q ':test' deps.edn 2>/dev/null; then
            run_tool "Tests (clj)" "clojure -M:test 2>&1"
        elif [[ -d "test" ]]; then
            run_tool "Tests (clj)" "clojure -M -m cognitect.test-runner 2>&1"
        fi
    elif [[ -f "project.clj" ]]; then
        run_tool "Tests (lein)" "lein test 2>&1"
    fi
}

# Discover and run test tasks from bb.edn with isolation awareness.
# Parses bb.edn :tasks for test-related entries and checks whether each
# wraps execution in a container (docker/podman/nerdctl).
run_bb_tests() {
    local container_re='docker run|podman run|nerdctl run|docker-compose run|docker compose run'

    # Extract test-related task names from bb.edn :tasks map.
    # Matches keys that start with "test" (e.g. :test, :test:unit, :test-integration).
    local test_tasks
    test_tasks=$(grep -oP '(?<=:)test[^\s{}\]]*' bb.edn 2>/dev/null | sort -u)

    if [[ -z "$test_tasks" ]]; then
        # No explicit test tasks — check for a test directory as fallback
        if [[ -d "test" ]]; then
            skip_tool "Tests (bb)" "no test tasks in bb.edn — 'test/' dir exists but no :test task defined"
        else
            skip_tool "Tests (bb)" "no test tasks in bb.edn"
        fi
        return
    fi

    echo "=== BB.EDN TEST TASKS ==="
    echo "  Found: $(echo "$test_tasks" | tr '\n' ' ')"
    echo

    local ran_any=false

    while IFS= read -r task; do
        # Extract the task body: everything between this task key and the next top-level key.
        # This is a rough heuristic — good enough for checking container invocations.
        local task_body
        task_body=$(sed -n "/:$task[[:space:]\n]/,/^[[:space:]]*:[a-z]/p" bb.edn 2>/dev/null)

        if echo "$task_body" | grep -qE "$container_re"; then
            # Task runs inside a container — safe to execute
            echo "  :$task → containerized (safe)"
            run_tool "Tests (bb :$task)" "bb $task 2>&1"
            ran_any=true
        elif [[ "$RUN_TESTS" == "true" ]]; then
            # User explicitly allowed host execution
            echo "  :$task → host (--run-tests override)"
            run_tool "Tests (bb :$task)" "bb $task 2>&1"
            ran_any=true
        else
            echo "  :$task → host (skipped — no container isolation)"
            skip_tool "Tests (bb :$task)" "no container isolation; use --host-tests to override"
        fi
    done <<< "$test_tasks"

    if [[ "$ran_any" == "false" ]]; then
        echo
        echo "  No bb test tasks were safe to run without --host-tests"
    fi
    echo
}

# -----------------------------------------------------------------------------
# Generic tools (Makefile, pre-commit, etc.)
# -----------------------------------------------------------------------------

run_generic_tools() {
    # Makefile targets
    if [[ -f "Makefile" ]]; then
        if grep -q '^lint:' Makefile; then
            run_tool "make lint" "make lint 2>&1"
        fi
        if [[ "$SKIP_TESTS" == "true" ]]; then
            if grep -q '^test:' Makefile; then
                skip_tool "make test" "skipped via --skip-tests"
            fi
        else
            if grep -q '^test:' Makefile; then
                run_tool "make test" "make test 2>&1"
            fi
        fi
        if grep -q '^check:' Makefile; then
            run_tool "make check" "make check 2>&1"
        fi
    fi

    # pre-commit
    if [[ -f ".pre-commit-config.yaml" ]] && command -v pre-commit &>/dev/null; then
        run_tool "pre-commit" "pre-commit run --all-files 2>&1"
    fi

    # EditorConfig check
    if [[ -f ".editorconfig" ]] && command -v editorconfig-checker &>/dev/null; then
        run_tool "EditorConfig" "editorconfig-checker 2>&1"
    fi
}

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

echo "=== DETECTED PROJECT TYPES ==="

detect_node && run_node_tools
detect_python && run_python_tools
detect_clojure && run_clojure_tools
detect_rust && run_rust_tools
detect_go && run_go_tools
detect_ruby && run_ruby_tools
detect_elixir && run_elixir_tools

if [[ ${#DETECTED_LANGS[@]} -eq 0 ]]; then
    echo "No specific project type detected"
fi

echo
run_generic_tools

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

echo
echo "=== SUMMARY ==="
echo "Languages: ${DETECTED_LANGS[*]:-None detected}"
echo

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# Count results and build output (avoid subshell from pipe)
OUTPUT=""
for tool in "${!RESULTS[@]}"; do
    result="${RESULTS[$tool]}"
    if [[ "$result" == "PASS" ]]; then
        ((PASS_COUNT++))
        OUTPUT+="  PASS: $tool"$'\n'
    elif [[ "$result" == "FAIL" ]]; then
        ((FAIL_COUNT++))
        OUTPUT+="  FAIL: $tool"$'\n'
    else
        ((SKIP_COUNT++))
        OUTPUT+="  SKIP: $tool - ${result#SKIP }"$'\n'
    fi
done

# Display sorted output
printf '%s' "$OUTPUT" | sort

echo
echo "Total: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped"

# -----------------------------------------------------------------------------
# Suggestions for Missing Tools
# -----------------------------------------------------------------------------

if [[ ${#SUGGESTIONS[@]} -gt 0 ]]; then
    echo
    echo "=== MISSING LINTERS/TOOLS ==="
    echo
    echo "The following recommended tools are not configured:"
    echo
    for suggestion in "${SUGGESTIONS[@]}"; do
        IFS='|' read -r name install benefit <<< "$suggestion"
        echo "• $name"
        echo "  Install: $install"
        echo "  Benefit: $benefit"
        echo
    done
    echo "NOTE: Always ask the user before installing any tools or modifying project files."
fi

if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
fi
exit 0
