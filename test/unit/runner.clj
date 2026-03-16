#!/usr/bin/env bb

(ns unit.runner
  (:require [clojure.test :as t]))

(defn -main [& _]
  (println "• Running pure unit tests...")
  (require 'unit.bootstrap-pure-test)
  (let [{:keys [test fail error]} (t/run-tests 'unit.bootstrap-pure-test)]
    (if (zero? test)
      (do
        (println "Warning: No tests found")
        (System/exit 0))
      (System/exit (+ fail error)))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
