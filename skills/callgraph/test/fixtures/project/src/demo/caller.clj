(ns demo.caller
  (:require [demo.targets :as targets]))

(defn direct-caller [value]
  (targets/direct-target value))

(targets/multi-target {:kind :top-level})

(targets/direct-target {:kind :top-level})
