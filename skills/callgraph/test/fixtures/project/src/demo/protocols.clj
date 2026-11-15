(ns demo.protocols)

(defprotocol Greeter
  (greet [value]))

(defrecord User [name]
  Greeter
  (greet [_]
    name))
