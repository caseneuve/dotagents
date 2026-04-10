(ns todo.core
  "Pure functions for todo management.
   No side effects — no filesystem, no process, no exit.

   Data shapes:

   Todo (parsed from frontmatter + filename):
     {:id       \"0001\"
      :title    \"My task\"
      :status   \"open\"          ; open | in_progress | closed | blocked
      :priority \"high\"          ; high | medium | low
      :type     \"feature\"       ; feature | bug | refactor | chore
      :labels   [\"MVP\"]         ; vector of strings, may be nil or []
      :created  \"2026-04-10\"
      :parent   nil              ; nil or string like \"0001\"
      :blocked-by []
      :blocks   []}

   Filters (for list command):
     {:status \"open\" :type \"bug\" :label \"MVP\" :parent \"0001\" :priority \"high\"}
     All keys optional. Only non-nil keys are applied."
  (:require [clojure.string :as str]))

;; ---------------------------------------------------------------------------
;; Frontmatter parsing
;; ---------------------------------------------------------------------------

(defn- parse-yaml-value
  "Coerce a raw YAML value string to clojure data.
   Handles: null, [], [a, b], plain strings."
  [s]
  (let [s (str/trim s)]
    (cond
      (= "null" s) nil
      (= "[]" s) []
      (re-matches #"\[.*\]" s)
      (let [inner (subs s 1 (dec (count s)))]
        (->> (str/split inner #",")
             (map str/trim)
             (remove str/blank?)
             (mapv (fn [v]
                     (-> v
                         (str/replace #"^[\"']" "")
                         (str/replace #"[\"']$" ""))))))
      :else s)))

(defn parse-frontmatter
  "Extract frontmatter fields from a markdown string.
   Returns a map of keyword keys to parsed values.
   Returns {} if no frontmatter found."
  [content]
  (if-let [[_ fm-body] (re-find #"(?s)^---\n(.*?)\n---" content)]
    (->> (str/split-lines fm-body)
         (keep (fn [line]
                 (when-let [[_ k v] (re-matches #"^([a-z][a-z0-9_-]*): *(.*)" line)]
                   [(keyword k) (parse-yaml-value v)])))
         (into {}))
    {}))

;; ---------------------------------------------------------------------------
;; ID extraction
;; ---------------------------------------------------------------------------

(defn extract-id
  "Extract the ID prefix from a todo filename.
   \"0001-my-task.md\" → \"0001\"
   \"0001.2-sub-task.md\" → \"0001.2\""
  [filename]
  (let [base (str/replace filename #"\.md$" "")]
    (re-find #"^\d+(?:\.\d+)*" base)))

;; ---------------------------------------------------------------------------
;; Todo construction
;; ---------------------------------------------------------------------------

(defn parse-todo
  "Build a todo map from a filename and its content."
  [filename content]
  (merge {:id (extract-id filename)}
         (parse-frontmatter content)))

;; ---------------------------------------------------------------------------
;; Filtering
;; ---------------------------------------------------------------------------

(defn- has-label? [todo label]
  (some #(= label %) (:labels todo)))

(defn filter-todos
  "Filter a seq of todos by a filter map.
   Supported keys: :status, :type, :priority, :parent, :label.
   Only non-nil values are applied."
  [filters todos]
  (let [{:keys [status type priority parent label]} filters]
    (cond->> todos
      status   (filter #(= status (:status %)))
      type     (filter #(= type (:type %)))
      priority (filter #(= priority (:priority %)))
      parent   (filter #(= parent (:parent %)))
      label    (filter #(has-label? % label)))))

;; ---------------------------------------------------------------------------
;; Formatting
;; ---------------------------------------------------------------------------

(defn format-todo-line
  "Format a single todo as a fixed-width summary line."
  [todo]
  (format "%-8s | %-11s | %-6s | %-8s | %s"
          (:id todo)
          (:status todo)
          (:priority todo)
          (:type todo)
          (:title todo)))

;; ---------------------------------------------------------------------------
;; Label normalization
;; ---------------------------------------------------------------------------

(def ^:private label-pattern #"^[A-Za-z0-9._-]+$")

(defn normalize-labels
  "Parse, validate, deduplicate a comma-separated labels string.
   Returns a vector of unique label strings.
   Throws on invalid label characters."
  [input]
  (if (or (nil? input) (str/blank? input))
    []
    (let [parts (->> (str/split input #",")
                     (map str/trim)
                     (remove str/blank?))]
      (doseq [label parts]
        (when-not (re-matches label-pattern label)
          (throw (ex-info (str "Invalid label: " label
                               " (allowed: letters, digits, ., _, -)")
                          {:label label}))))
      (vec (distinct parts)))))

(defn format-labels-field
  "Format a labels vector as a YAML-style inline list.
   [] → \"[]\"
   [\"MVP\"] → \"[MVP]\"
   [\"MVP\" \"NEXT_VER\"] → \"[MVP, NEXT_VER]\""
  [labels]
  (if (empty? labels)
    "[]"
    (str "[" (str/join ", " labels) "]")))

;; ---------------------------------------------------------------------------
;; Next ID computation
;; ---------------------------------------------------------------------------

(defn next-id
  "Compute the next available ID given existing filenames and an optional parent.
   filenames: seq of strings like [\"0001-a.md\" \"0002-b.md\"]
   parent: nil for top-level, or \"0001\" for sub-task."
  [filenames parent]
  (if parent
    ;; Sub-task: find highest PARENT.N
    (let [pattern (re-pattern (str "^" (java.util.regex.Pattern/quote parent)
                                   "\\.(\\d+)-"))
          nums (->> filenames
                    (keep #(some-> (re-find pattern %) second parse-long)))]
      (str parent "." (inc (if (seq nums) (apply max nums) 0))))
    ;; Top-level: find highest NNNN
    (let [nums (->> filenames
                    (keep #(some-> (re-find #"^(\d{4})-" %) second parse-long)))]
      (format "%04d" (inc (if (seq nums) (apply max nums) 0))))))

;; ---------------------------------------------------------------------------
;; Template rendering
;; ---------------------------------------------------------------------------

(defn render-template
  "Render a new todo file from a data map.
   Keys: :title, :status, :priority, :type, :labels, :created, :parent."
  [{:keys [title status priority type labels created parent]}]
  (let [e2e? (contains? #{"feature" "bug"} type)
        e2e-section (when e2e?
                      "\n## E2E Spec\n\nGIVEN ...\nWHEN ...\nTHEN ...\n")]
    (str "---\n"
         "title: " title "\n"
         "status: " status "\n"
         "priority: " priority "\n"
         "type: " type "\n"
         "labels: " (format-labels-field (or labels [])) "\n"
         "created: " created "\n"
         "parent: " (if parent parent "null") "\n"
         "blocked-by: []\n"
         "blocks: []\n"
         "---\n"
         "\n## Context\n\n"
         "[Why this matters. What's broken or missing.]\n"
         "\n## Acceptance Criteria\n\n"
         "- [ ] [Concrete, testable outcome 1]\n"
         "- [ ] [Concrete, testable outcome 2]\n"
         "\n## Affected Files\n\n"
         "- `src/...` — what changes here\n"
         "- `test/...` — what to test\n"
         (or e2e-section "")
         "\n## Notes\n\n"
         "[Constraints, gotchas, related issues.]\n")))

;; ---------------------------------------------------------------------------
;; Status update (pure string transformation)
;; ---------------------------------------------------------------------------

(defn update-status-in-content
  "Replace the status field in a markdown string's frontmatter.
   Returns the updated content string."
  [content new-status]
  (str/replace-first content
                     #"(?m)^status: .+$"
                     (str "status: " new-status)))
