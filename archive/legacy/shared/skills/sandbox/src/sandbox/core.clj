(ns sandbox.core
  "Pure functions for sandbox worktree management.
   No side effects — no filesystem, no process, no exit.

   Data shapes:

   Normalized ticket:
     {:input \"00016\"   ; after stripping #
      :bare  \"16\"}     ; after stripping leading zeros

   Create result:
     {:main-repo      \"/path/to/repo\"
      :worktree-path  \"/home/user/.cache/agentbox/worktrees/proj-0001\"
      :branch         \"agentbox/proj-0001\"
      :base-branch    \"main\"
      :status         :created | :exists
      :has-submodules? true | false
      :ticket-file    \"/path/to/repo/todos/0001-task.md\"}"
  (:require [clojure.string :as str]))

;; ---------------------------------------------------------------------------
;; Ticket normalization
;; ---------------------------------------------------------------------------

(defn normalize-ticket
  "Strip leading # and leading zeros from a ticket identifier.
   Returns {:input <after-#-strip> :bare <after-zero-strip>}."
  [raw]
  (let [input (str/replace-first (or raw "") #"^#" "")
        bare  (str/replace input #"^0+" "")
        bare  (if (str/blank? bare) "0" bare)]
    {:input input :bare bare}))

;; ---------------------------------------------------------------------------
;; Ticket file resolution
;; ---------------------------------------------------------------------------

(defn- extract-prefix
  "Extract the prefix before the first dash from a filename.
   \"0001-my-task.md\" → \"0001\"
   \"ABC-custom.md\" → \"ABC\"
   \"0001.2-sub.md\" → \"0001.2\""
  [filename]
  (first (str/split filename #"-" 2)))

(defn extract-ticket-prefix
  "Public version of prefix extraction for use by callers."
  [filename]
  (extract-prefix filename))

(defn resolve-ticket-file
  "Match a ticket number against a list of todo filenames.
   Tries exact prefix match first, then numeric bare-value match.
   Returns the matching filename or nil."
  [filenames input bare]
  (first
    (for [f filenames
          :let [prefix (extract-prefix f)]
          :when (or
                  ;; Exact match (handles non-numeric prefixes like ABC)
                  (= prefix input)
                  ;; Numeric bare-value match (handles zero-padding)
                  (and (re-matches #"^\d+$" prefix)
                       (= bare
                          (let [stripped (str/replace prefix #"^0+" "")]
                            (if (str/blank? stripped) "0" stripped)))))]
      f)))

;; ---------------------------------------------------------------------------
;; Path and naming derivation
;; ---------------------------------------------------------------------------

(defn worktree-name
  "Derive the worktree directory name from project and ticket prefix."
  [project ticket-prefix]
  (str project "-" ticket-prefix))

(defn worktree-path
  "Derive the full worktree path."
  [home project ticket-prefix]
  (str home "/.cache/agentbox/worktrees/" (worktree-name project ticket-prefix)))

(defn branch-name
  "Derive the git branch name for a sandbox."
  [project ticket-prefix]
  (str "agentbox/" (worktree-name project ticket-prefix)))

;; ---------------------------------------------------------------------------
;; Config dir detection
;; ---------------------------------------------------------------------------

(defn detect-config-dir
  "Detect the agent config directory name from env and script context.
   env is a map of environment variables, script-path is the path to
   the running script (or nil)."
  [env script-path]
  (cond
    (seq (get env "AGENT_CONFIG_DIR_NAME"))
    (get env "AGENT_CONFIG_DIR_NAME")

    (and script-path
         (or (str/includes? script-path "/.claude/")
             (str/includes? script-path "/claude/")))
    ".claude"

    :else ".agents"))

;; ---------------------------------------------------------------------------
;; Result construction and formatting
;; ---------------------------------------------------------------------------

(defn create-result
  "Build a structured result map from sandbox creation data."
  [{:keys [main-repo worktree-path branch base-branch
           status has-submodules? ticket-file]}]
  {:main-repo       main-repo
   :worktree-path   worktree-path
   :branch          branch
   :base-branch     base-branch
   :status          status
   :has-submodules? has-submodules?
   :ticket-file     ticket-file})

(defn format-result
  "Format a result map as key-value output lines (vector of strings)."
  [{:keys [main-repo worktree-path branch base-branch
           status has-submodules? ticket-file]}]
  [(str "MainRepo: " main-repo)
   (str "Worktree: " worktree-path)
   (str "Branch: " branch)
   (str "BaseBranch: " base-branch)
   (str "Status: " (name status))
   (str "Submodules: " (if has-submodules? "yes" "no"))
   (str "Ticket: " ticket-file)])

;; ---------------------------------------------------------------------------
;; Finish validation (pure)
;; ---------------------------------------------------------------------------

(defn validate-finish
  "Validate preconditions for sandbox finish.
   Returns nil if valid, or an error message string."
  [{:keys [cwd-toplevel worktree-path branch-exists? worktree-clean?
           main-repo-clean?]}]
  (cond
    (= cwd-toplevel worktree-path)
    "ERROR: Run this from the main repo, not from inside the worktree"

    (not branch-exists?)
    "ERROR: Branch not found"

    (not worktree-clean?)
    "ERROR: Worktree has uncommitted or untracked changes; refusing to finish"

    (not main-repo-clean?)
    "ERROR: Main repo has uncommitted changes; commit or stash before finishing"

    :else nil))

;; ---------------------------------------------------------------------------
;; Argument parsing (pure)
;; ---------------------------------------------------------------------------

(defn parse-create-args
  "Parse create subcommand arguments. Returns {:ticket <string>} or {:ticket nil}."
  [args]
  {:ticket (first args)})

(defn parse-finish-args
  "Parse finish subcommand arguments.
   Returns {:ticket <string> :diff-only? <bool>}."
  [args]
  {:ticket     (first args)
   :diff-only? (boolean (some #{"--diff-only"} args))})
