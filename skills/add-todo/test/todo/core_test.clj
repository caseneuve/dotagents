(ns todo.core-test
  (:require [todo.core :as sut]
            [clojure.test :refer [deftest is testing]]))

;; ---------------------------------------------------------------------------
;; Frontmatter parsing
;; ---------------------------------------------------------------------------

(deftest parse-frontmatter-test
  (testing "extracts frontmatter fields from markdown"
    (let [md (str "---\n"
                  "title: My task\n"
                  "status: open\n"
                  "priority: high\n"
                  "type: feature\n"
                  "labels: [MVP, NEXT_VER]\n"
                  "created: 2026-04-09\n"
                  "parent: null\n"
                  "blocked-by: []\n"
                  "blocks: []\n"
                  "---\n"
                  "\n## Context\n\nSome body text.\n")]
      (is (= {:title "My task"
              :status "open"
              :priority "high"
              :type "feature"
              :labels ["MVP" "NEXT_VER"]
              :created "2026-04-09"
              :parent nil
              :blocked-by []
              :blocks []}
             (sut/parse-frontmatter md)))))

  (testing "handles missing labels field gracefully"
    (let [md (str "---\n"
                  "title: Legacy\n"
                  "status: open\n"
                  "priority: medium\n"
                  "type: chore\n"
                  "created: 2026-04-09\n"
                  "parent: null\n"
                  "---\n")]
      (is (nil? (:labels (sut/parse-frontmatter md))))))

  (testing "handles empty labels field"
    (let [md "---\ntitle: X\nlabels: []\n---\n"]
      (is (= [] (:labels (sut/parse-frontmatter md))))))

  (testing "returns empty map for missing frontmatter"
    (is (= {} (sut/parse-frontmatter "no frontmatter here")))))

;; ---------------------------------------------------------------------------
;; Todo construction from filename + content
;; ---------------------------------------------------------------------------

(deftest parse-todo-test
  (testing "builds a todo map from filename and content"
    (let [md (str "---\n"
                  "title: My task\n"
                  "status: open\n"
                  "priority: high\n"
                  "type: feature\n"
                  "labels: [MVP]\n"
                  "created: 2026-04-09\n"
                  "parent: null\n"
                  "---\n")
          todo (sut/parse-todo "0001-my-task.md" md)]
      (is (= "0001" (:id todo)))
      (is (= "My task" (:title todo)))
      (is (= ["MVP"] (:labels todo))))))

(deftest extract-id-test
  (testing "extracts id prefix from filename"
    (is (= "0001" (sut/extract-id "0001-my-task.md")))
    (is (= "0001.2" (sut/extract-id "0001.2-sub-task.md"))))

  (testing "rejects leading dots"
    (is (nil? (sut/extract-id ".5-bad.md"))))

  (testing "does not match trailing dots"
    (is (= "0001" (sut/extract-id "0001.-weird.md")))))

;; ---------------------------------------------------------------------------
;; Filtering
;; ---------------------------------------------------------------------------

(def sample-todos
  [{:id "0001" :status "open" :type "feature" :priority "high"
    :labels ["MVP"] :parent nil :title "First"}
   {:id "0002" :status "closed" :type "bug" :priority "medium"
    :labels [] :parent nil :title "Second"}
   {:id "0001.1" :status "open" :type "chore" :priority "low"
    :labels ["MVP" "NEXT_VER"] :parent "0001" :title "Sub-task"}])

(deftest filter-todos-test
  (testing "no filters returns all"
    (is (= 3 (count (sut/filter-todos {} sample-todos)))))

  (testing "filters by status"
    (is (= ["0001" "0001.1"]
           (mapv :id (sut/filter-todos {:status "open"} sample-todos)))))

  (testing "filters by type"
    (is (= ["0002"]
           (mapv :id (sut/filter-todos {:type "bug"} sample-todos)))))

  (testing "filters by priority"
    (is (= ["0001"]
           (mapv :id (sut/filter-todos {:priority "high"} sample-todos)))))

  (testing "filters by parent"
    (is (= ["0001.1"]
           (mapv :id (sut/filter-todos {:parent "0001"} sample-todos)))))

  (testing "filters by label"
    (is (= ["0001" "0001.1"]
           (mapv :id (sut/filter-todos {:label "MVP"} sample-todos)))))

  (testing "combines filters"
    (is (= ["0001.1"]
           (mapv :id (sut/filter-todos {:label "MVP" :parent "0001"} sample-todos)))))

  (testing "label filter skips todos with nil labels"
    (let [todos [{:id "1" :labels ["A"] :title "Has"}
                 {:id "2" :labels nil :title "Missing"}
                 {:id "3" :title "No key"}]]
      (is (= ["1"] (mapv :id (sut/filter-todos {:label "A"} todos)))))))

;; ---------------------------------------------------------------------------
;; Formatting
;; ---------------------------------------------------------------------------

(deftest format-todo-line-test
  (testing "formats a todo as a fixed-width line"
    (let [todo {:id "0001" :status "open" :priority "high" :type "feature" :title "My task"}
          line (sut/format-todo-line todo)]
      (is (string? line))
      (is (re-find #"0001" line))
      (is (re-find #"open" line))
      (is (re-find #"My task" line)))))

;; ---------------------------------------------------------------------------
;; Label normalization
;; ---------------------------------------------------------------------------

(deftest normalize-labels-test
  (testing "empty input yields empty vector"
    (is (= [] (sut/normalize-labels "")))
    (is (= [] (sut/normalize-labels nil))))

  (testing "deduplicates and trims"
    (is (= ["MVP" "NEXT_VER"] (sut/normalize-labels "MVP, NEXT_VER, MVP"))))

  (testing "rejects invalid label characters"
    (is (thrown? Exception (sut/normalize-labels "bad label!"))))

  (testing "single label"
    (is (= ["MVP"] (sut/normalize-labels "MVP")))))

;; ---------------------------------------------------------------------------
;; Labels field formatting (for frontmatter output)
;; ---------------------------------------------------------------------------

(deftest format-labels-field-test
  (testing "empty labels"
    (is (= "[]" (sut/format-labels-field []))))

  (testing "single label"
    (is (= "[MVP]" (sut/format-labels-field ["MVP"]))))

  (testing "multiple labels"
    (is (= "[MVP, NEXT_VER]" (sut/format-labels-field ["MVP" "NEXT_VER"])))))

;; ---------------------------------------------------------------------------
;; Next ID computation
;; ---------------------------------------------------------------------------

(deftest next-id-test
  (testing "first top-level ID"
    (is (= "0001" (sut/next-id [] nil))))

  (testing "increments highest top-level ID"
    (is (= "0003" (sut/next-id ["0001-a.md" "0002-b.md"] nil))))

  (testing "first sub-task"
    (is (= "0001.1" (sut/next-id [] "0001"))))

  (testing "increments highest sub-task"
    (is (= "0001.3" (sut/next-id ["0001.1-a.md" "0001.2-b.md"] "0001"))))

  (testing "ignores unrelated files for sub-tasks"
    (is (= "0002.1" (sut/next-id ["0001.1-a.md" "0001.2-b.md"] "0002")))))

;; ---------------------------------------------------------------------------
;; Template rendering
;; ---------------------------------------------------------------------------

(deftest render-template-test
  (testing "renders a todo template with all fields"
    (let [result (sut/render-template {:title "My task"
                                       :status "open"
                                       :priority "medium"
                                       :type "feature"
                                       :labels ["MVP"]
                                       :created "2026-04-10"
                                       :parent nil})]
      (is (re-find #"^---" result))
      (is (re-find #"title: My task" result))
      (is (re-find #"labels: \[MVP\]" result))
      (is (re-find #"parent: null" result))
      (is (re-find #"## E2E Spec" result) "feature type includes E2E section")))

  (testing "refactor type omits E2E section"
    (let [result (sut/render-template {:title "Cleanup"
                                       :status "open"
                                       :priority "low"
                                       :type "refactor"
                                       :labels []
                                       :created "2026-04-10"
                                       :parent nil})]
      (is (not (re-find #"E2E Spec" result))))))

;; ---------------------------------------------------------------------------
;; Status update (pure transformation)
;; ---------------------------------------------------------------------------

(deftest update-status-in-content-test
  (testing "replaces status field in frontmatter"
    (let [content (str "---\ntitle: X\nstatus: open\npriority: high\n---\n\nbody")
          updated (sut/update-status-in-content content "in_progress")]
      (is (re-find #"status: in_progress" updated))
      (is (not (re-find #"status: open" updated)))
      (is (re-find #"title: X" updated) "other fields preserved")
      (is (re-find #"body" updated) "body preserved"))))
