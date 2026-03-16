#!/usr/bin/env bb

(ns bootstrap
  (:require [babashka.cli :as cli]
            [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; Functional core:
;; - data: config maps and operation maps
;; - calculation: build a plan from repo layout + mode
;; Imperative shell:
;; - execute link/copy/merge actions against the filesystem

(def cli-spec
  {:spec {:mode {:desc "Bootstrap target: claude | agents | pi | all"
                 :default "all"}
          :force {:alias :f
                  :coerce :boolean
                  :desc "Overwrite existing non-symlink files"}
          :dry-run {:alias :n
                    :coerce :boolean
                    :desc "Print planned changes without writing"}
          :help {:alias :h
                 :coerce :boolean
                 :desc "Show help"}}
   :args->opts [:mode]
   :restrict [:mode :force :dry-run :help]})

(def valid-modes #{:claude :agents :pi :all})

(defn usage []
  (str
   "Usage: bb bootstrap [claude|agents|pi|all] [--force] [--dry-run]\n\n"
   (cli/format-opts {:spec (:spec cli-spec)
                     :order [:mode :force :dry-run :help]})))

(defn parse-cli [argv]
  (let [{:keys [mode force dry-run help]} (cli/parse-opts argv cli-spec)
        mode (keyword (or mode "all"))]
    (when-not (contains? valid-modes mode)
      (binding [*out* *err*]
        (println "Invalid mode:" (name mode))
        (println)
        (println (usage)))
      (System/exit 1))
    {:mode mode
     :force? (true? force)
     :dry-run? (true? dry-run)
     :help? (true? help)}))

(defn repo-root []
  (System/getProperty "user.dir"))

(defn paths [root]
  (let [home (or (System/getenv "HOME") (str (fs/home)))]
    {:root root
     :home home
     :claude-src (str (fs/path root "claude"))
     :agents-src (str (fs/path root "agents"))
     :shared-src (str (fs/path root "shared"))
     :pi-src (str (fs/path root "pi"))
     :claude-dst (str (fs/path home ".claude"))
     :agents-dst (str (fs/path home ".agents"))
     :codex-dst (str (fs/path home ".codex"))
     :pi-dst (str (fs/path home ".pi" "agent"))
     :hooks-json (str (fs/path root "settings-hooks.json"))
     :perms-json (str (fs/path root "settings-permissions.json"))}))

(defn ensure-dir! [path]
  (some-> path fs/parent fs/create-dirs))

(defn path-kind [path]
  (cond
    (fs/sym-link? path) :symlink
    (fs/directory? path) :dir
    (fs/regular-file? path) :file
    (fs/exists? path) :other
    :else :missing))

(defn read-link [path]
  (when (fs/sym-link? path)
    (str (fs/read-link path))))

(defn normalize-link-target [link-path raw-target]
  (let [target (fs/path raw-target)]
    (str
     (fs/normalize
      (if (fs/absolute? target)
        target
        (fs/path (fs/parent link-path) raw-target))))))

(defn already-linked? [target source]
  (when-let [raw (read-link target)]
    (= (normalize-link-target target raw)
       (str (fs/normalize (fs/path source))))))

(defn remove-path! [path]
  (case (path-kind path)
    :missing nil
    :dir (fs/delete-tree path)
    (fs/delete path)))

(defn rel-path [root file]
  (str (fs/relativize (fs/path root) (fs/path file))))

(defn tree-files [root]
  (if (fs/directory? root)
    (->> (fs/glob root "**" {:follow-links false})
         (filter fs/regular-file?)
         (sort)
         (map str))
    []))

(defn tree-ops [{:keys [src dst mode include?]}]
  (->> (tree-files src)
       (map (fn [file]
              (let [rel (rel-path src file)]
                {:op mode
                 :source file
                 :target (str (fs/path dst rel))
                 :label rel})))
       (filter (fn [{:keys [label]}]
                 (if include?
                   (include? label)
                   true)))))

(defn skill-ops [{:keys [src dst markdown-mode]}]
  (->> (tree-files src)
       (map (fn [file]
              (let [rel (rel-path src file)
                    nested? (str/includes? rel "/")]
                (when nested?
                  {:op (if (and (= markdown-mode :copy)
                                (str/ends-with? rel ".md"))
                         :copy
                         :link)
                   :source file
                   :target (str (fs/path dst rel))
                   :label rel}))))
       (remove nil?)))

(defn section [title]
  {:op :section :title title})

(defn plan-claude [p]
  (concat
   [(section "Claude")]
   (tree-ops {:src (:claude-src p) :dst (:claude-dst p) :mode :link})
   (tree-ops {:src (:shared-src p) :dst (:claude-dst p) :mode :link})
   [{:op :merge-claude-settings
     :target-dir (:claude-dst p)
     :hooks-json (:hooks-json p)
     :perms-json (:perms-json p)}]))

(defn plan-agents [p]
  (concat
   [(section "Agents")]
   [{:op :link
     :source (str (fs/path (:agents-src p) "AGENTS.md"))
     :target (str (fs/path (:agents-dst p) "AGENTS.md"))
     :label "~/.agents/AGENTS.md"}
    {:op :link
     :source (str (fs/path (:agents-src p) "AGENTS.md"))
     :target (str (fs/path (:codex-dst p) "AGENTS.md"))
     :label "~/.codex/AGENTS.md"}]
   (tree-ops {:src (str (fs/path (:agents-src p) "hooks"))
              :dst (str (fs/path (:agents-dst p) "hooks"))
              :mode :link})
   (skill-ops {:src (str (fs/path (:agents-src p) "skills"))
               :dst (str (fs/path (:agents-dst p) "skills"))
               :markdown-mode :copy})
   (skill-ops {:src (str (fs/path (:shared-src p) "skills"))
               :dst (str (fs/path (:agents-dst p) "skills"))
               :markdown-mode :link})
   (tree-ops {:src (str (fs/path (:shared-src p) "hooks"))
              :dst (str (fs/path (:agents-dst p) "hooks"))
              :mode :link})))

(defn plan-pi [p]
  (concat
   [(section "Pi")]
   (tree-ops {:src (str (fs/path (:pi-src p) "extensions"))
              :dst (str (fs/path (:pi-dst p) "extensions"))
              :mode :link})
   (tree-ops {:src (str (fs/path (:pi-src p) "themes"))
              :dst (str (fs/path (:pi-dst p) "themes"))
              :mode :link})))

(defn plan [p {:keys [mode]}]
  (case mode
    :claude (plan-claude p)
    :agents (plan-agents p)
    :pi (plan-pi p)
    :all (concat (plan-claude p)
                 (plan-agents p)
                 (plan-pi p))))

(defn slurp-json [path]
  (when (fs/exists? path)
    (json/parse-string (slurp path) true)))

(defn spit-json! [path data]
  (ensure-dir! path)
  (spit path (str (json/generate-string data {:pretty true}) "\n")))

(defn replace-home [x home]
  (cond
    (string? x) (str/replace x "$HOME" home)
    (map? x) (into {} (map (fn [[k v]] [k (replace-home v home)])) x)
    (vector? x) (mapv #(replace-home % home) x)
    (seq? x) (doall (map #(replace-home % home) x))
    :else x))

(defn merge-permission-allows [existing incoming]
  (vec (distinct (concat (vec (or existing []))
                         (vec (or incoming []))))))

(defn merge-claude-settings [base hooks perms home]
  (let [hooks* (some-> hooks (replace-home home))
        perms* (some-> perms (replace-home home))
        existing-allow (get-in base [:permissions :allow])
        incoming-allow (get-in perms* [:permissions :allow])]
    (cond-> (merge (or base {}) hooks* perms*)
      perms* (assoc-in [:permissions :allow]
                       (merge-permission-allows existing-allow incoming-allow)))))

(defn merge-claude-settings-data [{:keys [target-dir hooks-json perms-json]} home]
  (let [settings-file (str (fs/path target-dir "settings.json"))
        base (or (slurp-json settings-file) {})
        hooks (some-> hooks-json slurp-json)
        perms (some-> perms-json slurp-json)]
    (merge-claude-settings base hooks perms home)))

(defn say [dry-run? live-msg dry-msg]
  (println (if dry-run? dry-msg live-msg)))

(defn install-link! [{:keys [source target label]} force? dry-run?]
  (let [kind (path-kind target)
        raw-link (read-link target)]
    (cond
      (already-linked? target source)
      (println "Already linked:" label)

      (= kind :symlink)
      (do
        (say dry-run?
             (str "Removing stale symlink: " target " -> " raw-link)
             (str "Would remove stale symlink: " target " -> " raw-link))
        (say dry-run?
             (str "Linking: " label)
             (str "Would link: " label))
        (when-not dry-run?
          (fs/delete target)
          (ensure-dir! target)
          (fs/create-sym-link target source)))

      (= kind :missing)
      (do
        (say dry-run?
             (str "Linking: " label)
             (str "Would link: " label))
        (when-not dry-run?
          (ensure-dir! target)
          (fs/create-sym-link target source)))

      force?
      (do
        (say dry-run?
             (str "Removing existing file (--force): " target)
             (str "Would remove existing file (--force): " target))
        (say dry-run?
             (str "Linking: " label)
             (str "Would link: " label))
        (when-not dry-run?
          (remove-path! target)
          (ensure-dir! target)
          (fs/create-sym-link target source)))

      :else
      (println
       "Warning:"
       target
       "exists and is not a symlink, skipping (use --force to overwrite)"))))

(defn install-copy! [{:keys [source target label]} force? dry-run?]
  (let [kind (path-kind target)
        raw-link (read-link target)]
    (cond
      (= kind :missing)
      (do
        (say dry-run?
             (str "Copying: " label)
             (str "Would copy: " label))
        (when-not dry-run?
          (ensure-dir! target)
          (fs/copy source target {:replace-existing true})))

      (= kind :symlink)
      (do
        (say dry-run?
             (str "Removing stale symlink: " target " -> " raw-link)
             (str "Would remove stale symlink: " target " -> " raw-link))
        (say dry-run?
             (str "Copying: " label)
             (str "Would copy: " label))
        (when-not dry-run?
          (fs/delete target)
          (ensure-dir! target)
          (fs/copy source target {:replace-existing true})))

      force?
      (do
        (say dry-run?
             (str "Removing existing file (--force): " target)
             (str "Would remove existing file (--force): " target))
        (say dry-run?
             (str "Copying: " label)
             (str "Would copy: " label))
        (when-not dry-run?
          (remove-path! target)
          (ensure-dir! target)
          (fs/copy source target {:replace-existing true})))

      :else
      (println "Warning:" target "exists, skipping copy (use --force to overwrite)"))))

(defn execute! [action {:keys [force? dry-run? home]}]
  (case (:op action)
    :section (do (println) (println "==" (:title action) "=="))
    :link (install-link! action force? dry-run?)
    :copy (install-copy! action force? dry-run?)
    :merge-claude-settings
    (let [settings-file (str (fs/path (:target-dir action) "settings.json"))]
      (say dry-run?
           (str "Merging Claude settings: " settings-file)
           (str "Would merge Claude settings: " settings-file))
      (when-not dry-run?
        (spit-json! settings-file (merge-claude-settings-data action home))))))

(defn validate! [p {:keys [mode]}]
  (letfn [(require-dir! [path label]
            (when-not (fs/directory? path)
              (binding [*out* *err*]
                (println "Missing directory:" label "(" path ")"))
              (System/exit 1)))]
    (case mode
      :claude (do (require-dir! (:claude-src p) "claude")
                  (require-dir! (:shared-src p) "shared"))
      :agents (do (require-dir! (:agents-src p) "agents")
                  (require-dir! (:shared-src p) "shared"))
      :pi (do (require-dir! (:pi-src p) "pi")
              (require-dir! (str (fs/path (:pi-src p) "extensions")) "pi/extensions")
              (require-dir! (str (fs/path (:pi-src p) "themes")) "pi/themes"))
      :all (do (require-dir! (:claude-src p) "claude")
               (require-dir! (:agents-src p) "agents")
               (require-dir! (:shared-src p) "shared")
               (require-dir! (:pi-src p) "pi")
               (require-dir! (str (fs/path (:pi-src p) "extensions")) "pi/extensions")
               (require-dir! (str (fs/path (:pi-src p) "themes")) "pi/themes")))))

(defn announce [p {:keys [mode force? dry-run?]}]
  (let [force-line (when force? ["Force mode: enabled"])
        dry-run-line (when dry-run? ["Dry run: enabled"])]
    (case mode
      :claude
      (doseq [line (concat ["Bootstrapping Claude dotfiles..."
                            "Sources:"
                            (str "  - " (:claude-src p))
                            (str "  - " (:shared-src p))
                            (str "Target: " (:claude-dst p))
                            ""]
                           force-line
                           dry-run-line
                           [""])]
        (println line))

      :agents
      (doseq [line (concat ["Bootstrapping agent dotfiles..."
                            "Sources:"
                            (str "  - " (:agents-src p))
                            (str "  - " (:shared-src p))
                            "Targets:"
                            (str "  - " (:agents-dst p))
                            (str "  - " (fs/path (:codex-dst p) "AGENTS.md"))
                            ""]
                           force-line
                           dry-run-line
                           [""])]
        (println line))

      :pi
      (doseq [line (concat ["Bootstrapping Pi resources..."
                            "Sources:"
                            (str "  - " (fs/path (:pi-src p) "extensions"))
                            (str "  - " (fs/path (:pi-src p) "themes"))
                            "Target:"
                            (str "  - " (:pi-dst p))
                            ""]
                           force-line
                           dry-run-line
                           [""])]
        (println line))

      :all
      (doseq [line (concat ["Bootstrapping all targets..." ""]
                           force-line
                           dry-run-line
                           [""])]
        (println line)))))

(defn -main [& argv]
  (let [opts (parse-cli argv)]
    (when (:help? opts)
      (println (usage))
      (System/exit 0))
    (let [p (paths (repo-root))
          ops (plan p opts)]
      (validate! p opts)
      (announce p opts)
      (doseq [action ops]
        (execute! action {:force? (:force? opts)
                          :dry-run? (:dry-run? opts)
                          :home (:home p)}))
      (println)
      (println "Done!"))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
