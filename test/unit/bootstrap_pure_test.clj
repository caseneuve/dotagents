#!/usr/bin/env bb

(ns unit.bootstrap-pure-test
  (:require [bootstrap :as sut]
            [babashka.fs]
            [clojure.string]
            [clojure.test :as t :refer [deftest is testing]]))

(deftest replace-home-test
  (testing "replaces $HOME recursively in nested data"
    (is (= {:cmd "/tmp/home/bin/run"
            :nested ["/tmp/home/a" {:path "/tmp/home/b"}]
            :untouched 1}
           (sut/replace-home {:cmd "$HOME/bin/run"
                              :nested ["$HOME/a" {:path "$HOME/b"}]
                              :untouched 1}
                             "/tmp/home")))))

(deftest merge-distinct-vec-test
  (testing "deduplicates while preserving order"
    (is (= ["a" "b" "c"]
           (sut/merge-distinct-vec ["a" "b"] ["b" "c"]))))
  (testing "handles nil inputs"
    (is (= [] (sut/merge-distinct-vec nil nil)))
    (is (= ["a"] (sut/merge-distinct-vec nil ["a"])))
    (is (= ["a"] (sut/merge-distinct-vec ["a"] nil)))))

(deftest merge-permission-allows-test
  (testing "reuses generic distinct merge semantics"
    (is (= ["a" "b" "c"]
           (sut/merge-permission-allows ["a" "b"] ["b" "c"])))))

(deftest merge-pi-settings-test
  (let [base {:theme "dark"
              :extensions ["/existing/ext"]
              :custom {:nested true}}
        merged (sut/merge-pi-settings base {:extensions ["/existing/ext" "/repo/pi/extensions"]
                                            :themes ["/repo/pi/themes"]
                                            :theme "modus-operandi"})]
    (testing "preserves unrelated base settings"
      (is (= {:nested true} (:custom merged))))

    (testing "merges extension and theme search paths"
      (is (= ["/existing/ext" "/repo/pi/extensions"]
             (:extensions merged)))
      (is (= ["/repo/pi/themes"]
             (:themes merged))))

    (testing "sets the configured Pi theme"
      (is (= "modus-operandi" (:theme merged))))))

(deftest merge-claude-settings-test
  (let [base {:model "keep-me"
              :permissions {:allow ["Bash(/tmp/existing:*)"
                                    "Bash(/tmp/home/.claude/skills/pk-tmux/tmux-run.sh:*)"]}
              :custom {:nested true}}
        hooks {:hooks {:PostToolUse [{:hooks [{:command "$HOME/.claude/hooks/smart-lint.sh"}]}]}}
        perms {:permissions {:allow ["Bash($HOME/.claude/skills/pk-tmux/tmux-run.sh:*)"
                                     "Bash($HOME/.claude/skills/pk-tmux/tmux-status.sh:*)"]}}
        merged (sut/merge-claude-settings base hooks perms "/tmp/home")]
    (testing "preserves unrelated base settings"
      (is (= "keep-me" (:model merged)))
      (is (= {:nested true} (:custom merged))))

    (testing "adds hooks and expands $HOME"
      (is (= "/tmp/home/.claude/hooks/smart-lint.sh"
             (get-in merged [:hooks :PostToolUse 0 :hooks 0 :command]))))

    (testing "merges permission allows with expansion and dedupe"
      (is (= ["Bash(/tmp/existing:*)"
              "Bash(/tmp/home/.claude/skills/pk-tmux/tmux-run.sh:*)"
              "Bash(/tmp/home/.claude/skills/pk-tmux/tmux-status.sh:*)"]
             (get-in merged [:permissions :allow]))))))

(deftest plan-agents-includes-darwin-skills-on-mac
  (testing "plan-agents includes shared/darwin/skills when darwin? is true and dir exists"
    (let [p {:agents-src "/repo/agents"
             :agents-dst "/home/.agents"
             :codex-dst "/home/.codex"
             :shared-src "/repo/shared"}
          ops (with-redefs [sut/darwin? (constantly true)
                            babashka.fs/directory? (fn [path]
                                                    (= (str path) "/repo/shared/darwin/skills"))
                            sut/skill-ops (fn [{:keys [src]}]
                                           (when (= src "/repo/shared/darwin/skills")
                                             [{:op :link :source (str src "/cmux-comms/SKILL.md")
                                               :target "/home/.agents/skills/cmux-comms/SKILL.md"
                                               :label "cmux-comms/SKILL.md"}]))]
                (sut/plan-agents p))
          darwin-ops (filter #(and (= (:op %) :link)
                                  (some-> (:label %) (clojure.string/includes? "cmux-comms")))
                             ops)]
      (is (= 1 (count darwin-ops))
          "should include one darwin skill op")
      (is (= "cmux-comms/SKILL.md" (:label (first darwin-ops))))))

  (testing "plan-agents omits darwin skills when not on darwin"
    (let [p {:agents-src "/repo/agents"
             :agents-dst "/home/.agents"
             :codex-dst "/home/.codex"
             :shared-src "/repo/shared"}
          ops (with-redefs [sut/darwin? (constantly false)
                            sut/skill-ops (fn [_] [])]
                (sut/plan-agents p))
          darwin-ops (filter #(and (= (:op %) :link)
                                  (some-> (:label %) (clojure.string/includes? "cmux-comms")))
                             ops)]
      (is (zero? (count darwin-ops))
          "should not include darwin skills on non-darwin"))))

(deftest plan-pi-includes-darwin-extensions-on-mac
  (testing "plan-pi includes darwin/extensions dir when darwin? is true and dir exists"
    (let [p {:pi-src "/repo/pi"
             :pi-dst "/home/.pi/agent"}
          ops (with-redefs [sut/darwin? (constantly true)
                            babashka.fs/directory? (constantly true)]
                (sut/plan-pi p))
          settings-op (first (filter #(= (:op %) :merge-pi-settings) ops))]
      (is (= ["/repo/pi/extensions" "/repo/pi/darwin/extensions"]
             (:extensions settings-op)))))

  (testing "plan-pi omits darwin/extensions when not on darwin"
    (let [p {:pi-src "/repo/pi"
             :pi-dst "/home/.pi/agent"}
          ops (with-redefs [sut/darwin? (constantly false)]
                (sut/plan-pi p))
          settings-op (first (filter #(= (:op %) :merge-pi-settings) ops))]
      (is (= ["/repo/pi/extensions"]
             (:extensions settings-op))))))

(deftest bin-ops-test
  (testing "produces symlink ops for CLI tools"
    (let [ops (sut/bin-ops "/repo/shared" "/home/user")]
      (is (= 2 (count ops)))
      (is (every? #(= :link (:op %)) ops))
      (is (some #(clojure.string/ends-with? (:target %) ".local/bin/sandbox") ops))
      (is (some #(clojure.string/ends-with? (:target %) ".local/bin/todo") ops))
      (is (some #(clojure.string/ends-with? (:source %) "sandbox/src/sandbox/cli.clj") ops))
      (is (some #(clojure.string/ends-with? (:source %) "add-todo/src/todo/cli.clj") ops)))))

(deftest plan-agents-includes-bin-ops
  (testing "plan-agents includes ~/.local/bin CLI links"
    (let [p {:agents-src "/repo/agents"
             :agents-dst "/home/.agents"
             :codex-dst "/home/.codex"
             :shared-src "/repo/shared"
             :home "/home"}
          ops (with-redefs [sut/darwin? (constantly false)
                            sut/skill-ops (fn [_] [])]
                (sut/plan-agents p))
          bin-links (filter #(and (= (:op %) :link)
                                 (some-> (:label %) (clojure.string/includes? "local/bin")))
                            ops)]
      (is (= 2 (count bin-links)))
      (is (some #(= "~/.local/bin/sandbox" (:label %)) bin-links))
      (is (some #(= "~/.local/bin/todo" (:label %)) bin-links)))))

(deftest plan-pi-excludes-bin-ops
  (testing "plan-pi does not include ~/.local/bin/ links"
    (let [p {:pi-src "/repo/pi"
             :pi-dst "/home/.pi/agent"
             :home "/home"}
          ops (with-redefs [sut/darwin? (constantly false)]
                (sut/plan-pi p))
          bin-links (filter #(and (= (:op %) :link)
                                 (some-> (:label %) (clojure.string/includes? "local/bin")))
                            ops)]
      (is (zero? (count bin-links))
          "pi bootstrap should not install CLI binaries"))))

(defn -main [& _]
  (let [{:keys [fail error]} (t/run-tests 'unit.bootstrap-pure-test)]
    (System/exit (if (zero? (+ fail error)) 0 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
