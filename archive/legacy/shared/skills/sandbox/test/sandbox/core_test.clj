(ns sandbox.core-test
  (:require [sandbox.core :as sut]
            [clojure.test :refer [deftest is testing]]))

;; ---------------------------------------------------------------------------
;; normalize-ticket
;; ---------------------------------------------------------------------------

(deftest normalize-ticket-test
  (testing "plain number passes through"
    (is (= {:input "16" :bare "16"} (sut/normalize-ticket "16"))))

  (testing "strips leading #"
    (is (= {:input "16" :bare "16"} (sut/normalize-ticket "#16"))))

  (testing "strips leading zeros"
    (is (= {:input "00016" :bare "16"} (sut/normalize-ticket "00016"))))

  (testing "strips # and leading zeros"
    (is (= {:input "00016" :bare "16"} (sut/normalize-ticket "#00016"))))

  (testing "zero stays as zero"
    (is (= {:input "0" :bare "0"} (sut/normalize-ticket "0"))))

  (testing "all zeros normalize to 0"
    (is (= {:input "000" :bare "0"} (sut/normalize-ticket "000"))))

  (testing "non-numeric prefix preserved"
    (is (= {:input "ABC" :bare "ABC"} (sut/normalize-ticket "ABC"))))

  (testing "single digit"
    (is (= {:input "5" :bare "5"} (sut/normalize-ticket "5")))))

;; ---------------------------------------------------------------------------
;; resolve-ticket-file
;; ---------------------------------------------------------------------------

(deftest resolve-ticket-file-test
  (let [filenames ["0001-first-task.md"
                   "0002-second-task.md"
                   "0010-tenth-task.md"
                   "0010.1-sub-task.md"
                   "ABC-custom.md"]]

    (testing "matches by bare number"
      (is (= "0001-first-task.md"
             (sut/resolve-ticket-file filenames "1" "1"))))

    (testing "matches with leading zeros in input"
      (is (= "0001-first-task.md"
             (sut/resolve-ticket-file filenames "0001" "1"))))

    (testing "matches higher numbers"
      (is (= "0010-tenth-task.md"
             (sut/resolve-ticket-file filenames "10" "10"))))

    (testing "matches exact non-numeric prefix"
      (is (= "ABC-custom.md"
             (sut/resolve-ticket-file filenames "ABC" "ABC"))))

    (testing "returns nil when no match"
      (is (nil? (sut/resolve-ticket-file filenames "999" "999"))))

    (testing "does not match sub-task files for parent number"
      ;; "0010-tenth-task.md" should match, not "0010.1-sub-task.md"
      ;; resolve-ticket-file returns first match — the parent
      (is (= "0010-tenth-task.md"
             (sut/resolve-ticket-file filenames "10" "10"))))

    (testing "empty filenames returns nil"
      (is (nil? (sut/resolve-ticket-file [] "1" "1"))))))

;; ---------------------------------------------------------------------------
;; extract-ticket-prefix
;; ---------------------------------------------------------------------------

(deftest extract-ticket-prefix-test
  (testing "extracts numeric prefix"
    (is (= "0001" (sut/extract-ticket-prefix "0001-my-task.md"))))

  (testing "extracts non-numeric prefix"
    (is (= "ABC" (sut/extract-ticket-prefix "ABC-custom.md"))))

  (testing "extracts dotted sub-task prefix"
    (is (= "0001.2" (sut/extract-ticket-prefix "0001.2-sub-task.md")))))

;; ---------------------------------------------------------------------------
;; worktree-path
;; ---------------------------------------------------------------------------

(deftest worktree-path-test
  (testing "builds path from home, project, and ticket prefix"
    (is (= "/home/user/.cache/agentbox/worktrees/myproject-0001"
           (sut/worktree-path "/home/user" "myproject" "0001"))))

  (testing "different project"
    (is (= "/tmp/.cache/agentbox/worktrees/app-0042"
           (sut/worktree-path "/tmp" "app" "0042")))))

;; ---------------------------------------------------------------------------
;; branch-name
;; ---------------------------------------------------------------------------

(deftest branch-name-test
  (testing "builds branch from project and ticket prefix"
    (is (= "agentbox/myproject-0001"
           (sut/branch-name "myproject" "0001"))))

  (testing "different values"
    (is (= "agentbox/app-0042"
           (sut/branch-name "app" "0042")))))

;; ---------------------------------------------------------------------------
;; worktree-name
;; ---------------------------------------------------------------------------

(deftest worktree-name-test
  (testing "builds worktree dir name"
    (is (= "myproject-0001"
           (sut/worktree-name "myproject" "0001")))))

;; ---------------------------------------------------------------------------
;; detect-config-dir
;; ---------------------------------------------------------------------------

(deftest detect-config-dir-test
  (testing "uses AGENT_CONFIG_DIR_NAME env var when set"
    (is (= ".custom" (sut/detect-config-dir {"AGENT_CONFIG_DIR_NAME" ".custom"}
                                            nil))))

  (testing "detects .claude from script path"
    (is (= ".claude" (sut/detect-config-dir {}
                                            "/home/user/.claude/skills/sandbox/cli.clj"))))

  (testing "detects .claude from /claude/ in path"
    (is (= ".claude" (sut/detect-config-dir {}
                                            "/opt/claude/skills/sandbox.clj"))))

  (testing "defaults to .agents"
    (is (= ".agents" (sut/detect-config-dir {} "/home/user/.agents/skills/sandbox.clj"))))

  (testing "defaults to .agents when no script path"
    (is (= ".agents" (sut/detect-config-dir {} nil)))))

;; ---------------------------------------------------------------------------
;; create-result
;; ---------------------------------------------------------------------------

(deftest create-result-test
  (testing "builds structured result map"
    (let [r (sut/create-result {:main-repo "/repo"
                                :worktree-path "/wt"
                                :branch "agentbox/proj-0001"
                                :base-branch "main"
                                :status :created
                                :has-submodules? false
                                :ticket-file "/repo/todos/0001-task.md"})]
      (is (= "/repo" (:main-repo r)))
      (is (= "/wt" (:worktree-path r)))
      (is (= "agentbox/proj-0001" (:branch r)))
      (is (= "main" (:base-branch r)))
      (is (= :created (:status r)))
      (is (false? (:has-submodules? r)))
      (is (= "/repo/todos/0001-task.md" (:ticket-file r))))))

;; ---------------------------------------------------------------------------
;; format-result
;; ---------------------------------------------------------------------------

(deftest format-result-test
  (testing "formats result as key-value lines"
    (let [r {:main-repo "/repo"
             :worktree-path "/wt"
             :branch "agentbox/proj-0001"
             :base-branch "main"
             :status :created
             :has-submodules? true
             :ticket-file "/repo/todos/0001-task.md"}
          lines (sut/format-result r)]
      (is (= "MainRepo: /repo" (nth lines 0)))
      (is (= "Worktree: /wt" (nth lines 1)))
      (is (= "Branch: agentbox/proj-0001" (nth lines 2)))
      (is (= "BaseBranch: main" (nth lines 3)))
      (is (= "Status: created" (nth lines 4)))
      (is (= "Submodules: yes" (nth lines 5)))
      (is (= "Ticket: /repo/todos/0001-task.md" (nth lines 6))))))

;; ---------------------------------------------------------------------------
;; finish precondition validation (pure)
;; ---------------------------------------------------------------------------

(deftest validate-finish-test
  (testing "passes when all preconditions met"
    (is (nil? (sut/validate-finish {:cwd-toplevel "/repo"
                                    :worktree-path "/wt"
                                    :branch-exists? true
                                    :worktree-clean? true
                                    :main-repo-clean? true}))))

  (testing "fails when inside worktree"
    (let [err (sut/validate-finish {:cwd-toplevel "/wt"
                                    :worktree-path "/wt"
                                    :branch-exists? true
                                    :worktree-clean? true
                                    :main-repo-clean? true})]
      (is (some? err))
      (is (re-find #"main repo" err))))

  (testing "fails when branch missing"
    (let [err (sut/validate-finish {:cwd-toplevel "/repo"
                                    :worktree-path "/wt"
                                    :branch-exists? false
                                    :worktree-clean? true
                                    :main-repo-clean? true})]
      (is (some? err))
      (is (re-find #"[Bb]ranch" err))))

  (testing "fails when worktree dirty"
    (let [err (sut/validate-finish {:cwd-toplevel "/repo"
                                    :worktree-path "/wt"
                                    :branch-exists? true
                                    :worktree-clean? false
                                    :main-repo-clean? true})]
      (is (some? err))
      (is (re-find #"uncommitted" err))))

  (testing "fails when main repo dirty"
    (let [err (sut/validate-finish {:cwd-toplevel "/repo"
                                    :worktree-path "/wt"
                                    :branch-exists? true
                                    :worktree-clean? true
                                    :main-repo-clean? false})]
      (is (some? err))
      (is (re-find #"[Mm]ain repo" err))
      (is (re-find #"uncommitted" err)))))

;; ---------------------------------------------------------------------------
;; parse-args
;; ---------------------------------------------------------------------------

(deftest parse-create-args-test
  (testing "parses ticket number"
    (is (= {:ticket "16"} (sut/parse-create-args ["16"]))))

  (testing "nil on empty args"
    (is (nil? (:ticket (sut/parse-create-args []))))))

(deftest parse-finish-args-test
  (testing "parses ticket number"
    (let [r (sut/parse-finish-args ["16"])]
      (is (= "16" (:ticket r)))
      (is (false? (:diff-only? r)))))

  (testing "parses --diff-only flag"
    (let [r (sut/parse-finish-args ["16" "--diff-only"])]
      (is (= "16" (:ticket r)))
      (is (true? (:diff-only? r)))))

  (testing "nil ticket on empty args"
    (is (nil? (:ticket (sut/parse-finish-args []))))))
