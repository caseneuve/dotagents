(ns demo.script)

(defn bb-target [value]
  value)

(defn bb-caller [value]
  (bb-target value))
