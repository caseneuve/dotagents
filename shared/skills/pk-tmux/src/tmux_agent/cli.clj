#!/usr/bin/env bb

(ns tmux-agent.cli
  "CLI entry point for tmux agent session management.
   Dispatches subcommands: create, run, status, wait.

   Usage:
     tmux-agent create [PROJECT] [CWD]
     tmux-agent run <window> <command> [--timeout N] [--cd DIR] [--sock PATH] [--session NAME]
     tmux-agent status [PROJECT] [CWD]
     tmux-agent wait [PROJECT] [WINDOW] [CAPTURE-LINES]"
  (:require [babashka.cli :as cli]
            [babashka.process :as p]
            [clojure.string :as str]
            [tmux-agent.core :as core]))

;; ---------------------------------------------------------------------------
;; I/O helpers
;; ---------------------------------------------------------------------------

(defn- sh
  "Run command, return trimmed stdout. Throws on non-zero exit."
  [& args]
  (let [result (apply p/sh args)]
    (when-not (zero? (:exit result))
      (throw (ex-info (str "Command failed: " (str/join " " args))
                      {:exit (:exit result) :err (:err result)})))
    (str/trim (:out result))))

(defn- sh?
  "Run command, return trimmed stdout or nil on failure."
  [& args]
  (try (apply sh args) (catch Exception _ nil)))

(defn- tmux!
  "Run tmux command on given socket."
  [sock & args]
  (apply sh "tmux" "-S" sock args))

(defn- tmux?
  "Run tmux command, nil on failure."
  [sock & args]
  (try (apply tmux! sock args) (catch Exception _ nil)))

(defn- git-project []
  (some-> (sh? "git" "rev-parse" "--show-toplevel")
          (str/split #"/") last))

(defn- git-branch []
  (or (sh? "git" "rev-parse" "--abbrev-ref" "HEAD") "default"))

(defn- resolve-prefix []
  (core/detect-prefix {:env-prefix (System/getenv "TMUX_SOCKET_PREFIX")
                        :script-path (or (System/getProperty "babashka.file") "")}))

;; ---------------------------------------------------------------------------
;; Subcommand: create
;; ---------------------------------------------------------------------------

(defn cmd-create [{:keys [opts]}]
  (let [project (or (:project opts) (git-project) (System/getProperty "user.dir"))
        cwd     (or (:cwd opts) (System/getProperty "user.dir"))
        info    (core/derive-simple-session-info {:project project
                                                  :prefix (resolve-prefix)})
        sock    (:sock info)
        session (:session info)]
    (if (tmux? sock "has-session" "-t" session)
      (println (core/format-create-output
                 (assoc info :status :exists :cwd cwd)))
      (do
        (tmux! sock "new-session" "-d" "-s" session "-c" cwd)
        (println (core/format-create-output
                   (assoc info :status :created :cwd cwd)))))))

;; ---------------------------------------------------------------------------
;; Subcommand: run
;; ---------------------------------------------------------------------------

(defn cmd-run [{:keys [opts]}]
  (let [{:keys [window command timeout cd sock session]}
        (core/parse-run-args (:raw-args opts))]
    (when (or (nil? window) (nil? command))
      (binding [*out* *err*]
        (println "Usage: tmux-agent run <window> <command> [--timeout N] [--cd DIR] [--sock PATH] [--session NAME]"))
      (System/exit 1))

    ;; Resolve session — from opts or auto-derive
    (let [{:keys [sock session]}
          (if (and sock session)
            (do (when-not (try (sh "tmux" "-S" sock "has-session" "-t" session)
                               true (catch Exception _ false))
                  (binding [*out* *err*]
                    (println (str "ERROR: Session '" session "' not found on socket '" sock "'")))
                  (System/exit 1))
                {:sock sock :session session})
            (let [project (or (git-project) "agent")
                  branch  (git-branch)
                  info    (core/derive-session-info {:project project
                                                     :branch branch
                                                     :prefix (resolve-prefix)})]
              ;; Ensure session exists
              (when-not (tmux? (:sock info) "has-session" "-t" (:session info))
                (tmux! (:sock info) "new-session" "-d" "-s" (:session info)
                       "-c" (System/getProperty "user.dir"))
                (binding [*out* *err*]
                  (println (str "Session created: " (:session info)))))
              (select-keys info [:sock :session])))

          target (str session ":" window)]

      (binding [*out* *err*]
        (println (str "Socket: " sock))
        (println (str "Session: " session))
        (println (str "Attach: tmux -S " sock " attach -t " session)))

      ;; Ensure window exists
      (let [windows (some-> (tmux? sock "list-windows" "-t" session "-F" "#W")
                            str/split-lines set)]
        (when-not (contains? windows window)
          (tmux! sock "new-window" "-t" session "-n" window
                 "-c" (System/getProperty "user.dir"))))

      ;; cd if requested
      (when cd
        (tmux! sock "send-keys" "-t" target (str "cd '" cd "'") "Enter")
        (Thread/sleep 300))

      ;; Send command with markers
      (let [marker (core/make-marker (System/currentTimeMillis)
                                     (rand-int 100000)
                                     (rand-int 100000))
            start  (str marker "_START")
            end    (str marker "_END")]
        (tmux! sock "send-keys" "-t" target
               (str "echo " start "; " command "; echo " end ":$?") "Enter")

        ;; Poll for completion
        (loop [elapsed 0]
          (let [pane (tmux! sock "capture-pane" "-t" target "-p" "-S" "-1000")]
            (if (some #(str/starts-with? % (str end ":")) (str/split-lines pane))
              :done
              (if (>= elapsed timeout)
                (do (binding [*out* *err*]
                      (println (str "TIMEOUT: command did not complete within " timeout "s")))
                    (System/exit 124))
                (do (Thread/sleep 2000)
                    (recur (+ elapsed 2)))))))

        (Thread/sleep 200)

        ;; Extract output
        (let [raw    (tmux! sock "capture-pane" "-t" target "-p" "-S" "-1000")
              result (core/extract-output raw start end)]
          (when-not result
            (binding [*out* *err*]
              (println "ERROR: Could not find output markers in pane")
              (println raw))
            (System/exit 1))

          (when (seq (:output result))
            (println (:output result)))
          (System/exit (:exit-code result)))))))

;; ---------------------------------------------------------------------------
;; Subcommand: status
;; ---------------------------------------------------------------------------

(defn cmd-status [{:keys [opts]}]
  (let [project (or (:project opts) (git-project) (System/getProperty "user.dir"))
        cwd     (or (:cwd opts) (System/getProperty "user.dir"))
        info    (core/derive-simple-session-info {:project project
                                                  :prefix (resolve-prefix)})
        sock    (:sock info)]

    (cond
      ;; No socket file at all
      (not (try (.exists (java.io.File. sock)) (catch Exception _ false)))
      (println (core/format-status {:project project :sock sock :cwd cwd
                                    :state :no-session}))

      ;; Socket exists but no session
      (not (tmux? sock "has-session" "-t" project))
      (println (core/format-status {:project project :sock sock :cwd cwd
                                    :state :socket-no-session}))

      ;; Active session — gather window info
      :else
      (let [win-indices (-> (tmux! sock "list-windows" "-t" project "-F" "#{window_index}")
                            str/split-lines)
            windows (mapv (fn [idx]
                            (let [name (tmux! sock "display-message" "-t" (str project ":" idx)
                                              "-p" "#{window_name}")
                                  cmd  (tmux! sock "display-message" "-t" (str project ":" idx)
                                              "-p" "#{pane_current_command}")
                                  wcwd (tmux! sock "display-message" "-t" (str project ":" idx)
                                              "-p" "#{pane_current_path}")]
                              {:index idx :name name :cmd cmd :cwd wcwd
                               :busy? (core/busy? cmd)}))
                          win-indices)]
        (println (core/format-status {:project project :sock sock :cwd cwd
                                      :state :active :windows windows}))))))

;; ---------------------------------------------------------------------------
;; Subcommand: wait
;; ---------------------------------------------------------------------------

(defn cmd-wait [{:keys [opts]}]
  (let [project       (or (:project opts) (git-project) (System/getProperty "user.dir"))
        window        (or (:window opts) "0")
        capture-lines (or (some-> (:capture-lines opts) parse-long) 0)
        info          (core/derive-simple-session-info {:project project
                                                        :prefix (resolve-prefix)})
        sock          (:sock info)]

    ;; Verify session
    (when-not (tmux? sock "has-session" "-t" project)
      (binding [*out* *err*]
        (println (str "Error: Session '" project "' not found at " sock)))
      (System/exit 1))

    ;; Verify window
    (let [win-names (some-> (tmux? sock "list-windows" "-t" project "-F" "#{window_name}")
                            str/split-lines set)
          win-indices (some-> (tmux? sock "list-windows" "-t" project "-F" "#{window_index}")
                              str/split-lines set)]
      (when-not (or (contains? win-names window) (contains? win-indices window))
        (binding [*out* *err*]
          (println (str "Error: Window '" window "' not found in session '" project "'")))
        (System/exit 1)))

    (println (str "Waiting for command to complete in " project ":" window "..."))

    ;; Poll until shell prompt returns
    (loop []
      (let [cmd (tmux! sock "display-message" "-t" (str project ":" window)
                       "-p" "#{pane_current_command}")]
        (if (not (core/busy? cmd))
          :done
          (do (Thread/sleep 1000) (recur)))))

    (println (str "Command finished in " project ":" window))

    ;; Capture output if requested
    (when (pos? capture-lines)
      (println)
      (println (str "=== OUTPUT (last " capture-lines " lines) ==="))
      (println (tmux! sock "capture-pane" "-t" (str project ":" window)
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

;; The run subcommand uses manual arg parsing (core/parse-run-args) because
;; its positional args (window, command) precede named opts. We pass the
;; raw args through.
(defn -main [& args]
  (let [cmds (take-while #(not (str/starts-with? % "-")) args)
        first-cmd (first cmds)]
    (if (= "run" first-cmd)
      ;; Pass everything after "run" to cmd-run via :raw-args
      (cmd-run {:opts {:raw-args (vec (rest args))}})
      (cli/dispatch dispatch-table args))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
