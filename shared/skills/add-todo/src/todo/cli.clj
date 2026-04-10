#!/usr/bin/env bb

(ns todo.cli
  "CLI entry point for todo management.
   Dispatches subcommands: list, new, next-id, status.

   Usage:
     todo list [--status S] [--type T] [--priority P] [--parent ID] [--label L] [--dir DIR]
     todo new --type TYPE --slug SLUG [--title T] [--priority P] [--parent ID] [--labels L] [--dir DIR]
     todo next-id [--dir DIR] [PARENT]
     todo status ID STATUS [--dir DIR]"
  (:require [babashka.cli :as cli]
            [babashka.fs :as fs]
            [clojure.string :as str]
            [todo.core :as core]))

;; ---------------------------------------------------------------------------
;; I/O helpers
;; ---------------------------------------------------------------------------

(defn- read-todos
  "Read all todo files from dir, return seq of {:filename :content} maps."
  [dir]
  (->> (fs/glob dir "[0-9]*-*.md")
       (sort)
       (map (fn [path]
              {:filename (str (fs/file-name path))
               :content  (slurp (str path))}))))

(defn- todo-filenames
  "List todo filenames in dir."
  [dir]
  (->> (fs/glob dir "*.md")
       (sort)
       (mapv (fn [p] (str (fs/file-name p))))))

(defn- today []
  (.format (java.time.LocalDate/now)
           (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM-dd")))

;; ---------------------------------------------------------------------------
;; Subcommand: list
;; ---------------------------------------------------------------------------

(def list-spec
  {:spec {:status   {:desc "Filter by status (open|in_progress|closed|blocked)"}
          :type     {:desc "Filter by type (feature|bug|refactor|chore)"}
          :priority {:desc "Filter by priority (high|medium|low)"}
          :parent   {:desc "Show only sub-tasks of PARENT ID"}
          :label    {:desc "Filter by a single label"}
          :dir      {:desc "Todos directory" :default "./todos"}}})

(defn cmd-list [{:keys [opts]}]
  (let [dir (:dir opts)
        filters (select-keys opts [:status :type :priority :parent :label])]
    (when-not (fs/directory? dir)
      (binding [*out* *err*]
        (println (str "No todos directory found at: " dir)))
      (System/exit 0))
    (let [todos (->> (read-todos dir)
                     (mapv #(core/parse-todo (:filename %) (:content %))))
          filtered (core/filter-todos filters todos)]
      (doseq [todo filtered]
        (println (core/format-todo-line todo)))
      (binding [*out* *err*]
        (println (str (count filtered) " todo(s) found"))))))

;; ---------------------------------------------------------------------------
;; Subcommand: new
;; ---------------------------------------------------------------------------

(def new-spec
  {:spec {:type     {:desc "Type: feature|bug|refactor|chore" :require true}
          :slug     {:desc "Kebab-case slug for filename" :require true}
          :title    {:desc "Human-readable title (default: slug with dashes→spaces)"}
          :priority {:desc "Priority: high|medium|low" :default "medium"}
          :parent   {:desc "Parent ID for sub-tasks" :coerce :string}
          :labels   {:desc "Comma-separated labels (e.g. MVP,NEXT_VER)" :default ""}
          :dir      {:desc "Todos directory" :default "./todos"}}
   :error-fn (fn [{:keys [cause msg option]}]
               (when (= :org.babashka/cli (:type (ex-data (Exception.))))
                 (binding [*out* *err*]
                   (println (str "Error (" (name cause) "): " option " — " msg)))
                 (System/exit 1)))})

(def valid-types #{"feature" "bug" "refactor" "chore"})
(def valid-priorities #{"high" "medium" "low"})

(defn cmd-new [{:keys [opts]}]
  (let [{:keys [type slug title priority parent labels dir]} opts]
    ;; Validate
    (when-not (valid-types type)
      (binding [*out* *err*]
        (println "error: --type must be feature|bug|refactor|chore"))
      (System/exit 1))
    (when-not (valid-priorities priority)
      (binding [*out* *err*]
        (println "error: --priority must be high|medium|low"))
      (System/exit 1))

    (let [labels-vec (core/normalize-labels labels)
          title (or title (str/replace slug "-" " "))
          _     (fs/create-dirs dir)
          files (todo-filenames dir)
          id    (core/next-id files parent)
          filepath (str dir "/" id "-" slug ".md")
          content (core/render-template {:title    title
                                         :status   "open"
                                         :priority priority
                                         :type     type
                                         :labels   labels-vec
                                         :created  (today)
                                         :parent   parent})]
      (spit filepath content)
      (println (str "filepath=" filepath))
      (println (str "id=" id))
      (binding [*out* *err*]
        (println (str "Created: " filepath))))))

;; ---------------------------------------------------------------------------
;; Subcommand: next-id
;; ---------------------------------------------------------------------------

(def next-id-spec
  {:spec {:parent {:desc "Parent ID for sub-tasks" :coerce :string}
          :dir    {:desc "Todos directory" :default "./todos"}}
   :args->opts [:parent]})

(defn cmd-next-id [{:keys [opts]}]
  (let [{:keys [dir parent]} opts
        files (if (fs/directory? dir) (todo-filenames dir) [])]
    (println (core/next-id files parent))))

;; ---------------------------------------------------------------------------
;; Subcommand: status
;; ---------------------------------------------------------------------------

(def status-spec
  {:spec {:id         {:desc "Todo ID" :coerce :string}
          :new-status {:desc "New status" :coerce :string}
          :dir        {:desc "Todos directory" :default "./todos"}}
   :args->opts [:id :new-status]})

(def valid-statuses #{"open" "in_progress" "closed" "blocked"})

(defn cmd-status [{:keys [opts]}]
  (let [{:keys [id new-status dir]} opts]
    (when (or (nil? id) (nil? new-status))
      (binding [*out* *err*]
        (println "error: usage: todo status ID STATUS [--dir DIR]"))
      (System/exit 1))
    (when-not (valid-statuses new-status)
      (binding [*out* *err*]
        (println "error: status must be open|in_progress|closed|blocked"))
      (System/exit 1))

    (let [matches (->> (fs/glob dir (str id "-*.md")) (sort) (first))]
      (when-not matches
        (binding [*out* *err*]
          (println (str "error: no todo found with ID " id)))
        (System/exit 1))

      (let [filepath (str matches)
            content (slurp filepath)
            old-status (:status (core/parse-frontmatter content))
            updated (core/update-status-in-content content new-status)]
        (spit filepath updated)
        (println (str "filepath=" filepath))
        (println (str "old_status=" old-status))
        (println (str "new_status=" new-status))
        (binding [*out* *err*]
          (println (str "Updated: " filepath " (" old-status " → " new-status ")")))))))

;; ---------------------------------------------------------------------------
;; Help
;; ---------------------------------------------------------------------------

(defn cmd-help [_]
  (println "Usage: todo <command> [options]")
  (println)
  (println "Commands:")
  (println "  list      List todos with optional filtering")
  (println "  new       Create a new todo from template")
  (println "  next-id   Return the next available todo ID")
  (println "  status    Update the status of a todo")
  (println)
  (println "Run 'todo <command> --help' for command-specific options."))

;; ---------------------------------------------------------------------------
;; Dispatch table
;; ---------------------------------------------------------------------------

(def dispatch-table
  [{:cmds ["list"]    :fn cmd-list    :spec (:spec list-spec)}
   {:cmds ["new"]     :fn cmd-new     :spec (:spec new-spec)}
   {:cmds ["next-id"] :fn cmd-next-id :spec (:spec next-id-spec) :args->opts (:args->opts next-id-spec)}
   {:cmds ["status"]  :fn cmd-status  :spec (:spec status-spec) :args->opts (:args->opts status-spec)}
   {:cmds []          :fn cmd-help}])

(defn -main [& args]
  (cli/dispatch dispatch-table args))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
