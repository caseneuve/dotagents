#!/usr/bin/env bb

(ns clj-callers
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.set :as set]
            [edamame.core :as edamame]
            [clojure.string :as str]))

(def schema "dotagents.callgraph.clojure")
(def schema-version 1)
(def limits
  [:clj-and-bb-only
   :no-higher-order-resolution
   :no-macro-expansion-proof
   :no-runtime-receiver-resolution
   :static-only])

(defn fail! [kind message]
  (throw (ex-info message {:kind kind})))

(defn invalid-target! [text]
  (fail! :invalid-target
         (str "invalid target: " text
              " (expected fully qualified namespace/var symbol)")))

(defn parse-target [text]
  (let [values (try
                 (edamame/parse-string-all text)
                 (catch Exception _
                   (invalid-target! text)))
        value (first values)]
    (when-not (and (= 1 (count values))
                   (symbol? value)
                   (some? (namespace value))
                   (seq (name value)))
      (invalid-target! text))
    (str value)))

(defn parse-args [args]
  (loop [remaining args
         root nil
         production-only false
         targets []]
    (if (empty? remaining)
      (do
        (when-not root
          (fail! :invalid-cli "--root is required"))
        (when (empty? targets)
          (fail! :invalid-cli "at least one namespace/var target is required"))
        {:root root
         :production-only production-only
         :targets (->> targets distinct sort vec)})
      (let [arg (first remaining)]
        (cond
          (= arg "--production-only")
          (recur (next remaining) root true targets)

          (= arg "--root")
          (if-let [value (second remaining)]
            (recur (nnext remaining) value production-only targets)
            (fail! :invalid-cli "--root requires a path"))

          (str/starts-with? arg "--")
          (fail! :invalid-cli (str "unknown option: " arg))

          :else
          (recur (next remaining)
                 root
                 production-only
                 (conj targets (parse-target arg))))))))

(defn canonical-root [path]
  (try
    (fs/canonicalize path)
    (catch Exception error
      (fail! :invalid-root
             (str "cannot resolve --root: " (.getMessage error))))))

(defn relative-path [root path]
  (-> (fs/relativize root path)
      str
      (str/replace "\\" "/")))

(defn hidden-path? [relative]
  (some #(str/starts-with? % ".") (str/split relative #"/")))

(defn source-path? [relative]
  (or (str/ends-with? relative ".clj")
      (str/ends-with? relative ".bb")))

(defn test-path? [relative]
  (let [parts (str/split relative #"/")
        basename (last parts)
        stem (str/replace basename #"\.(clj|bb)$" "")]
    (or (some #{"test" "tests"} (butlast parts))
        (str/starts-with? stem "test_")
        (str/ends-with? stem "_test"))))

(defn included-source? [relative production-only]
  (and (not (hidden-path? relative))
       (source-path? relative)
       (or (not production-only)
           (not (test-path? relative)))))

(defn discover-sources [root production-only]
  (letfn [(walk [directory]
            (mapcat
             (fn [path]
               (let [relative (relative-path root path)]
                 (cond
                   (fs/sym-link? path) []
                   (fs/directory? path)
                   (if (hidden-path? relative)
                     []
                     (walk path))
                   (and (fs/regular-file? path {:nofollow-links true})
                        (included-source? relative production-only))
                   [{:path path :relative relative}]
                   :else [])))
             (fs/list-dir directory)))]
    (->> (walk root)
         (sort-by :relative)
         vec)))

(defn run-command [options & args]
  (try
    (apply process/shell (assoc options :continue true) args)
    (catch Exception error
      (fail! :process-launch
             (str "cannot start " (first args) ": " (.getMessage error))))))

(defn kondo-version []
  (let [result (run-command {:out :string :err :string}
                            "clj-kondo" "--version")
        line (str/trim (:out result))]
    (when-not (zero? (:exit result))
      (fail! :kondo-preflight
             (str "clj-kondo preflight failed: " (str/trim (:err result)))))
    (if-let [[_ version] (re-matches #"clj-kondo v(.+)" line)]
      version
      (fail! :kondo-preflight
             (str "could not detect clj-kondo version from: " line)))))

(defn run-kondo [root sources]
  (let [lint-paths (str/join fs/path-separator
                             (map #(str (:path %)) sources))
        config-dir (str (fs/path root ".clj-kondo"))]
    (assoc (run-command {:dir root :out :string :err :string}
                         "clj-kondo"
                         "--lint" lint-paths
                         "--config-dir" config-dir
                         "--cache" "false"
                         "--repro"
                         "--fail-level" "error"
                         "--config"
                         "{:output {:format :json :analysis {:protocol-impls true}}}")
           :source-count (count sources))))

(def required-analysis-sections
  #{:namespace-definitions
    :namespace-usages
    :var-definitions
    :var-usages
    :protocol-impls})

(defn parse-analysis [result]
  (let [report (try
                 (json/parse-string (:out result) true)
                 (catch Exception error
                   (fail! :invalid-analyzer-output
                          (str "clj-kondo did not emit JSON: "
                               (.getMessage error)))))
        analysis (:analysis report)]
    (when-not (and (map? analysis)
                   (set/subset? required-analysis-sections
                                 (set (keys analysis))))
      (fail! :invalid-analyzer-output
             "clj-kondo JSON is missing required analysis sections"))
    {:analysis analysis
     :exit (:exit result)
     :findings (:findings report)
     :summary (:summary report)
     :source-count (:source-count result)
     :stderr (:err result)}))

(defn qualified-id [namespace name]
  (when (and namespace name)
    (str namespace "/" name)))

(defn usage-id [usage]
  (qualified-id (:to usage) (:name usage)))

(defn definition-id [definition]
  (qualified-id (:ns definition) (:name definition)))

(defn location [root record]
  (let [filename (:filename record)
        root-path (fs/normalize root)
        input-path (when (string? filename)
                     (fs/path filename))
        file-path (when input-path
                    (fs/normalize (if (fs/absolute? input-path)
                                    input-path
                                    (fs/path root-path input-path))))]
    (when-not (and file-path (fs/starts-with? file-path root-path))
      (fail! :invalid-analyzer-output
             (str "analyzer filename is outside --root: " filename)))
    (let [relative (-> (fs/relativize root-path file-path)
                       str
                       (str/replace "\\" "/"))]
      {:file relative
       :row (or (:name-row record) (:row record))
       :col (or (:name-col record) (:col record))})))

(defn definition-kind [definition]
  (let [defined-by (or (:defined-by->lint-as definition)
                       (:defined-by definition))]
    (cond
      (= defined-by "clojure.core/defmacro") :macro
      (= defined-by "clojure.core/defmulti") :multimethod
      (:protocol-name definition) :protocol-function
      (#{"clojure.core/defn" "clojure.core/defn-"} defined-by) :function
      defined-by :var
      :else :unknown)))

(defn definition-record [root definition]
  {:kind (definition-kind definition)
   :location (location root definition)})

(defn resolved-usage? [usage]
  (and (usage-id usage)
       (not= "clj-kondo/unknown-namespace" (:to usage))))

(defn invocation-usage? [usage]
  (some? (:arity usage)))

(defn classify-usage
  ([usage]
   (classify-usage usage #{}))
  ([usage dispatch-vars]
   (cond
     (:refer usage) :refer
     (:defmethod usage) :defmethod
     (:macro usage) :macro-boundary
     (and (invocation-usage? usage)
          (= "clj-kondo/unknown-namespace" (:to usage))
          (some? (:name usage))) :unresolved-invocation
     (and (invocation-usage? usage)
          (contains? dispatch-vars (usage-id usage))) :dispatch
     (and (invocation-usage? usage)
          (resolved-usage? usage)) :direct-invocation
     (resolved-usage? usage) :reference
     :else :ignored)))

(defn direct-usage?
  ([usage]
   (direct-usage? usage #{}))
  ([usage dispatch-vars]
   (= :direct-invocation (classify-usage usage dispatch-vars))))

(defn reference-usage?
  ([usage]
   (reference-usage? usage #{}))
  ([usage dispatch-vars]
   (= :reference (classify-usage usage dispatch-vars))))

(defn macro-usage? [usage]
  (= :macro-boundary (classify-usage usage)))

(defn owner-id [usage]
  (qualified-id (:from usage) (:from-var usage)))

(defn direct-caller-record [root usage]
  (when-let [caller (owner-id usage)]
    {:caller caller
     :site (location root usage)}))

(defn direct-callee-record [root usage]
  (when-let [callee (usage-id usage)]
    {:callee callee
     :site (location root usage)}))

(declare ordered-map)

(defn usage-site-record [root usage]
  (ordered-map
   [:var (usage-id usage)]
   [:owner (owner-id usage)]
   [:namespace (:from usage)]
   [:site (location root usage)]))

(defn reference-record [root usage]
  (usage-site-record root usage))

(defn macro-boundary-record [root usage]
  {:macro (usage-id usage)
   :owner (owner-id usage)
   :namespace (:from usage)
   :site (location root usage)})

(defn unattributed-invocation-record [root usage]
  {:var (usage-id usage)
   :namespace (:from usage)
   :site (location root usage)})

(defn dispatch-record [root usage]
  (usage-site-record root usage))

(defn unresolved-invocation? [usage]
  (= :unresolved-invocation (classify-usage usage)))

(defn location-key [site]
  (if site
    [1 (:file site) (:row site) (:col site)]
    [0 "" 0 0]))

(defn sort-unique [key-fn records]
  (vec (sort-by key-fn (distinct records))))

(defn evidence-group [incoming outgoing]
  (ordered-map
   (when (seq incoming) [:incoming incoming])
   (when (seq outgoing) [:outgoing outgoing])))

(def dispatch-kinds #{:multimethod :protocol-function})

(defn dispatch-definition? [definition]
  (contains? dispatch-kinds (definition-kind definition)))

(defn multimethod-candidate [root target usage]
  (ordered-map
   [:kind :multimethod-method]
   [:target target]
   [:implementation-namespace (:from usage)]
   [:defined-by "clojure.core/defmethod"]
   [:dispatch-value (:dispatch-val-str usage)]
   [:location (location root usage)]))

(defn protocol-candidate [root target implementation]
  (when (and (string? (:defined-by implementation))
             (seq (:defined-by implementation)))
    (ordered-map
     [:kind :protocol-implementation]
     [:target target]
     [:implementation-namespace (:impl-ns implementation)]
     [:defined-by (:defined-by implementation)]
     [:dispatch-value nil]
     [:location (location root implementation)])))

(defn dispatch-group [sites outgoing candidates]
  (ordered-map
   (when (seq sites) [:sites sites])
   (when (seq outgoing) [:outgoing outgoing])
   (when (seq candidates) [:candidates candidates])))

(defn target-report [root target definitions usages protocol-impls dispatch-vars]
  (let [[target-ns target-name] (str/split target #"/" 2)
        local-definitions (filter #(= target (definition-id %)) definitions)
        local-kinds (set (map definition-kind local-definitions))
        target-usages (filter #(= target (usage-id %)) usages)
        owner? #(and (= target-ns (:from %))
                     (= target-name (:from-var %)))
        incoming (->> target-usages
                      (filter #(direct-usage? % dispatch-vars))
                      (keep #(when (:from-var %) (direct-caller-record root %)))
                      (sort-unique #(vector (:caller %)
                                             (location-key (:site %)))))
        outgoing (->> usages
                      (filter #(and (owner? %)
                                    (direct-usage? % dispatch-vars)))
                      (keep #(when (usage-id %) (direct-callee-record root %)))
                      (sort-unique #(vector (:callee %)
                                             (location-key (:site %)))))
        incoming-references (->> target-usages
                                (filter #(reference-usage? % dispatch-vars))
                                (map #(reference-record root %))
                                (sort-unique #(vector (:var %)
                                                       (:owner %)
                                                       (:namespace %)
                                                       (location-key (:site %)))))
        outgoing-references (->> usages
                                (filter #(and (owner? %)
                                              (reference-usage? % dispatch-vars)))
                                (map #(reference-record root %))
                                (sort-unique #(vector (:var %)
                                                       (:owner %)
                                                       (:namespace %)
                                                       (location-key (:site %)))))
        incoming-macros (->> target-usages
                             (filter macro-usage?)
                             (map #(macro-boundary-record root %))
                             (sort-unique #(vector (:macro %)
                                                    (:owner %)
                                                    (:namespace %)
                                                    (location-key (:site %)))))
        outgoing-macros (->> usages
                             (filter #(and (owner? %)
                                           (macro-usage? %)))
                             (map #(macro-boundary-record root %))
                             (sort-unique #(vector (:macro %)
                                                    (:owner %)
                                                    (:namespace %)
                                                    (location-key (:site %)))))
        incoming-dispatch (->> target-usages
                              (filter #(= :dispatch
                                          (classify-usage % dispatch-vars)))
                              (map #(dispatch-record root %))
                              (sort-unique #(vector (:var %)
                                                     (:owner %)
                                                     (:namespace %)
                                                     (location-key (:site %)))))
        outgoing-dispatch (->> usages
                              (filter #(and (owner? %)
                                            (= :dispatch
                                               (classify-usage % dispatch-vars))))
                              (map #(dispatch-record root %))
                              (sort-unique #(vector (:var %)
                                                     (:owner %)
                                                     (:namespace %)
                                                     (location-key (:site %)))))
        candidates (->> (concat
                         (for [usage usages
                               :when (and (contains? local-kinds :multimethod)
                                           (= target (usage-id usage))
                                           (:defmethod usage))]
                           (multimethod-candidate root target usage))
                         (for [implementation protocol-impls
                               :let [implementation-target
                                     (qualified-id (:protocol-ns implementation)
                                                   (:method-name implementation))]
                               :when (and (contains? local-kinds :protocol-function)
                                           (= target implementation-target))
                               :let [candidate
                                     (protocol-candidate root target implementation)]
                               :when candidate]
                           candidate))
                       (sort-unique #(vector (str (:target %))
                                              (str (:kind %))
                                              (:dispatch-value %)
                                              (location-key (:location %)))))
        unattributed (->> target-usages
                          (filter #(and (direct-usage? % dispatch-vars)
                                        (nil? (:from-var %))))
                          (map #(unattributed-invocation-record root %))
                          (sort-unique #(vector (:var %)
                                                 (:namespace %)
                                                 (location-key (:site %)))))
        unresolved-gaps (->> usages
                             (filter #(and (owner? %)
                                           (unresolved-invocation? %)))
                             (map #(ordered-map
                                    [:kind :unresolved-invocation]
                                    [:location (location root %)]
                                    [:message (str "unresolved invocation of "
                                                 (:name %)
                                                 " from " target)]))
                             (sort-unique #(vector (str (:kind %))
                                                    (location-key (:location %))
                                                    (:message %))))
        defs (->> local-definitions
                  (map #(definition-record root %))
                  (sort-unique #(vector (str (:kind %))
                                         (location-key (:location %)))))
        duplicate-gaps (when (> (count defs) 1)
                         (map #(ordered-map
                                [:kind :duplicate-definition]
                                [:location (:location %)]
                                [:message (str "duplicate local definition for "
                                               target)])
                              (rest defs)))
        gaps (sort-unique #(vector (str (:kind %))
                                    (location-key (:location %))
                                    (:message %))
                          (concat
                           (when (empty? defs)
                             [(ordered-map
                               [:kind :missing-definition]
                               [:location nil]
                               [:message (str "no local definition found for " target)])])
                           duplicate-gaps
                           unresolved-gaps))
        status (if (seq gaps) :partial :ok)]
    (ordered-map
     [:target target]
     [:status status]
     (when (seq defs) [:definitions defs])
     (when (seq incoming) [:direct-callers incoming])
     (when (seq outgoing) [:direct-callees outgoing])
     (let [group (evidence-group incoming-references outgoing-references)]
       (when (seq group) [:references group]))
     (let [group (evidence-group incoming-macros outgoing-macros)]
       (when (seq group) [:macro-boundaries group]))
     (let [group (dispatch-group incoming-dispatch
                                  outgoing-dispatch
                                  candidates)]
       (when (seq group) [:dispatch group]))
     (when (seq unattributed) [:unattributed-invocations unattributed])
     (when (seq gaps) [:gaps gaps]))))

(defn ordered-map [& entries]
  (apply array-map
         (mapcat identity (filter vector? entries))))

(defn edn-write [value]
  (cond
    (nil? value) "nil"
    (string? value) (pr-str value)
    (keyword? value) (str value)
    (symbol? value) (str value)
    (number? value) (str value)
    (boolean? value) (str value)
    (vector? value) (str "[" (str/join " " (map edn-write value)) "]")
    (map? value) (str "{" (str/join " " (map (fn [[key item]]
                                                  (str (edn-write key)
                                                       " "
                                                       (edn-write item)))
                                                value)) "}")
    :else (pr-str value)))

(def soundness-finding-types
  #{"syntax" "reader-error" "invalid-config" "config"
    "hook" "invalid-hook" "hook-error"})

(defn finding-type [finding]
  (some-> (:type finding) str))

(defn soundness-finding? [finding]
  (contains? soundness-finding-types (finding-type finding)))

(defn normalize-message [root message]
  (let [message (str message)
        root-text (str (fs/normalize root))
        root-slashes (str/replace root-text "\\" "/")
        root-backslashes (str/replace root-text "/" "\\")]
    (-> message
        (str/replace root-text ".")
        (str/replace root-slashes ".")
        (str/replace root-backslashes "."))))

(defn analyzer-finding-gap [root finding]
  (when (soundness-finding? finding)
    (ordered-map
     [:kind :analyzer-error]
     [:location (when (:filename finding)
                  (location root finding))]
     [:message (normalize-message
                root
                (str "clj-kondo " (finding-type finding) ": "
                     (or (:message finding) "analysis failure")))])))

(defn config-or-hook-stderr? [stderr]
  (boolean
   (and (string? stderr)
        (re-find #"(?i)(error while reading .*config|config.*(?:error|failed)|hook.*(?:error|failed)|error.*hook)"
                 stderr))))

(defn analyzer-gaps [root analysis-result]
  (let [finding-gaps (keep #(analyzer-finding-gap root %)
                           (:findings analysis-result))
        stderr-gap (when (config-or-hook-stderr? (:stderr analysis-result))
                     [(ordered-map
                       [:kind :analyzer-error]
                       [:location nil]
                       [:message "clj-kondo configuration or hook failure"])])
        source-gap (when (and (integer? (:source-count analysis-result))
                              (integer? (get-in analysis-result [:summary :files]))
                              (< (get-in analysis-result [:summary :files])
                                 (:source-count analysis-result)))
                     [(ordered-map
                       [:kind :analyzer-error]
                       [:location nil]
                       [:message "clj-kondo did not analyze every discovered source file"])])
        recognized-gaps (concat finding-gaps stderr-gap source-gap)
        findings-account-for-exit? (some (fn [finding]
                                           (and (map? finding)
                                                (some? (:type finding))
                                                (= "error" (some-> (:level finding) str))))
                                         (:findings analysis-result))
        unexplained-gap (when (and (not (zero? (:exit analysis-result)))
                                   (empty? recognized-gaps)
                                   (not findings-account-for-exit?))
                          [(ordered-map
                            [:kind :analyzer-nonzero]
                            [:location nil]
                            [:message (str "clj-kondo exited "
                                           (:exit analysis-result))])])]
    (sort-unique #(vector (str (:kind %))
                          (location-key (:location %))
                          (:message %))
                 (concat recognized-gaps unexplained-gap))))

(defn report [root production-only targets version analysis-result]
  (let [analysis (:analysis analysis-result)
        definitions (:var-definitions analysis)
        usages (:var-usages analysis)
        protocol-impls (:protocol-impls analysis)
        dispatch-vars (->> definitions
                           (filter dispatch-definition?)
                           (map definition-id)
                           set)
        target-reports (mapv #(target-report root % definitions usages
                                             protocol-impls dispatch-vars)
                             targets)
        analyzer-gap (analyzer-gaps root analysis-result)
        partial? (or (seq analyzer-gap)
                     (some #(= :partial (:status %)) target-reports))]
    (ordered-map
     [:schema schema]
     [:schema-version schema-version]
     [:status (if partial? :partial :ok)]
     [:analyzer (ordered-map [:name "clj-kondo"] [:version version])]
     [:options (ordered-map [:production-only production-only])]
     [:targets target-reports]
     (when (seq analyzer-gap) [:gaps analyzer-gap])
     [:limits limits])))

(defn -main [& args]
  (try
    (let [{:keys [root production-only targets]} (parse-args args)
          root (canonical-root root)]
      (when-not (fs/directory? root)
        (fail! :invalid-root (str "--root is not a directory: " root)))
      (let [sources (discover-sources root production-only)]
        (when (empty? sources)
          (fail! :empty-discovery
                 "no .clj or .bb source files discovered beneath --root"))
        (let [version (kondo-version)
              analysis-result (parse-analysis (run-kondo root sources))
              graph (report root production-only targets version analysis-result)]
          (println (edn-write graph))
          (when (= :partial (:status graph))
            (System/exit 1)))))
    (catch clojure.lang.ExceptionInfo error
      (binding [*out* *err*]
        (println (str "clj_callers: " (.getMessage error))))
      (System/exit 2))
    (catch Exception error
      (binding [*out* *err*]
        (println (str "clj_callers: " (.getMessage error))))
      (System/exit 2))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
