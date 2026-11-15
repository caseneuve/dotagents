(ns demo.dsl)

(defmacro defn-like [& forms]
  `(defn ~@forms))
