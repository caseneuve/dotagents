(ns tmux-agent.core-test
  (:require [tmux-agent.core :as sut]
            [clojure.test :refer [deftest is testing]]))

;; ---------------------------------------------------------------------------
;; Hashing
;; ---------------------------------------------------------------------------

(deftest md5-short-test
  (testing "returns 6-char hex string"
    (is (= 6 (count (sut/md5-short "anything"))))
    (is (re-matches #"[0-9a-f]{6}" (sut/md5-short "hello"))))

  (testing "deterministic"
    (is (= (sut/md5-short "test") (sut/md5-short "test"))))

  (testing "known value — echo -n hello | md5sum → 5d41402abc4b2a76b9719d911017c592"
    (is (= "5d4140" (sut/md5-short "hello"))))

  (testing "different inputs produce different hashes"
    (is (not= (sut/md5-short "main") (sut/md5-short "develop")))))

;; ---------------------------------------------------------------------------
;; Session info derivation
;; ---------------------------------------------------------------------------

(deftest derive-session-info-test
  (testing "computes socket path and session name"
    (let [info (sut/derive-session-info {:project "myapp"
                                         :branch "feature-x"
                                         :prefix "agents"})]
      (is (= "myapp" (:project info)))
      (is (= "feature-x" (:branch info)))
      (is (= 6 (count (:hash info))))
      (is (= (str "/tmp/agents-myapp-" (:hash info) ".sock") (:sock info)))
      (is (= (str "myapp-" (:hash info)) (:session info)))))

  (testing "different branches produce different sockets"
    (let [a (sut/derive-session-info {:project "p" :branch "main" :prefix "agents"})
          b (sut/derive-session-info {:project "p" :branch "dev" :prefix "agents"})]
      (is (not= (:sock a) (:sock b)))))

  (testing "same inputs are deterministic"
    (is (= (sut/derive-session-info {:project "x" :branch "y" :prefix "agents"})
           (sut/derive-session-info {:project "x" :branch "y" :prefix "agents"})))))

(deftest derive-simple-session-info-test
  (testing "create-style: socket from prefix + project, session = project"
    (let [info (sut/derive-simple-session-info {:project "myapp"
                                                :prefix "agents"})]
      (is (= "/tmp/agents-myapp.sock" (:sock info)))
      (is (= "myapp" (:session info))))))

;; ---------------------------------------------------------------------------
;; Socket prefix detection
;; ---------------------------------------------------------------------------

(deftest detect-prefix-test
  (testing "uses env var when set"
    (is (= "custom" (sut/detect-prefix {:env-prefix "custom"
                                         :script-path "/some/path"}))))

  (testing "detects claude from script path"
    (is (= "claude" (sut/detect-prefix {:env-prefix nil
                                         :script-path "/home/user/.claude/skills/tmux/run.sh"}))))

  (testing "defaults to agents"
    (is (= "agents" (sut/detect-prefix {:env-prefix nil
                                         :script-path "/home/user/.agents/skills/tmux/run.sh"})))))

;; ---------------------------------------------------------------------------
;; Run: arg parsing
;; ---------------------------------------------------------------------------

(deftest parse-run-args-test
  (testing "positional: window and command"
    (is (= {:window "build" :command "make all" :timeout 300}
           (sut/parse-run-args ["build" "make all"]))))

  (testing "named options"
    (is (= {:window "w" :command "cmd" :timeout 600
            :cd "/tmp" :sock "/tmp/s.sock" :session "s-123"}
           (sut/parse-run-args ["w" "cmd"
                                "--timeout" "600"
                                "--cd" "/tmp"
                                "--sock" "/tmp/s.sock"
                                "--session" "s-123"]))))

  (testing "defaults timeout to 300"
    (is (= 300 (:timeout (sut/parse-run-args ["w" "c"])))))

  (testing "missing command"
    (is (nil? (:command (sut/parse-run-args ["only-window"])))))

  (testing "missing --timeout value falls back to default"
    (is (= 300 (:timeout (sut/parse-run-args ["w" "c" "--timeout"])))))

  (testing "extra positional replaces command"
    (is (= "extra" (:command (sut/parse-run-args ["w" "cmd" "extra"]))))))

;; ---------------------------------------------------------------------------
;; Run: marker generation
;; ---------------------------------------------------------------------------

(deftest make-marker-test
  (testing "produces deterministic string"
    (is (= "TMUXRUN_1000_42_99" (sut/make-marker 1000 42 99))))

  (testing "different inputs differ"
    (is (not= (sut/make-marker 1 2 3) (sut/make-marker 4 5 6)))))

;; ---------------------------------------------------------------------------
;; Run: output extraction
;; ---------------------------------------------------------------------------

(deftest extract-output-test
  (testing "extracts output between markers"
    (let [raw (str "prompt\n"
                   "MK_START\n"
                   "line 1\n"
                   "line 2\n"
                   "MK_END:0\n"
                   "next")]
      (is (= {:output "line 1\nline 2" :exit-code 0}
             (sut/extract-output raw "MK_START" "MK_END")))))

  (testing "non-zero exit code"
    (let [raw "MK_START\nfailed!\nMK_END:1\n"]
      (is (= 1 (:exit-code (sut/extract-output raw "MK_START" "MK_END"))))))

  (testing "empty output (adjacent markers)"
    (let [raw "MK_START\nMK_END:0\n"]
      (is (= {:output "" :exit-code 0}
             (sut/extract-output raw "MK_START" "MK_END")))))

  (testing "nil when start marker missing"
    (is (nil? (sut/extract-output "no markers\nMK_END:0" "MK_START" "MK_END"))))

  (testing "nil when end marker missing"
    (is (nil? (sut/extract-output "MK_START\nstuff" "MK_START" "MK_END"))))

  (testing "uses last occurrence (scrollback)"
    (let [raw (str "MK_START\nold\nMK_END:2\n"
                   "prompt\n"
                   "MK_START\nnew\nMK_END:0\n")]
      (is (= {:output "new" :exit-code 0}
             (sut/extract-output raw "MK_START" "MK_END")))))

  (testing "multi-digit exit codes"
    (let [raw "MK_START\ncrash\nMK_END:124\n"]
      (is (= 124 (:exit-code (sut/extract-output raw "MK_START" "MK_END")))))))

;; ---------------------------------------------------------------------------
;; Status: formatting
;; ---------------------------------------------------------------------------

(deftest format-status-test
  (testing "formats no-session status"
    (let [out (sut/format-status {:project "myapp"
                                  :sock "/tmp/agents-myapp.sock"
                                  :cwd "/home/user/myapp"
                                  :state :no-session})]
      (is (re-find #"NO SESSION" out))
      (is (re-find #"myapp" out))))

  (testing "formats active status with windows"
    (let [out (sut/format-status {:project "myapp"
                                  :sock "/tmp/agents-myapp.sock"
                                  :cwd "/home/user/myapp"
                                  :state :active
                                  :windows [{:index "0" :name "bash"
                                             :cmd "bash" :cwd "/home/user"
                                             :busy? false}
                                            {:index "1" :name "build"
                                             :cmd "make" :cwd "/home/user/myapp"
                                             :busy? true}]})]
      (is (re-find #"ACTIVE" out))
      (is (re-find #"\[RUNNING\]" out)))))

;; ---------------------------------------------------------------------------
;; Create: output formatting
;; ---------------------------------------------------------------------------

(deftest format-create-output-test
  (testing "exists output omits CWD line"
    (let [out (sut/format-create-output {:status :exists
                                         :sock "/tmp/agents-myapp.sock"
                                         :session "myapp"
                                         :cwd "/home/user"})]
      (is (re-find #"already exists" out))
      (is (not (re-find #"CWD:" out)))
      (is (re-find #"Attach:" out))))

  (testing "created output includes CWD line"
    (let [out (sut/format-create-output {:status :created
                                         :sock "/tmp/agents-myapp.sock"
                                         :session "myapp"
                                         :cwd "/home/user"})]
      (is (re-find #"Session created" out))
      (is (re-find #"CWD:" out)))))

;; ---------------------------------------------------------------------------
;; Status: window busy detection
;; ---------------------------------------------------------------------------

(deftest busy?-test
  (testing "shell commands are not busy"
    (doseq [sh ["bash" "zsh" "fish" "sh"]]
      (is (false? (sut/busy? sh)))))

  (testing "non-shell commands are busy"
    (is (true? (sut/busy? "make")))
    (is (true? (sut/busy? "python")))))
