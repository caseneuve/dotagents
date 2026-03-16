#!/usr/bin/env bb

(ns e2e.assertions
  (:require
   [clojure.string :as str]
   [babashka.fs :as fs]
   [cheshire.core :as json]
   [end2edn.assertions :as assertions]))

(defn read-json [path]
  (when (fs/exists? path)
    (json/parse-string (slurp (str path)) true)))

(defmethod assertions/check-expectation :symlink-exists
  [[_ path] _context]
  (fs/sym-link? path))

(defmethod assertions/check-expectation :symlink-target
  [[_ path expected-target] _context]
  (and (fs/sym-link? path)
       (= expected-target (str (fs/read-link path)))))

(defmethod assertions/check-expectation :regular-file
  [[_ path] _context]
  (and (fs/exists? path)
       (fs/regular-file? path)
       (not (fs/sym-link? path))))

(defmethod assertions/check-expectation :json-path-equals
  [[_ path ks expected] _context]
  (= expected (get-in (read-json path) ks)))

(defmethod assertions/check-expectation :json-path-contains
  [[_ path ks expected] _context]
  (let [value (get-in (read-json path) ks)]
    (cond
      (string? value) (str/includes? value expected)
      (sequential? value) (boolean (some #{expected} value))
      :else false)))
