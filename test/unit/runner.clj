#!/usr/bin/env bb

(require '[clojure.test :as t]
         'todo.core-test)

(let [{:keys [test fail error]} (t/run-tests 'todo.core-test)]
  (System/exit (if (zero? test) 1 (+ fail error))))
