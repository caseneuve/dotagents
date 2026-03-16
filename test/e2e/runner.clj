#!/usr/bin/env bb

(ns e2e.runner
  (:require [e2e.assertions]
            [end2edn.core :as e2e]))

(defn -main [& args]
  (println "• Running E2E tests via end2edn...")
  (System/exit (apply e2e/run-file "test/e2e/cases.edn" args)))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
