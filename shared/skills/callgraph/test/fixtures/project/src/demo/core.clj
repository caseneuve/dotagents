(ns demo.core
  (:require [demo.dsl :refer [defn-like]]
            [demo.protocols :as protocols]))

(defn-like run [value]
  (protocols/greet value))

(defn caller [value]
  (run value))
