#!/usr/bin/env bb

(ns sandbox.cli
  "CLI entry point for sandbox worktree management.
   Dispatches subcommands: create, finish.

   Usage:
     sandbox create <ticket-num>
     sandbox finish <ticket-num> [--diff-only]"
  (:require [babashka.cli :as cli]
            [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]
            [sandbox.core :as core]
            [mux.protocol :as mp]
            [mux.cmux :as cmux]))

;; ---------------------------------------------------------------------------
;; Shell / git helpers
;; ---------------------------------------------------------------------------

(defn- sh
  "Run command, return trimmed stdout. Throws on non-zero exit."
  [& args]
  (let [result (apply p/sh args)]
    (when-not (zero? (:exit result))
      (throw (ex-info (str "Command failed (exit " (:exit result) "): "
                           (str/join " " args))
                      {:exit (:exit result) :cmd args
                       :out (:out result) :err (:err result)})))
    (str/trim (:out result))))

(defn- sh?
  "Run command, return trimmed stdout or nil on failure."
  [& args]
  (try (apply sh args) (catch Exception _ nil)))

(defn- git
  "Run a git command with optional :dir. Returns trimmed stdout."
  [& args]
  (apply sh "git" args))

(defn- git-in
  "Run a git command in a specific directory."
  [dir & args]
  (let [result (apply p/sh {:dir dir} "git" args)]
    (when-not (zero? (:exit result))
      (throw (ex-info (str "git failed in " dir) {:exit (:exit result)
                                                   :cmd args
                                                   :err (:err result)})))
    (str/trim (:out result))))

(defn- git-toplevel []
  (sh? "git" "rev-parse" "--show-toplevel"))

(defn- git-branch []
  (sh? "git" "symbolic-ref" "--short" "HEAD"))

(defn- git-branch-exists? [branch]
  (try (git "rev-parse" "--verify" branch) true
       (catch Exception _ false)))

(defn- git-worktree-clean? [dir]
  (str/blank? (git-in dir "status" "--porcelain")))

(defn- git-has-changes? [base-branch sandbox-branch]
  (not (zero? (:exit (p/sh "git" "diff" "--quiet"
                            (str base-branch "..." sandbox-branch))))))

;; ---------------------------------------------------------------------------
;; Ticket resolution (I/O boundary)
;; ---------------------------------------------------------------------------

(defn- todo-filenames
  "List *.md filenames in todos dir."
  [todos-dir]
  (if (fs/directory? todos-dir)
    (->> (fs/glob todos-dir "*.md")
         (sort)
         (mapv #(str (fs/file-name %))))
    []))

(defn- resolve-ticket!
  "Resolve ticket number to file. Exits on failure."
  [todos-dir raw-ticket]
  (when (str/blank? raw-ticket)
    (binding [*out* *err*]
      (println "ERROR: ticket number required"))
    (System/exit 1))
  (let [{:keys [input bare]} (core/normalize-ticket raw-ticket)
        filenames (todo-filenames todos-dir)
        match     (core/resolve-ticket-file filenames input bare)]
    (when-not match
      (binding [*out* *err*]
        (println (str "ERROR: No ticket matching prefix " raw-ticket " in " todos-dir)))
      (System/exit 1))
    {:filename match
     :prefix   (core/extract-ticket-prefix match)
     :path     (str (fs/path todos-dir match))}))

;; ---------------------------------------------------------------------------
;; Config symlinking
;; ---------------------------------------------------------------------------

(defn- untracked-in-config-dir
  "List items in config-dir that are NOT tracked by git."
  [main-repo config-dir-name]
  (let [config-dir (str (fs/path main-repo config-dir-name))]
    (when (fs/directory? config-dir)
      (->> (fs/list-dir config-dir)
           (map #(str (fs/file-name %)))
           (remove (fn [name]
                     (try
                       (seq (git-in main-repo "ls-files"
                                    (str config-dir-name "/" name)))
                       (catch Exception _ false))))))))

(defn- symlink-config!
  "Symlink untracked config items from main repo into worktree."
  [main-repo worktree-path config-dir-name]
  (when-let [items (seq (untracked-in-config-dir main-repo config-dir-name))]
    (let [wt-config (str (fs/path worktree-path config-dir-name))]
      (fs/create-dirs wt-config)
      (doseq [name items
              :let [source (str (fs/path main-repo config-dir-name name))
                    target (str (fs/path wt-config name))]
              :when (not (fs/exists? target))]
        (fs/create-sym-link target source)))))

;; ---------------------------------------------------------------------------
;; cmux workspace integration
;; ---------------------------------------------------------------------------

(defn- open-cmux-workspace!
  "If running inside cmux, open a new workspace for the worktree.
   Best-effort — failures are warned, not fatal."
  [branch worktree-path]
  (when (= :cmux (mp/detect-mux (into {} (System/getenv))))
    (try
      (let [cmux-bin (or (some-> (fs/which "cmux") str)
                         "/Applications/cmux.app/Contents/Resources/bin/cmux")
            prev-ws  (try (cmux/cmux! cmux-bin "current-workspace")
                          (catch Exception _ nil))
            args     (cmux/build-cmux-args :new-workspace
                                           {:name branch :cwd worktree-path})]
        (apply cmux/cmux! cmux-bin args)
        ;; Restore focus to original workspace
        (when prev-ws
          (try (cmux/cmux! cmux-bin "select-workspace" "--workspace" prev-ws)
               (catch Exception _ nil)))
        ;; Notify
        (let [n-args (cmux/build-cmux-args :notify
                                           {:title "Worktree ready"
                                            :body (str "Workspace '" branch "' opened")})]
          (apply cmux/cmux! cmux-bin n-args))
        (println (str "Cmux workspace: " branch)))
      (catch Exception e
        (binding [*out* *err*]
          (println (str "Warning: cmux workspace creation failed: "
                        (.getMessage e))))))))

;; ---------------------------------------------------------------------------
;; Subcommand: create
;; ---------------------------------------------------------------------------

(defn cmd-create [{:keys [args]}]
  (let [raw-ticket (first args)]
    (when (str/blank? raw-ticket)
      (binding [*out* *err*]
        (println "Usage: sandbox create <ticket-num>"))
      (System/exit 1))

    (let [main-repo    (or (git-toplevel)
                           (do (binding [*out* *err*]
                                 (println "ERROR: Not inside a git repository"))
                               (System/exit 1)))
          project-name (str (fs/file-name main-repo))
          base-branch  (git-branch)
          todos-dir    (str (fs/path main-repo "todos"))
          ticket       (resolve-ticket! todos-dir raw-ticket)
          prefix       (:prefix ticket)
          wt-path      (core/worktree-path (str (fs/home)) project-name prefix)
          branch       (core/branch-name project-name prefix)]

      ;; Already exists?
      (when (fs/directory? wt-path)
        (let [has-sub? (fs/exists? (str (fs/path wt-path ".gitmodules")))]
          (doseq [line (core/format-result
                         (core/create-result
                           {:main-repo       main-repo
                            :worktree-path   wt-path
                            :branch          branch
                            :base-branch     base-branch
                            :status          :exists
                            :has-submodules? has-sub?
                            :ticket-file     (:path ticket)}))]
            (println line))
          (System/exit 0)))

      ;; Create worktree
      (fs/create-dirs (fs/parent wt-path))
      (git "worktree" "add" wt-path "-b" branch base-branch)

      ;; Symlink config
      (let [env         (into {} (System/getenv))
            config-dir  (core/detect-config-dir env (System/getProperty "babashka.file"))]
        (symlink-config! main-repo wt-path config-dir))

      ;; Initialize submodules
      (let [has-sub? (fs/exists? (str (fs/path wt-path ".gitmodules")))]
        (when has-sub?
          (git-in wt-path "submodule" "update" "--init" "--recursive"))

        ;; Open cmux workspace (best-effort)
        (open-cmux-workspace! branch wt-path)

        ;; Output
        (doseq [line (core/format-result
                       (core/create-result
                         {:main-repo       main-repo
                          :worktree-path   wt-path
                          :branch          branch
                          :base-branch     base-branch
                          :status          :created
                          :has-submodules? has-sub?
                          :ticket-file     (:path ticket)}))]
          (println line))))))

;; ---------------------------------------------------------------------------
;; Subcommand: finish
;; ---------------------------------------------------------------------------

(defn cmd-finish [{:keys [opts]}]
  (let [raw-ticket (some-> (:ticket opts) str)
        diff-only? (:diff-only opts)]
    (when (str/blank? raw-ticket)
      (binding [*out* *err*]
        (println "Usage: sandbox finish <ticket-num> [--diff-only]"))
      (System/exit 1))

    (let [main-repo    (or (git-toplevel)
                           (do (binding [*out* *err*]
                                 (println "ERROR: Not inside a git repository"))
                               (System/exit 1)))
          project-name (str (fs/file-name main-repo))
          base-branch  (git-branch)
          todos-dir    (str (fs/path main-repo "todos"))
          ;; Resolve ticket — fall back to raw input if no file found
          ticket       (let [{:keys [input bare]} (core/normalize-ticket raw-ticket)
                             filenames (todo-filenames todos-dir)
                             match     (core/resolve-ticket-file filenames input bare)]
                         (if match
                           {:prefix (core/extract-ticket-prefix match)
                            :path   (str (fs/path todos-dir match))}
                           {:prefix raw-ticket :path nil}))
          prefix       (:prefix ticket)
          wt-path      (core/worktree-path (str (fs/home)) project-name prefix)
          branch       (core/branch-name project-name prefix)]

      ;; Validate
      (when-not (git-branch-exists? branch)
        (binding [*out* *err*]
          (println (str "ERROR: Branch '" branch "' not found")))
        (System/exit 1))

      ;; Diff-only mode
      (when diff-only?
        (println (str "=== Changes in " branch " (relative to " base-branch ") ==="))
        (p/shell "git" "diff" (str base-branch "..." branch))
        (println)
        (println "=== Commits ===")
        (p/shell "git" "log" "--oneline" (str base-branch ".." branch))
        (System/exit 0))

      ;; Validate preconditions
      (let [cwd-top (git-toplevel)]
        (when-let [err (core/validate-finish
                         {:cwd-toplevel    cwd-top
                          :worktree-path   wt-path
                          :branch-exists?  true ;; already checked above
                          :worktree-clean? (if (fs/directory? wt-path)
                                             (git-worktree-clean? wt-path)
                                             true)})]
          (binding [*out* *err*]
            (println err)
            (when (and (fs/directory? wt-path)
                       (str/includes? err "uncommitted"))
              (println (str "Worktree: " wt-path))
              (println "Commit/stash/clean the worktree first, then rerun sandbox finish.")
              (println)
              (println (git-in wt-path "status" "--porcelain"))))
          (System/exit 1)))

      ;; Squash merge (or skip if no changes)
      (if (git-has-changes? base-branch branch)
        (do
          (p/shell "git" "merge" "--squash" branch)
          (p/shell "git" "commit" "-m" (str "[sandbox] merge ticket " raw-ticket))
          (println (str "Merged: " branch " -> " base-branch " (squash)")))
        (do
          (binding [*out* *err*]
            (println (str "No changes to merge — branch is identical to " base-branch))
            (println "Cleaning up worktree and branch only."))))

      ;; Clean up
      (when (fs/directory? wt-path)
        (try (p/shell "git" "worktree" "remove" "--force" wt-path)
             (catch Exception _
               (fs/delete-tree wt-path)))
        (p/shell "git" "worktree" "prune"))
      (p/shell "git" "branch" "-D" branch)

      (println (str "Removed: worktree " wt-path))
      (println (str "Removed: branch " branch)))))

;; ---------------------------------------------------------------------------
;; Help
;; ---------------------------------------------------------------------------

(defn cmd-help [_]
  (println "Usage: sandbox <command> [options]")
  (println)
  (println "Commands:")
  (println "  create <ticket-num>              Create worktree for ticket")
  (println "  finish <ticket-num> [--diff-only] Merge and clean up worktree")
  (println)
  (println "Examples:")
  (println "  sandbox create 16")
  (println "  sandbox create #00016")
  (println "  sandbox finish 16 --diff-only")
  (println "  sandbox finish 16"))

;; ---------------------------------------------------------------------------
;; Dispatch
;; ---------------------------------------------------------------------------

(def dispatch-table
  [{:cmds ["create"] :fn cmd-create :args->opts []}
   {:cmds ["finish"] :fn cmd-finish
    :spec {:diff-only {:coerce :boolean :desc "Show diff only, don't merge"}
           :ticket {:coerce :string :desc "Ticket number"}}
    :args->opts [:ticket]}
   {:cmds [] :fn cmd-help}])

(defn -main [& args]
  (cli/dispatch dispatch-table args))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
