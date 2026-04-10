(ns tmux-agent.core
  "Pure functions for tmux agent session management.
   No side effects — no process execution, no filesystem, no exit.

   Data shapes:

   Session info (derived from project + branch + prefix):
     {:project \"myapp\"
      :branch  \"feature-x\"
      :prefix  \"agents\"
      :hash    \"a1b2c3\"
      :sock    \"/tmp/agents-myapp-a1b2c3.sock\"
      :session \"myapp-a1b2c3\"}

   Simple session info (for create/status, no branch hashing):
     {:project \"myapp\"
      :prefix  \"agents\"
      :sock    \"/tmp/agents-myapp.sock\"
      :session \"myapp\"}

   Window info:
     {:index \"0\" :name \"bash\" :cmd \"bash\" :cwd \"/home/user\" :busy? false}

   Status info:
     {:project \"myapp\" :sock \"...\" :cwd \"...\"
      :state :no-session | :socket-no-session | :active
      :windows [{window-info} ...]}

   Run result:
     {:output \"...\" :exit-code 0}"
  (:require [clojure.string :as str])
  (:import [java.security MessageDigest]))

;; ---------------------------------------------------------------------------
;; Hashing
;; ---------------------------------------------------------------------------

(defn md5-hex
  "Full MD5 hex digest of a string."
  [s]
  (let [digest (MessageDigest/getInstance "MD5")
        bytes  (.digest digest (.getBytes s "UTF-8"))]
    (apply str (map #(format "%02x" %) bytes))))

(defn md5-short
  "First 6 hex chars of MD5 — used for session naming."
  [s]
  (subs (md5-hex s) 0 6))

;; ---------------------------------------------------------------------------
;; Socket prefix detection (pure — takes context map, not env)
;; ---------------------------------------------------------------------------

(defn detect-prefix
  "Determine socket prefix from context.
   Priority: env var > script path heuristic > default."
  [{:keys [env-prefix script-path]}]
  (cond
    (seq env-prefix) env-prefix
    (and script-path
         (or (str/includes? script-path "/.claude/")
             (str/includes? script-path "/claude/"))) "claude"
    :else "agents"))

;; ---------------------------------------------------------------------------
;; Session info derivation
;; ---------------------------------------------------------------------------

(defn derive-session-info
  "Compute socket path and session name from project + branch + prefix.
   Used by run (branch-aware hashing)."
  [{:keys [project branch prefix]}]
  (let [hash (md5-short branch)]
    {:project project
     :branch  branch
     :prefix  prefix
     :hash    hash
     :sock    (str "/tmp/" prefix "-" project "-" hash ".sock")
     :session (str project "-" hash)}))

(defn derive-simple-session-info
  "Compute socket and session for create/status (no branch hashing).
   Socket: /tmp/<prefix>-<project>.sock, session: <project>."
  [{:keys [project prefix]}]
  {:project project
   :prefix  prefix
   :sock    (str "/tmp/" prefix "-" project ".sock")
   :session project})

;; ---------------------------------------------------------------------------
;; Run: arg parsing
;; ---------------------------------------------------------------------------

(defn parse-run-args
  "Parse CLI arguments for the run subcommand.
   Positional: <window> <command>. Named: --timeout, --cd, --sock, --session."
  [args]
  (loop [args (seq args)
         opts {:timeout 300}]
    (if-not args
      opts
      (let [[head & tail] args]
        (case head
          "--timeout" (recur (next tail) (assoc opts :timeout (parse-long (first tail))))
          "--cd"      (recur (next tail) (assoc opts :cd (first tail)))
          "--sock"    (recur (next tail) (assoc opts :sock (first tail)))
          "--session" (recur (next tail) (assoc opts :session (first tail)))
          (if-not (:window opts)
            (recur tail (assoc opts :window head))
            (recur tail (assoc opts :command head))))))))

;; ---------------------------------------------------------------------------
;; Run: marker generation
;; ---------------------------------------------------------------------------

(defn make-marker
  "Generate a unique marker prefix from timestamp, random, and pid values."
  [ts rand-val pid]
  (str "TMUXRUN_" ts "_" rand-val "_" pid))

;; ---------------------------------------------------------------------------
;; Run: output extraction
;; ---------------------------------------------------------------------------

(defn extract-output
  "Extract command output and exit code from raw pane capture.
   Looks for start/end markers. Uses last occurrence (handles scrollback).
   Returns {:output string, :exit-code int} or nil."
  [raw start-marker end-marker]
  (let [lines   (str/split-lines raw)
        indexed (map-indexed vector lines)
        start-idx (->> indexed
                       (filter #(= (second %) start-marker))
                       last first)
        end-entry (->> indexed
                       (filter #(str/starts-with? (second %) (str end-marker ":")))
                       last)]
    (when (and start-idx end-entry)
      (let [end-idx   (first end-entry)
            end-line  (second end-entry)
            exit-code (some-> (last (str/split end-line #":")) parse-long)
            first-out (inc start-idx)
            last-out  end-idx]
        {:output    (if (< first-out last-out)
                      (str/join "\n" (subvec (vec lines) first-out last-out))
                      "")
         :exit-code (or exit-code 0)}))))

;; ---------------------------------------------------------------------------
;; Status: window busy detection
;; ---------------------------------------------------------------------------

(def ^:private shell-commands #{"bash" "zsh" "fish" "sh"})

(defn busy?
  "True if the pane command is not a shell prompt."
  [cmd]
  (not (contains? shell-commands cmd)))

;; ---------------------------------------------------------------------------
;; Status: formatting
;; ---------------------------------------------------------------------------

(defn format-status
  "Format session status as a human-readable string.
   Input: {:project :sock :cwd :state :windows}"
  [{:keys [project sock cwd state windows]}]
  (let [lines (transient [])]
    (conj! lines "=== TMUX SESSION STATUS ===")
    (conj! lines (str "Project: " project))
    (conj! lines (str "Socket:  " sock))
    (conj! lines (str "CWD:     " cwd))
    (conj! lines "")

    (case state
      :no-session
      (do (conj! lines "Status: NO SESSION")
          (conj! lines "")
          (conj! lines "To create:")
          (conj! lines (str "  tmux -S " sock " new-session -d -s " project " -c " cwd)))

      :socket-no-session
      (do (conj! lines "Status: SOCKET EXISTS, NO SESSION")
          (conj! lines "")
          (conj! lines "To create:")
          (conj! lines (str "  tmux -S " sock " new-session -d -s " project " -c " cwd)))

      :active
      (do (conj! lines "Status: ACTIVE")
          (conj! lines "")
          (conj! lines "To attach:")
          (conj! lines (str "  tmux -S " sock " attach -t " project))
          (conj! lines "")
          (conj! lines "=== WINDOWS ===")
          (doseq [{:keys [index name cmd cwd busy?]} windows]
            (conj! lines (str "  " index ": " name (when busy? " [RUNNING]")))
            (conj! lines (str "     cmd: " cmd))
            (conj! lines (str "     cwd: " cwd)))
          (conj! lines "")
          (conj! lines "=== QUICK COMMANDS ===")
          (conj! lines (str "New window:    tmux -S " sock " new-window -t " project " -n <name> -c " cwd))
          (conj! lines (str "Send command:  tmux -S " sock " send-keys -t " project ":<window> '<cmd>' Enter"))
          (conj! lines (str "Capture out:   tmux -S " sock " capture-pane -t " project ":<window> -p -S -20"))
          (conj! lines (str "Kill window:   tmux -S " sock " kill-window -t " project ":<window>"))
          (conj! lines (str "Kill session:  tmux -S " sock " kill-session -t " project))))

    (str/join "\n" (persistent! lines))))

;; ---------------------------------------------------------------------------
;; Create: output formatting
;; ---------------------------------------------------------------------------

(defn format-create-output
  "Format create subcommand output.
   Input: {:status :created|:exists, :sock, :session, :project, :cwd}"
  [{:keys [status sock session project cwd]}]
  (str/join "\n"
    (concat
      [(if (= status :exists) "Session already exists" "Session created")
       (str "Socket:  " sock)
       (str "Session: " session)]
      (when (= status :created)
        [(str "CWD:     " cwd)])
      [(str "Attach:  tmux -S " sock " attach -t " session)])))
