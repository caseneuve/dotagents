#!/usr/bin/env bb

(ns test-clj-callers
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.edn :as edn]
            [clojure.string :as str]
            [clojure.test :as t :refer [deftest is testing]]))

(def repo-root (fs/canonicalize (fs/cwd)))
(def helper-path (fs/path repo-root "shared/skills/callgraph/scripts/clj_callers.clj"))
(def fixture-root (fs/path repo-root "shared/skills/callgraph/test/fixtures/project"))
(def expected-contract-path
  (fs/path repo-root
           "shared/skills/callgraph/test/fixtures/expected/minimal.edn"))
(def expected-populated-contract-path
  (fs/path repo-root
           "shared/skills/callgraph/test/fixtures/expected/populated.edn"))

(def helper-loaded?
  (delay (load-file (str helper-path))))

(defn helper-var [name]
  (force helper-loaded?)
  (ns-resolve 'clj-callers (symbol name)))

(defn call-helper-var [name & args]
  (apply (helper-var name) args))

(defn run-helper-cli [& args]
  (apply process/shell
         {:out :string :err :string :continue true}
         "bb"
         (str helper-path)
         args))

(defn run-helper-at [root & args]
  (apply run-helper-cli "--root" (str root) args))

(defn run-helper [& targets]
  (apply run-helper-at fixture-root targets))

(defn target-report [graph target]
  (some #(when (= target (:target %)) %) (:targets graph)))

(deftest discovery-predicates-and-production-filter-test
  (fs/with-temp-dir [root]
    (doseq [[relative contents]
            [["src/app.clj" "(ns app)\n"]
             ["src/nested/service.bb" "(ns nested.service)\n"]
             ["src/ignored.cljc" "(ns ignored)\n"]
             ["src/ignored.cljs" "(ns ignored-js)\n"]
             ["src/test_service.clj" "(ns test-service)\n"]
             ["src/service_test.bb" "(ns service-test)\n"]
             ["test/unit.clj" "(ns test-unit)\n"]
             ["tests/integration.bb" "(ns tests-integration)\n"]
             ["src/testing/helpers.clj" "(ns testing.helpers)\n"]
             ["src/contest.clj" "(ns contest)\n"]
             [".hidden/secret.clj" "(ns hidden)\n"]]]
      (let [path (fs/path root relative)]
        (fs/create-dirs (fs/parent path))
        (spit (str path) contents)))
    (fs/create-sym-link (fs/path root "src/link.clj")
                        (fs/path root "src/app.clj"))
    (fs/create-sym-link (fs/path root "linked")
                        (fs/path root "src"))
    (is (= ["src/app.clj"
            "src/contest.clj"
            "src/nested/service.bb"
            "src/service_test.bb"
            "src/test_service.clj"
            "src/testing/helpers.clj"
            "test/unit.clj"
            "tests/integration.bb"]
           (mapv :relative (call-helper-var "discover-sources" root false))))
    (is (= ["src/app.clj"
            "src/contest.clj"
            "src/nested/service.bb"
            "src/testing/helpers.clj"]
           (mapv :relative (call-helper-var "discover-sources" root true))))
    (is (call-helper-var "source-path?" "src/example.clj"))
    (is (call-helper-var "source-path?" "src/example.bb"))
    (is (not (call-helper-var "source-path?" "src/example.cljc")))
    (is (call-helper-var "included-source?" "src/example.clj" false))
    (is (not (call-helper-var "included-source?" ".hidden/example.clj" false)))
    (is (not (call-helper-var "included-source?" "tests/example.clj" true)))
    (is (call-helper-var "included-source?" "src/testing/example.clj" true))
    (is (call-helper-var "test-path?" "tests/foo.clj"))
    (is (call-helper-var "test-path?" "src/test_foo.bb"))
    (is (call-helper-var "test-path?" "src/foo_test.clj"))
    (is (not (call-helper-var "test-path?" "src/testing/foo.clj")))
    (is (not (call-helper-var "test-path?" "src/contest.clj")))))

(deftest production-only-cli-excludes-test-callers
  (fs/with-temp-dir [root]
    (doseq [[relative contents]
            [["src/app.clj" "(ns app)\n(defn target [] :ok)\n"]
             ["src/app/caller.clj"
              "(ns app.caller (:require [app :as app]))\n(defn call [] (app/target))\n"]
             ["tests/app/tests.clj"
              "(ns app.tests (:require [app :as app]))\n(defn call [] (app/target))\n"]]]
      (let [path (fs/path root relative)]
        (fs/create-dirs (fs/parent path))
        (spit (str path) contents)))
    (let [default (run-helper-at root "app/target")
          production (run-helper-at root "--production-only" "app/target")
          default-callers (set (map :caller
                                    (:direct-callers
                                     (target-report
                                      (edn/read-string (:out default))
                                      "app/target"))))
          production-callers (set (map :caller
                                        (:direct-callers
                                         (target-report
                                          (edn/read-string (:out production))
                                          "app/target"))))]
      (is (zero? (:exit default)) (:err default))
      (is (zero? (:exit production)) (:err production))
      (is (= #{"app.caller/call" "app.tests/call"} default-callers))
      (is (= #{"app.caller/call"} production-callers)))))

(deftest usage-classification-follows-precedence
  (let [unknown {:to "clj-kondo/unknown-namespace" :name "missing"}
        resolved {:to "demo.core" :name "target"}]
    (doseq [[usage expected]
            [[(assoc unknown :refer true :arity 1) :refer]
             [(assoc unknown :defmethod true :arity 1) :defmethod]
             [(assoc unknown :macro true :arity 1) :macro-boundary]
             [(assoc unknown :arity 1) :unresolved-invocation]
             [(dissoc (assoc unknown :arity 1) :to) :ignored]
             [(dissoc (assoc unknown :arity 1) :name) :ignored]
             [unknown :ignored]
             [(assoc resolved :arity 1) :direct-invocation]
             [resolved :reference]]]
      (is (= expected (call-helper-var "classify-usage" usage))))))

(deftest evidence-classification-separates-calls-references-and-macros
  (let [result (run-helper "demo.targets/outgoing-target"
                           "demo.targets/direct-target"
                           "demo.targets/macro-target"
                           "demo.lib/refer-target")
        graph (edn/read-string (:out result))
        outgoing (target-report graph "demo.targets/outgoing-target")
        direct (target-report graph "demo.targets/direct-target")
        macro (target-report graph "demo.targets/macro-target")
        refer (target-report graph "demo.lib/refer-target")
        callee-ids (set (map :callee (:direct-callees outgoing)))
        incoming-reference-sites (get-in direct [:references :incoming])
        reference-sites (set (map (comp :row :site)
                                  (get-in outgoing [:references :outgoing])))
        macro-ids (set (map :macro
                             (get-in outgoing [:macro-boundaries :outgoing])))
        unattributed-sites (set (map (comp :row :site)
                                     (:unattributed-invocations direct)))]
    (is (zero? (:exit result)) (:err result))
    (is (contains? callee-ids "demo.lib/qualified-target"))
    (is (contains? callee-ids "demo.lib/refer-target"))
    (is (contains? callee-ids "clojure.core/apply"))
    (is (= #{23 24 25} reference-sites))
    (is (= #{23 24 25}
           (set (map (comp :row :site) incoming-reference-sites))))
    (is (every? #(= "demo.targets/outgoing-target" (:owner %))
                incoming-reference-sites))
    (is (= #{"clojure.core/->" "demo.targets/macro-target"} macro-ids))
    (is (= #{9 35 39} unattributed-sites))
    (is (= #{"demo.targets/outgoing-target" "demo.caller/direct-caller"}
           (set (map :caller (:direct-callers direct)))))
    (is (= #{"demo.targets/outgoing-target"}
           (set (map :caller (:direct-callers refer)))))
    (is (= "demo.targets/outgoing-target"
           (-> macro :macro-boundaries :incoming first :owner)))
    (is (nil? (get-in refer [:references :incoming])))))

(deftest dispatch-evidence-separates-sites-and-candidates
  (let [result (run-helper "demo.targets/outgoing-target"
                           "demo.targets/multi-target"
                           "demo.targets/protocol-target")
        graph (edn/read-string (:out result))
        outgoing (target-report graph "demo.targets/outgoing-target")
        multimethod (target-report graph "demo.targets/multi-target")
        protocol (target-report graph "demo.targets/protocol-target")]
    (is (zero? (:exit result)) (:err result))
    (is (nil? (:direct-callers multimethod)))
    (is (= #{"demo.targets/multi-target" "demo.targets/protocol-target"}
           (set (map :var (get-in outgoing [:dispatch :outgoing])))))
    (is (some #(= "demo.targets/outgoing-target" (:owner %))
              (-> multimethod :dispatch :sites)))
    (is (= {:kind :multimethod-method
            :target "demo.targets/multi-target"
            :implementation-namespace "demo.targets"
            :defined-by "clojure.core/defmethod"
            :dispatch-value ":a"}
           (dissoc (-> multimethod :dispatch :candidates first)
                   :location)))
    (is (= {:kind :protocol-implementation
            :target "demo.targets/protocol-target"
            :implementation-namespace "demo.targets"
            :defined-by "clojure.core/extend-type"
            :dispatch-value nil}
           (dissoc (-> protocol :dispatch :candidates first)
                   :location)))))

(deftest definition-kinds-and-dispatch-classification
  (doseq [[definition expected]
          [[{:defined-by "clojure.core/defmacro"} :macro]
           [{:defined-by "clojure.core/defmulti"} :multimethod]
           [{:defined-by "clojure.core/defn"} :function]
           [{:defined-by "clojure.core/defn-"} :function]
           [{:defined-by "custom/def"} :var]
           [{:protocol-name "P" :defined-by "custom/defprotocol"}
            :protocol-function]
           [{} :unknown]]]
    (is (= expected (call-helper-var "definition-kind" definition))))
  (let [usage {:to "app.core" :name "target" :arity 1}]
    (is (= :direct-invocation
           (call-helper-var "classify-usage" usage #{})))
    (is (= :dispatch
           (call-helper-var "classify-usage" usage #{"app.core/target"})))))

(deftest dispatch-candidates-require-local-definition-kind
  (let [root (fs/path "/repo")
        location {:filename "/repo/src/app/core.clj" :row 2 :col 1}
        multimethod (merge location
                           {:ns "app.core"
                            :name "multi"
                            :defined-by "clojure.core/defmulti"})
        protocol-function (merge location
                                 {:ns "app.core"
                                  :name "proto"
                                  :protocol-name "P"
                                  :defined-by "clojure.core/defprotocol"})
        function (merge location
                        {:ns "app.core"
                         :name "plain"
                         :defined-by "clojure.core/defn"})
        method-usage (merge location
                            {:to "app.core"
                             :name "multi"
                             :from "impl.ns"
                             :defmethod true
                             :dispatch-val-str ":x"})
        protocol-impl (merge location
                             {:protocol-ns "app.core"
                              :method-name "proto"
                              :impl-ns "impl.ns"
                              :defined-by "clojure.core/extend-type"})
        malformed-protocol-impl (dissoc protocol-impl :defined-by)
        report (fn [target definition usages impls]
                 (call-helper-var "target-report"
                                  root target [definition] usages impls
                                  #{target}))]
    (is (= :multimethod-method
           (-> (report "app.core/multi" multimethod [method-usage] [])
               :dispatch :candidates first :kind)))
    (is (= :protocol-implementation
           (-> (report "app.core/proto" protocol-function [] [protocol-impl])
               :dispatch :candidates first :kind)))
    (is (nil? (:dispatch (report "app.core/plain" function
                                 [method-usage] [protocol-impl]))))
    (is (nil? (:dispatch (report "app.core/proto" protocol-function
                                 [] [malformed-protocol-impl]))))
    (doseq [[target usage impl]
            [["dep.core/multi"
              (merge location {:to "dep.core" :name "multi"
                               :from "app.core" :from-var "caller"
                               :arity 1})
              (merge protocol-impl {:protocol-ns "dep.core"
                                    :method-name "multi"})]
             ["dep.core/proto"
              (merge location {:to "dep.core" :name "proto"
                               :from "app.core" :from-var "caller"
                               :arity 1})
              (merge protocol-impl {:protocol-ns "dep.core"
                                    :method-name "proto"})]]]
      (let [report (call-helper-var "target-report" root target []
                                    [usage] [impl] #{})]
        (is (nil? (:dispatch report)))
        (is (= #{"app.core/caller"}
               (set (map :caller (:direct-callers report)))))))))

(deftest duplicate-local-definitions-make-target-partial
  (fs/with-temp-dir [root]
    (let [source (fs/path root "src/app/core.clj")]
      (fs/create-dirs (fs/parent source))
      (spit (str source)
            "(ns app.core)\n(defn target [] 1)\n(defn target [] 2)\n")
      (let [result (run-helper-at root "app.core/target")
            target (target-report (edn/read-string (:out result))
                                  "app.core/target")]
        (is (= 1 (:exit result)))
        (is (= :partial (:status target)))
        (is (= 2 (count (:definitions target))))
        (is (= :duplicate-definition
               (-> target :gaps first :kind)))))))

(deftest analyzer-gap-reduction-distinguishes-soundness-failures
  (let [root (fs/path "/repo")
        syntax {:type "syntax"
                :filename "/repo/src/app/core.clj"
                :row 2
                :col 1
                :message "missing closing delimiter"}
        ordinary {:type "unresolved-symbol"
                  :level "error"
                  :filename "/repo/src/app/core.clj"
                  :row 2
                  :col 1
                  :message "ordinary lint finding"}
        gaps (fn [result]
               (call-helper-var "analyzer-gaps" root result))]
    (is (= [:analyzer-error]
           (mapv :kind (gaps {:exit 3
                              :findings [syntax]
                              :summary {:files 1}
                              :source-count 1
                              :stderr ""}))))
    (is (= "src/app/core.clj"
           (-> (gaps {:exit 3
                      :findings [syntax]
                      :summary {:files 1}
                      :source-count 1
                      :stderr ""}) first :location :file)))
    (is (empty? (gaps {:exit 3
                       :findings [ordinary]
                       :summary {:files 1}
                       :source-count 1
                       :stderr ""})))
    (is (= [:analyzer-nonzero]
           (mapv :kind (gaps {:exit 3
                              :findings []
                              :summary {:files 1}
                              :source-count 1
                              :stderr ""}))))
    (is (= [:analyzer-nonzero]
           (mapv :kind (gaps {:exit 3
                              :findings [{:type "unused-value"
                                          :level "warning"}]
                              :summary {:files 1}
                              :source-count 1
                              :stderr ""}))))
    (is (empty? (gaps {:exit 3
                       :findings [{:type "unresolved-symbol"
                                   :level "error"}]
                       :summary {:files 1}
                       :source-count 1
                       :stderr ""})))
    (is (= [:analyzer-error]
           (mapv :kind (gaps {:exit 0
                              :findings []
                              :summary {:files 0}
                              :source-count 1
                              :stderr ""}))))
    (is (= [:analyzer-error]
           (mapv :kind (gaps {:exit 0
                              :findings []
                              :summary {:files 1}
                              :source-count 1
                              :stderr "error while reading .clj-kondo/config.edn"}))))
    (is (= "clj-kondo syntax: failed at ./src/app/core.clj"
           (:message (call-helper-var
                      "analyzer-finding-gap"
                      (fs/path "/repo")
                      {:type "syntax"
                       :filename "/repo/src/app/core.clj"
                       :message "failed at /repo/src/app/core.clj"}))))))

(deftest target-gaps-are-sorted-after-concatenation
  (let [root (fs/path "/repo")
        definition (fn [file row]
                     {:ns "app.core"
                      :name "target"
                      :defined-by "clojure.core/defn"
                      :filename (str "/repo/" file)
                      :row row
                      :col 1})
        report (call-helper-var
                "target-report"
                root
                "app.core/target"
                [(definition "z.clj" 3)
                 (definition "a.clj" 2)
                 (definition "m.clj" 1)]
                []
                []
                #{} )]
    (is (= ["m.clj" "z.clj"]
           (mapv (comp :file :location) (-> report :gaps))))))

(deftest unresolved-owned-invocation-is-a-target-gap
  (fs/with-temp-dir [root]
    (let [source (fs/path root "src/app/core.clj")]
      (fs/create-dirs (fs/parent source))
      (spit (str source)
            "(ns app.core)\n(defn target [] (missing 1))\n")
      (let [result (run-helper-at root "app.core/target")
            graph (edn/read-string (:out result))
            target (target-report graph "app.core/target")]
        (is (= 1 (:exit result)))
        (is (= :partial (:status target)))
        (is (= :unresolved-invocation
               (-> target :gaps first :kind)))
        (is (re-find #"unresolved invocation of missing"
                     (-> target :gaps first :message)))))))

(deftest malformed-analyzer-output-is-fatal
  (is (thrown? clojure.lang.ExceptionInfo
               (call-helper-var "parse-analysis"
                                {:out "not-json"
                                 :exit 0
                                 :err ""})))
  (is (thrown? clojure.lang.ExceptionInfo
               (call-helper-var "parse-analysis"
                                {:out "{\"analysis\":{\"var-usages\":[]}}"
                                 :exit 0
                                 :err ""}))))

(deftest analyzer-backed-failure-status-and-exit-contract
  (fs/with-temp-dir [root]
    (let [syntax-source (fs/path root "src/syntax/core.clj")]
      (fs/create-dirs (fs/parent syntax-source))
      (spit (str syntax-source)
            "(ns app.syntax)\n(defn target [] 1\n")
      (let [result (run-helper-at root "app.syntax/target")
            graph (edn/read-string (:out result))]
        (is (= 1 (:exit result)))
        (is (= :partial (:status graph)))
        (is (= #{:analyzer-error}
               (set (map :kind (:gaps graph)))))
        (is (not-any? #(= :analyzer-nonzero (:kind %)) (:gaps graph)))))
    (fs/delete-tree (fs/path root "src/syntax"))
    (let [ordinary-source (fs/path root "src/ordinary/core.clj")]
      (fs/create-dirs (fs/parent ordinary-source))
      (spit (str ordinary-source)
            "(ns app.ordinary)\n(defn target [] 1)\n(unknown 1)\n")
      (let [result (run-helper-at root "app.ordinary/target")
            graph (edn/read-string (:out result))]
        (is (= 0 (:exit result)))
        (is (= :ok (:status graph)))
        (is (nil? (:gaps graph)))))))

(deftest analyzer-backed-invalid-config-is-global-gap
  (fs/with-temp-dir [root]
    (let [source (fs/path root "src/app/config.clj")
          config (fs/path root ".clj-kondo/config.edn")]
      (fs/create-dirs (fs/parent source))
      (fs/create-dirs (fs/parent config))
      (spit (str source)
            "(ns app.config)\n(defn target [] 1)\n")
      (spit (str config) "{:lint-as {broken}}\n")
      (let [result (run-helper-at root "app.config/target")
            graph (edn/read-string (:out result))]
        (is (= 1 (:exit result)))
        (is (= :partial (:status graph)))
        (is (= #{:analyzer-error}
               (set (map :kind (:gaps graph)))))
        (is (not-any? #(= :analyzer-nonzero (:kind %)) (:gaps graph)))))))

(deftest analyzer-backed-failing-hook-is-global-gap
  (fs/with-temp-dir [root]
    (let [source (fs/path root "src/app/hook.clj")
          config (fs/path root ".clj-kondo/config.edn")
          hook (fs/path root ".clj-kondo/hooks/failing.clj")]
      (fs/create-dirs (fs/parent source))
      (fs/create-dirs (fs/parent hook))
      (spit (str source)
            "(ns app.hook)\n(defn trigger [x] x)\n(defn target [] (trigger 1))\n")
      (spit (str config)
            "{:hooks {:analyze-call {app.hook/trigger hooks.failing/fail}}}\n")
      (spit (str hook)
            "(ns hooks.failing)\n(defn fail [_] (throw (ex-info \"hook boom\" {})))\n")
      (let [result (run-helper-at root "app.hook/target")
            graph (edn/read-string (:out result))
            target (target-report graph "app.hook/target")]
        (is (= 1 (:exit result)))
        (is (= :partial (:status graph)))
        (is (= :ok (:status target)))
        (is (= #{:analyzer-error}
               (set (map :kind (:gaps graph)))))
        (is (not-any? #(= :analyzer-nonzero (:kind %)) (:gaps graph)))))))

(deftest cli-contract-rejects-invalid-roots-and-targets
  (let [invalid-root (run-helper-at "/definitely/not/a/project"
                                     "demo.core/run")
        no-target (run-helper-at fixture-root)
        bare-target (run-helper-at fixture-root "run")
        malformed-target (run-helper-at fixture-root "foo/")
        unknown-option (run-helper-at fixture-root "--wat" "demo.core/run")]
    (is (= 2 (:exit invalid-root)))
    (is (empty? (:out invalid-root)))
    (is (re-find #"not a directory" (:err invalid-root)))
    (is (= 2 (:exit no-target)))
    (is (empty? (:out no-target)))
    (is (re-find #"at least one namespace/var target" (:err no-target)))
    (is (= 2 (:exit bare-target)))
    (is (empty? (:out bare-target)))
    (is (re-find #"fully qualified namespace/var" (:err bare-target)))
    (is (= 2 (:exit malformed-target)))
    (is (empty? (:out malformed-target)))
    (is (re-find #"fully qualified namespace/var" (:err malformed-target)))
    (is (= 2 (:exit unknown-option)))
    (is (empty? (:out unknown-option)))
    (is (re-find #"unknown option: --wat" (:err unknown-option))))
  (is (= {:root "repo"
          :production-only true
          :targets ["a.core/run" "z.core/run"]}
         (call-helper-var "parse-args"
                          ["--production-only"
                           "--root" "repo"
                           "z.core/run"
                           "a.core/run"
                           "a.core/run"]))))

(deftest cli-requires-a-directory-root
  (fs/with-temp-dir [root]
    (let [regular-file (fs/path root "not-a-directory")]
      (spit (str regular-file) "not a directory")
      (let [missing-root (run-helper-cli "demo.core/run")
            missing-value (run-helper-cli "--root")
            regular-file-root (run-helper-at regular-file "demo.core/run")]
        (is (= 2 (:exit missing-root)))
        (is (empty? (:out missing-root)))
        (is (re-find #"--root is required" (:err missing-root)))
        (is (= 2 (:exit missing-value)))
        (is (empty? (:out missing-value)))
        (is (re-find #"--root requires a path" (:err missing-value)))
        (is (= 2 (:exit regular-file-root)))
        (is (empty? (:out regular-file-root)))
        (is (re-find #"not a directory" (:err regular-file-root)))))))

(deftest production-only-empty-discovery-is-fatal
  (fs/with-temp-dir [root]
    (let [path (fs/path root "tests/test_only.clj")]
      (fs/create-dirs (fs/parent path))
      (spit (str path) "(ns test-only)\n")
      (let [result (run-helper-at root "--production-only" "test-only/run")]
        (is (= 2 (:exit result)))
        (is (empty? (:out result)))
        (is (re-find #"no \.clj or \.bb source files" (:err result)))))))

(deftest target-parser-and-lexical-location-test
  (testing "target parsing consumes the complete argument"
    (is (= "clojure.core//"
           (call-helper-var "parse-target" "clojure.core//")))
    (is (thrown? clojure.lang.ExceptionInfo
                 (call-helper-var "parse-target" "demo.core/run trailing"))))
  (testing "location normalization is lexical and does not require files"
    (is (= {:file "src/demo/core.clj" :row 4 :col 7}
           (call-helper-var
            "location"
            (fs/path "/nonexistent/repo")
            {:filename "/nonexistent/repo/src/../src/demo/core.clj"
             :row 4
             :col 7})))))

(deftest minimal-canonical-contract-test
  (let [result (run-helper "demo.script/bb-caller" "demo.script/bb-target")
        expected (slurp (str expected-contract-path))]
    (is (zero? (:exit result)) (:err result))
    (is (= expected (:out result)))
    (let [graph (edn/read-string (:out result))
          bb-caller (target-report graph "demo.script/bb-caller")
          bb-target (target-report graph "demo.script/bb-target")]
      (is (= "dotagents.callgraph.clojure" (:schema graph)))
      (is (= 1 (:schema-version graph)))
      (is (= :ok (:status graph)))
      (is (= ["demo.script/bb-caller" "demo.script/bb-target"]
             (mapv :target (:targets graph))))
      (is (= :function (-> bb-caller :definitions first :kind)))
      (is (some #(= "demo.script/bb-target" (:callee %))
                (:direct-callees bb-caller)))
      (is (some #(= "demo.script/bb-caller" (:caller %))
                (:direct-callers bb-target))))))

(deftest populated-canonical-contract-fixture-test
  (let [result (run-helper "demo.targets/outgoing-target"
                           "demo.targets/direct-target"
                           "demo.targets/multi-target"
                           "demo.targets/protocol-target"
                           "demo.duplicates/duplicate-target"
                           "demo.missing/nope")
        expected (slurp (str expected-populated-contract-path))]
    (is (= 1 (:exit result)) (:err result))
    (is (= expected (:out result)))
    (is (= :partial (:status (edn/read-string (:out result)))))))

(deftest target-order-is-byte-stable-test
  (let [forward (run-helper "demo.script/bb-caller"
                           "demo.script/bb-target"
                           "demo.script/bb-target")
        reverse (run-helper "demo.script/bb-target" "demo.script/bb-caller")
        repeat (run-helper "demo.script/bb-caller" "demo.script/bb-target")]
    (is (zero? (:exit forward)) (:err forward))
    (is (zero? (:exit reverse)) (:err reverse))
    (is (zero? (:exit repeat)) (:err repeat))
    (is (= (:out forward) (:out reverse)))
    (is (= (:out forward) (:out repeat)))
    (is (not (str/includes? (:out forward) (str repo-root))))
    (is (= ["demo.script/bb-caller" "demo.script/bb-target"]
           (mapv :target (:targets (edn/read-string (:out forward))))))))

(deftest canonical-writer-preserves-schema-order-and-sparse-omission
  (let [value (call-helper-var
               "ordered-map"
               [:schema "dotagents.callgraph.clojure"]
               [:schema-version 1]
               [:status :ok]
               [:options (call-helper-var "ordered-map"
                                          [:production-only false])]
               [:targets []]
               [:limits [:static-only]])]
    (is (= "{:schema \"dotagents.callgraph.clojure\" :schema-version 1 :status :ok :options {:production-only false} :targets [] :limits [:static-only]}"
           (call-helper-var "edn-write" value)))
    (is (= "{}"
           (call-helper-var "edn-write"
                            (call-helper-var "evidence-group" [] []))))))

(deftest canonical-sorting-deduplicates-and-nil-locations-sort-first
  (let [records [{:id "b" :site {:file "z.clj" :row 1 :col 1}}
                 {:id "a" :site {:file "a.clj" :row 2 :col 1}}
                 {:id "a" :site {:file "a.clj" :row 2 :col 1}}
                 {:id "n" :site nil}]
        sorted (call-helper-var "sort-unique"
                                #(vector (call-helper-var "location-key" (:site %))
                                         (:id %))
                                records)]
    (is (= [{:id "n" :site nil}
            {:id "a" :site {:file "a.clj" :row 2 :col 1}}
            {:id "b" :site {:file "z.clj" :row 1 :col 1}}]
           sorted))))

(defn -main [& _]
  (let [{:keys [fail error]} (t/run-tests 'test-clj-callers)]
    (System/exit (+ fail error))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
