;; update-index.el — Rebuild the shared agent journal index from journal entries
;;
;; Batch usage (from shell / agent):
;;   emacs --batch -l ~/.agents/skills/org-journal/update-index.el -f shared-journal-update-index
;;
;; Interactive usage (from Emacs):
;;   (load "~/.agents/skills/org-journal/update-index.el")
;;   M-x shared-journal-update-index

(defvar shared-journal-base-dir
  (expand-file-name "~/org/agent-journal/")
  "Base directory for journal org files.")

(defvar shared-journal-index-file (expand-file-name "index.org" shared-journal-base-dir)
  "Path to the generated index file.")

(defun shared-journal--parse-entry (file)
  "Parse metadata from a journal org FILE.  Return alist or nil on failure."
  (with-temp-buffer
    (insert-file-contents file)
    (let ((title "")
          (date "")
          (project "")
          (agent "")
          (category ""))
      (goto-char (point-min))
      (when (re-search-forward "^#\\+TITLE:\\s-*\\(.+\\)" nil t)
        (setq title (string-trim (match-string 1))))
      (goto-char (point-min))
      (when (re-search-forward "^#\\+DATE:\\s-*\\(.+\\)" nil t)
        (setq date (string-trim (match-string 1))))
      (goto-char (point-min))
      (when (re-search-forward "^:LLM_PROJECT:\\s-*\\(.+\\)" nil t)
        (setq project (string-trim (match-string 1))))
      (goto-char (point-min))
      (when (re-search-forward "^:LLM_AGENT:\\s-*\\(.+\\)" nil t)
        (setq agent (string-trim (match-string 1))))
      (goto-char (point-min))
      (when (re-search-forward "^:LLM_CATEGORY:\\s-*\\(.+\\)" nil t)
        (setq category (string-trim (match-string 1))))
      (when (and (not (string-empty-p title))
                 (not (string-empty-p date)))
        (list :file file
              :title title
              :date date
              :project project
              :agent agent
              :category category)))))

(defun shared-journal--collect-entries ()
  "Collect and sort all journal entries, newest first."
  (let* ((files (directory-files-recursively shared-journal-base-dir "\\.org\\'"))
         (files (seq-remove (lambda (f) (string= (expand-file-name f) shared-journal-index-file)) files))
         (entries (seq-filter #'identity (mapcar #'shared-journal--parse-entry files))))
    (sort entries (lambda (a b)
                    (string> (plist-get a :date) (plist-get b :date))))))

(defun shared-journal--relative-path (file)
  "Return FILE path relative to `shared-journal-base-dir'."
  (file-relative-name file shared-journal-base-dir))

(defun shared-journal--entry-to-row (entry)
  "Convert ENTRY to an unaligned org table row string."
  (let* ((date-str (plist-get entry :date))
         (date (if (>= (length date-str) 10) (substring date-str 0 10) date-str))
         (time (if (>= (length date-str) 16) (substring date-str 11 16) ""))
         (project (plist-get entry :project))
         (agent (plist-get entry :agent))
         (category (plist-get entry :category))
         (title (plist-get entry :title))
         (rel-path (shared-journal--relative-path (plist-get entry :file))))
    (format "|%s|%s|%s|%s|%s|[[file:%s][%s]]|"
            date time project agent category rel-path title)))

(defun shared-journal--format-table (entries)
  "Format ENTRIES as an org table string.  Alignment is left to `org-table-align'."
  (concat "|Date|Time|Project|Agent|Category|Title|\n"
          "|-\n"
          (mapconcat #'shared-journal--entry-to-row entries "\n")
          "\n"))

(defun shared-journal--group-by-project (entries)
  "Group ENTRIES by :project.  Return alist ((project . entries) ...)."
  (let ((groups nil))
    (dolist (entry entries)
      (let* ((project (plist-get entry :project))
             (existing (assoc project groups)))
        (if existing
            (setcdr existing (append (cdr existing) (list entry)))
          (push (cons project (list entry)) groups))))
    (sort groups (lambda (a b) (string< (car a) (car b))))))

(defun shared-journal-update-index ()
  "Rebuild the current journal index.org file."
  (interactive)
  (let* ((entries (shared-journal--collect-entries))
         (by-project (shared-journal--group-by-project entries))
         (buf (generate-new-buffer "*shared-journal-index*")))
    (with-current-buffer buf
      (insert "#+TITLE: Agent Journal Index\n")
      (insert "#+STARTUP: showall\n")
      (insert (format "#+DATE: %s\n" (format-time-string "%Y-%m-%d %H:%M")))
      (insert "\n")
      (insert (format "/%d entries across %d projects./\n\n"
                      (length entries) (length by-project)))
      ;; All entries
      (insert "* All Entries\n\n")
      (if entries
          (insert (shared-journal--format-table entries))
        (insert "No entries found.\n"))
      (insert "\n")
      ;; Per project
      (insert "* By Project\n\n")
      (dolist (group by-project)
        (let ((project (car group))
              (project-entries (cdr group)))
          (insert (format "** %s (%d)\n\n" project (length project-entries)))
          (insert (shared-journal--format-table project-entries))
          (insert "\n")))
      ;; Align tables via org-mode, then save
      (org-mode)
      (goto-char (point-min))
      (while (org-at-table-p)
        (org-table-align)
        (goto-char (org-table-end)))
      (while (re-search-forward "^|" nil t)
        (org-table-align)
        (goto-char (org-table-end)))
      (write-region (point-min) (point-max) shared-journal-index-file)
      (kill-buffer buf))
    (message "Updated %s (%d entries, %d projects)"
             shared-journal-index-file (length entries) (length by-project))))

(provide 'shared-journal-index)

;; Auto-run when invoked in batch mode
(when noninteractive
  (shared-journal-update-index))
