#!/usr/bin/env bb

(ns tmux-agent.cli
  "CLI entry point for tmux agent session management.
   Thin wrapper around mux.runner and mux.runner.preflight.

   Usage:
     tmux-agent create [PROJECT] [CWD]
     tmux-agent run <window> <command> [--timeout N] [--cd DIR] [--sock PATH] [--session NAME]
     tmux-agent status [PROJECT] [CWD]
     tmux-agent wait [PROJECT] [WINDOW] [CAPTURE-LINES]"
  (:require [babashka.cli :as cli]
            [babashka.process :as p]
            [clojure.string :as str]
            [mux.protocol :as mp]
            [mux.tmux :as mt]
            [mux.runner :as runner]
            [mux.runner.preflight :as preflight]))

;; ---------------------------------------------------------------------------
;; Shared constants
;; ---------------------------------------------------------------------------

(def ^:private shell-commands #{"bash" "zsh" "fish" "sh"})

(defn- shell-cmd? [cmd] (contains? shell-commands cmd))

;; ---------------------------------------------------------------------------
;; I/O helpers
;; ---------------------------------------------------------------------------

(defn- sh?
  "Run command, return trimmed stdout or nil on failure."
  [& args]
  (try
    (let [result (apply p/sh args)]
      (when (zero? (:exit result))
        (str/trim (:out result))))
    (catch Exception _ nil)))

(defn- git-project []
  (some-> (sh? "git" "rev-parse" "--show-toplevel")
          (str/split #"/") last))

(defn- git-branch []
  (or (sh? "git" "rev-parse" "--abbrev-ref" "HEAD") "default"))

(defn- resolve-backend
  "Create a tmux backend from explicit opts or auto-derived session info."
  [{:keys [sock session]}]
  (if (and sock session)
    (mp/make-backend :tmux {:sock sock :session session})
    (let [project (or (git-project) "agent")
          branch  (git-branch)
          info    (mt/derive-session-info project branch)]
      (mp/make-backend :tmux info))))

;; ---------------------------------------------------------------------------
;; Subcommand: create
;; ---------------------------------------------------------------------------

(defn cmd-create [{:keys [opts]}]
  (let [project (or (:project opts) (git-project) "agent")
        cwd     (or (:cwd opts) (System/getProperty "user.dir"))
        info    (mt/derive-session-info project "default")
        backend (mp/make-backend :tmux info)
        result  (preflight/ensure-session! backend {:start-dir cwd})]
    (println (if (= :exists (:status result))
               "Session already exists"
               "Session created"))
    (println (str "Socket:  " (:sock info)))
    (println (str "Session: " (:session info)))
    (when (= :created (:status result))
      (println (str "CWD:     " cwd)))
    (println (str "Attach:  tmux -S " (:sock info) " attach -t " (:session info)))))

;; ---------------------------------------------------------------------------
;; Subcommand: run
;; ---------------------------------------------------------------------------

(defn cmd-run [{:keys [opts]}]
  (let [parsed  (runner/parse-args (:raw-args opts))
        {:keys [window command timeout cd sock session]} parsed]
    (when (or (nil? window) (nil? command))
      (binding [*out* *err*]
        (println "Usage: tmux-agent run <window> <command> [--timeout N] [--cd DIR] [--sock PATH] [--session NAME]"))
      (System/exit 1))

    (let [backend (resolve-backend {:sock sock :session session})]
      ;; Ensure session and window exist
      (preflight/ensure-session! backend {:start-dir (System/getProperty "user.dir")})
      (preflight/ensure-window! backend window)

      ;; Print attach info
      (let [ctx (:ctx backend)]
        (binding [*out* *err*]
          (println (str "Socket: " (:sock ctx)))
          (println (str "Session: " (:session ctx)))
          (println (str "Attach: tmux -S " (:sock ctx) " attach -t " (:session ctx)))))

      ;; Run command
      (let [{:keys [output exit-code]}
            (runner/run-cmd! backend {:window  window
                                      :command command
                                      :timeout (or timeout 300)
                                      :cd      cd})]
        (when (seq output)
          (println output))
        (System/exit exit-code)))))

;; ---------------------------------------------------------------------------
;; Subcommand: status
;; ---------------------------------------------------------------------------

(defn cmd-status [{:keys [opts]}]
  (let [project (or (:project opts) (git-project) "agent")
        cwd     (or (:cwd opts) (System/getProperty "user.dir"))
        info    (mt/derive-session-info project "default")
        sock    (:sock info)
        session (:session info)]
    (println "=== TMUX SESSION STATUS ===")
    (println (str "Project: " project))
    (println (str "Socket:  " sock))
    (println (str "CWD:     " cwd))
    (println)
    (cond
      (not (.exists (java.io.File. sock)))
      (do (println "Status: NO SESSION")
          (println)
          (println (str "To create: tmux-agent create " project " " cwd)))

      (not (mt/tmux? sock "has-session" "-t" session))
      (do (println "Status: SOCKET EXISTS, NO SESSION")
          (println)
          (println (str "To create: tmux-agent create " project " " cwd)))

      :else
      (let [win-indices (-> (mt/tmux! sock "list-windows" "-t" session
                                      "-F" "#{window_index}")
                            str/split-lines)]
        (println "Status: ACTIVE")
        (println)
        (println (str "Attach: tmux -S " sock " attach -t " session))
        (println)
        (println "=== WINDOWS ===")
        (doseq [idx win-indices]
          (let [name (mt/tmux! sock "display-message" "-t" (str session ":" idx)
                               "-p" "#{window_name}")
                cmd  (mt/tmux! sock "display-message" "-t" (str session ":" idx)
                               "-p" "#{pane_current_command}")
                wcwd (mt/tmux! sock "display-message" "-t" (str session ":" idx)
                               "-p" "#{pane_current_path}")]
            (println (str "  " idx ": " name
                          (when-not (shell-cmd? cmd) " [RUNNING]")))
            (println (str "     cmd: " cmd))
            (println (str "     cwd: " wcwd))))
        (println)
        (println "=== QUICK COMMANDS ===")
        (println (str "New window:    tmux -S " sock " new-window -t " session " -n <name>"))
        (println (str "Send command:  tmux -S " sock " send-keys -t " session ":<window> '<cmd>' Enter"))
        (println (str "Capture out:   tmux -S " sock " capture-pane -t " session ":<window> -p -S -20"))
        (println (str "Kill window:   tmux -S " sock " kill-window -t " session ":<window>"))
        (println (str "Kill session:  tmux -S " sock " kill-session -t " session))))))

;; ---------------------------------------------------------------------------
;; Subcommand: wait
;; ---------------------------------------------------------------------------

(defn cmd-wait [{:keys [opts]}]
  (let [project       (or (:project opts) (git-project) "agent")
        window        (or (:window opts) "0")
        capture-lines (or (some-> (:capture-lines opts) parse-long) 0)
        info          (mt/derive-session-info project "default")
        sock          (:sock info)
        session       (:session info)]
    (when-not (mt/tmux? sock "has-session" "-t" session)
      (binding [*out* *err*]
        (println (str "Error: Session '" session "' not found at " sock)))
      (System/exit 1))

    (println (str "Waiting for command to complete in " session ":" window "..."))

    ;; Verify window exists
    (let [win-names (some-> (mt/tmux? sock "list-windows" "-t" session "-F" "#{window_name}")
                            str/split-lines set)
          win-indices (some-> (mt/tmux? sock "list-windows" "-t" session "-F" "#{window_index}")
                              str/split-lines set)]
      (when-not (or (contains? win-names window) (contains? win-indices window))
        (binding [*out* *err*]
          (println (str "Error: Window '" window "' not found in session '" session "'")))
        (System/exit 1)))

    (loop []
      (let [cmd (mt/tmux! sock "display-message" "-t" (str session ":" window)
                          "-p" "#{pane_current_command}")]
        (if (shell-cmd? cmd)
          :done
          (do (Thread/sleep 1000) (recur)))))

    (println (str "Command finished in " session ":" window))

    (when (pos? capture-lines)
      (println)
      (println (str "=== OUTPUT (last " capture-lines " lines) ==="))
      (println (mt/tmux! sock "capture-pane" "-t" (str session ":" window)
                         "-p" "-S" (str "-" capture-lines))))))

;; ---------------------------------------------------------------------------
;; Help
;; ---------------------------------------------------------------------------

(defn cmd-help [_]
  (println "Usage: tmux-agent <command> [options]")
  (println)
  (println "Commands:")
  (println "  create  [PROJECT] [CWD]        Create a tmux session")
  (println "  run     <window> <command>      Run command in tmux, return output")
  (println "  status  [PROJECT] [CWD]        Print session status")
  (println "  wait    [PROJECT] [WINDOW] [N]  Wait for command to finish")
  (println)
  (println "Options for run:")
  (println "  --timeout N        Timeout in seconds (default: 300)")
  (println "  --cd DIR           cd before running")
  (println "  --sock PATH        Use existing socket")
  (println "  --session NAME     Use existing session"))

;; ---------------------------------------------------------------------------
;; Dispatch
;; ---------------------------------------------------------------------------

(def dispatch-table
  [{:cmds ["create"] :fn cmd-create
    :spec {:project {:coerce :string} :cwd {:coerce :string}}
    :args->opts [:project :cwd]}
   {:cmds ["run"] :fn cmd-run}
   {:cmds ["status"] :fn cmd-status
    :spec {:project {:coerce :string} :cwd {:coerce :string}}
    :args->opts [:project :cwd]}
   {:cmds ["wait"] :fn cmd-wait
    :spec {:project {:coerce :string} :window {:coerce :string}
           :capture-lines {:coerce :string}}
    :args->opts [:project :window :capture-lines]}
   {:cmds [] :fn cmd-help}])

(defn -main [& args]
  (let [cmds (take-while #(not (str/starts-with? % "-")) args)
        first-cmd (first cmds)]
    (if (= "run" first-cmd)
      (cmd-run {:opts {:raw-args (vec (rest args))}})
      (cli/dispatch dispatch-table args))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
