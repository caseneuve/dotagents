#!/usr/bin/env bb

(ns unit.bootstrap-pure-test
  (:require [bootstrap :as sut]
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

(deftest merge-permission-allows-test
  (testing "deduplicates while preserving order"
    (is (= ["a" "b" "c"]
           (sut/merge-permission-allows ["a" "b"] ["b" "c"]))))
  (testing "handles nil inputs"
    (is (= [] (sut/merge-permission-allows nil nil)))
    (is (= ["a"] (sut/merge-permission-allows nil ["a"])))
    (is (= ["a"] (sut/merge-permission-allows ["a"] nil)))))

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

(defn -main [& _]
  (let [{:keys [fail error]} (t/run-tests 'unit.bootstrap-pure-test)]
    (System/exit (if (zero? (+ fail error)) 0 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
