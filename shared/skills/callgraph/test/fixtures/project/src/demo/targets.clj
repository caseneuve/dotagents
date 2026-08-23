(ns demo.targets
  (:require [clojure.string :as str]
            [demo.lib :as lib]
            [demo.lib :refer [refer-target]]))

(defn direct-target [value]
  value)

(defmacro macro-target [form]
  form)

(defmulti multi-target
  (fn [value]
    (:kind value)))

(defprotocol Dispatchable
  (protocol-target [value]))

(defn outgoing-target [value]
  (lib/qualified-target value)
  (refer-target value)
  (-> value lib/qualified-target str/trim)
  (apply direct-target [value])
  (map direct-target [value])
  direct-target
  (direct-target value)
  (protocol-target value)
  (multi-target value)
  (macro-target (direct-target value)))

(defn shadowed-target [direct-target]
  (direct-target 1))

(defmethod multi-target :a [value]
  (direct-target value))

(extend-type String Dispatchable
  (protocol-target [value]
    (direct-target value)))
