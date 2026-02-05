#!/usr/bin/env bb

;; new-entry.bb - Gather all template context for an org-journal entry
;; Usage: bb new-entry.bb [--mkdir] [project-name]
;; If project-name is omitted, detects from git/jj repo root.
;; Pass --mkdir to create directory structure. Without it, no filesystem writes.
;; Prints EDN map with all fields the template needs to stdout.

(require '[babashka.cli :as cli]
         '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[clojure.string :as str])

(defn script-path []
  (or (System/getProperty "babashka.file") *file* ""))

(defn agent-name []
  (or (System/getenv "ORG_JOURNAL_AGENT")
      (let [path (script-path)]
        (cond
          (or (str/includes? path "/.claude/")
              (str/includes? path "/claude/")) "claude"
          (or (str/includes? path "/.agents/")
              (str/includes? path "/agents/")) "codex"
          :else "unknown"))))

(defn journal-dir []
  (or (System/getenv "ORG_JOURNAL_HOME")
      "~/org/agent-journal"))

(defn sh [& args]
  (try
    (str/trim (:out (apply p/shell {:out :string :err :string} args)))
    (catch Exception _ nil)))

(defn git-project-root []
  (some-> (sh "git rev-parse --show-toplevel") fs/file-name str))

(defn jj-project-root []
  (some-> (sh "jj workspace root") fs/file-name str))

(defn vcs-project-root []
  (or (git-project-root) (jj-project-root)))

(defn git-branch []
  (sh "git branch --show-current"))

(defn jj-branch []
  (sh "jj log -r @ --no-graph -T 'bookmarks'"))

(defn vcs-branch []
  (or (git-branch) (jj-branch) "none"))

(defn git-recent-commits []
  (some->> (sh "git log --oneline -20")
           str/split-lines
           (mapv #(let [[hash & msg] (str/split % #"\s+" 2)]
                    {:hash hash :message (str/join " " msg)}))))

(defn jj-recent-commits []
  (some->> (sh "jj log --no-graph -r 'ancestors(@, 20)' -T 'change_id.shortest() ++ \" \" ++ description.first_line() ++ \"\\n\"'")
           str/split-lines
           (remove str/blank?)
           (mapv #(let [[hash & msg] (str/split % #"\s+" 2)]
                    {:hash hash :message (str/join " " msg)}))))

(defn vcs-recent-commits []
  (or (git-recent-commits) (jj-recent-commits) []))

(defn detect-os []
  (let [os-name (System/getProperty "os.name")]
    (cond
      (str/starts-with? os-name "Mac")   "macos"
      (str/starts-with? os-name "Linux") (or (some-> (sh "sed" "-n" "s/^ID=//p" "/etc/os-release")
                                                     (str/replace "\"" ""))
                                             "linux")
      :else                              (str/lower-case os-name))))

(defn parse-ticket [branch]
  (when-let [[_ ticket] (re-find #"(?i)(?:^|/)([A-Z]+-\d+)" branch)]
    ticket))

(defn find-last-entry [project]
  (let [root (fs/expand-home (journal-dir))
        suffix (str "-" project ".org")]
    (when (fs/exists? root)
      (->> (file-seq (fs/file root))
           (map str)
           (filter #(str/ends-with? % suffix))
           sort
           last))))

(defn now-parts []
  (let [now (java.time.LocalDateTime/now)
        fmt #(.format now (java.time.format.DateTimeFormatter/ofPattern %))]
    {:year (fmt "yyyy")
     :month (fmt "MM")
     :day (fmt "dd")
     :hhmm (fmt "HHmm")
     :date (fmt "yyyy-MM-dd HH:mm")}))

(when (= *file* (System/getProperty "babashka.file"))
  (let [opts (cli/parse-opts *command-line-args*
                             {:coerce {:mkdir :boolean}
                              :args->opts [:project]})
        vcs-project (vcs-project-root)
        project (or (:project opts) vcs-project)
        branch (vcs-branch)
        {:keys [year month day hhmm date]} (now-parts)
        dir (str (fs/path (fs/expand-home (journal-dir)) year month day))
        hostname (or (sh "hostname") "unknown")
        os-name (detect-os)
        suggestions (when-not project [hostname os-name])
        project (or project "unknown")
        filename (format "%s-%s.org" hhmm project)
        filepath (str dir "/" filename)]
    (when (:mkdir opts) (fs/create-dirs dir))
    (prn (cond-> {:path filepath
                  :date date
                  :hostname hostname
                  :agent (agent-name)
                  :project project
                  :branch branch
                  :ticket (or (parse-ticket branch) "none")
                  :commits (vcs-recent-commits)
                  :dirs-exist (fs/exists? dir)
                  :last-entry (find-last-entry project)}
           suggestions (assoc :suggestions suggestions)))))
