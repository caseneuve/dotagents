"""Pi-only layout and real helper regressions; run in the isolated test image."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = {"callgraph", "dataflow", "add-todo", "org-journal", "to-skill"}
PROMPTS = {"ans", "be-concise", "handoff", "speak-human", "style"}


class NativeResourcesTest(unittest.TestCase):
    def test_manifest_is_an_explicit_root_allowlist(self):
        manifest = json.loads((ROOT / "package.json").read_text())
        pi = manifest["pi"]
        self.assertEqual([], pi["extensions"])
        self.assertEqual([], pi["themes"])
        self.assertEqual({f"skills/{s}" for s in SKILLS}, set(pi["skills"]))
        self.assertEqual({f"prompts/{p}.md" for p in PROMPTS}, set(pi["prompts"]))
        self.assertEqual(SKILLS, {p.name for p in (ROOT / "skills").iterdir()})
        self.assertEqual(PROMPTS, {p.stem for p in (ROOT / "prompts").glob("*.md")})
        for skill in pi["skills"]:
            self.assertTrue((ROOT / skill / "SKILL.md").is_file())
        for key in ("dependencies", "devDependencies", "scripts", "bin"):
            self.assertNotIn(key, manifest)

    def test_no_active_bootstrap_or_parallel_runtime(self):
        for path in ("claude", "agents", "shared", "scripts/bootstrap.clj",
                     "test/unit/bootstrap_pure_test.clj", "settings-hooks.json",
                     "settings-permissions.json", "Justfile"):
            self.assertFalse((ROOT / path).exists(), path)
        skill = (ROOT / "skills/add-todo/SKILL.md").read_text()
        self.assertNotRegex(skill, r"(?m)^ag-todo\\s")
        self.assertIn('TODO="<resolved-add-todo-directory>/ag-todo"', skill)
        tasks = (ROOT / "bb.edn").read_text()
        for obsolete in ("bootstrap", "relay:", "mux-bb", "end2edn", "shared/"):
            self.assertNotIn(obsolete, tasks)
        for path in (ROOT / "skills").rglob("*"):
            if path.is_file() and path.suffix in {".md", ".el", ".bb", ".clj", ".edn"}:
                self.assertNotIn("~/.agents/", path.read_text(), str(path))
                self.assertNotIn("shared/skills/", path.read_text(), str(path))

    def test_archive_bytes_modes_and_recovery_index(self):
        index = json.loads((ROOT / "archive/index.json").read_text())
        self.assertEqual("7a592f9c9290b6f670eda23662da2f52f60187bc", index["source_ref"])
        self.assertTrue(index["files"])
        for name in ("AGENTS.md", "CLAUDE.md", "AGENTS.override.md"):
            self.assertEqual([], list((ROOT / "archive").rglob(name)))
        self.assertEqual(len(index["files"]), len({r["original"] for r in index["files"]}))
        for row in index["files"]:
            path = ROOT / row["archive"]
            data = path.read_bytes()
            blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
            self.assertEqual(row["blob"], blob, str(path))
            mode = "100755" if path.stat().st_mode & 0o111 else "100644"
            self.assertEqual(row["mode"], mode, str(path))
            self.assertIn("replacement", row)
            self.assertIn("disposition", row)

    def test_authorized_retirement_preserves_all_50_and_removes_entire_pi_root(self):
        index = json.loads((ROOT / "archive/pi/retirement-index.json").read_text())
        self.assertEqual("2dc662c7f1f8ae250266490822b0fac5bf800def", index["landable_parent"])
        self.assertEqual(50, len(index["files"]))
        self.assertEqual(50, len({row["original"] for row in index["files"]}))
        self.assertEqual(50, len({row["archive"] for row in index["files"]}))
        self.assertEqual(7, sum(row["original"].startswith("test/pi/")
                                for row in index["files"]))
        self.assertFalse(index["gate"]["completed"])
        self.assertTrue(index["gate"]["waived"])
        self.assertEqual("user", index["gate"]["authorization"]["by"])
        self.assertEqual("reversible retirement of entire dotagents/pi and historical test/pi",
                         index["gate"]["authorization"]["scope"])
        readme = next(row for row in index["files"] if row["original"] == "pi/README.md")
        self.assertEqual((index["landable_parent"],
                          "5076f917e222a6e453c2053ac998f80452737a9c", "100644",
                          "archive/pi/README.master-2dc662c.historical-pointer.md"),
                         (readme["source_ref"], readme["blob"], readme["mode"], readme["archive"]))
        self.assertEqual((7, 5, 2), (index["gate"]["calendar_days"],
                                     index["gate"]["normal_sessions"],
                                     index["gate"]["projects_per_active_os"]))
        for path in ("pi", "test/pi"):
            self.assertFalse(os.path.lexists(ROOT / path), path)
        for row in index["files"]:
            self.assertFalse(os.path.lexists(ROOT / row["original"]), row["original"])
            self.assertEqual(40, len(row.get("source_ref", index["source_ref"])))
            path = ROOT / row["archive"]
            data = path.read_bytes()
            blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
            self.assertEqual(row["blob"], blob, str(path))
            mode = "100755" if path.stat().st_mode & 0o111 else "100644"
            self.assertEqual(row["mode"], mode, str(path))
            self.assertIn("owner", row)
            self.assertIn("replacement", row)
            for replacement in row["replacement"] or []:
                self.assertEqual(40, len(replacement["ref"]))
                self.assertIn("path", replacement)
                self.assertIn("package", replacement)

    def test_helpers_work_from_non_git_copy_and_unrelated_cwd(self):
        with tempfile.TemporaryDirectory(prefix="dotagents-native-") as tmp:
            tmp = Path(tmp)
            home, cwd, package = tmp / "home", tmp / "caller", tmp / "package"
            home.mkdir()
            cwd.mkdir()
            shutil.copytree(ROOT / "skills", package / "skills")
            self.assertFalse((package / ".git").exists())
            env = {"HOME": str(home), "PATH": "/usr/local/bin:/usr/bin:/bin",
                   "PYTHONDONTWRITEBYTECODE": "1"}

            def run(*args):
                result = subprocess.run(args, cwd=cwd, env=env, text=True,
                                        capture_output=True, timeout=60)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                return result.stdout

            todo = str(package / "skills/add-todo/ag-todo")
            self.assertIn("id=0001", run(todo, "new", "--type", "chore", "--slug", "portable",
                                           "--labels", "MVP,BETA"))
            self.assertIn("id=0001.1", run(todo, "new", "--type", "feature", "--slug", "child",
                                             "--parent", "0001"))
            run(todo, "status", "0001", "done")
            self.assertIn("0001", run(todo, "list", "--status", "done", "--label", "MVP"))
            self.assertEqual("0002", run(todo, "next-id").strip())
            self.assertIn("status: done", (cwd / "todos/0001-portable.md").read_text())
            invalid = subprocess.run([todo, "status", "0001", "finished"], cwd=cwd,
                                     env=env, text=True, capture_output=True)
            self.assertEqual(1, invalid.returncode)
            self.assertIn("status: done", (cwd / "todos/0001-portable.md").read_text())
            # Explicit target and relative symlink chain, never a PATH installation.
            (tmp / "todo-link").symlink_to("package/skills/add-todo/ag-todo")
            (tmp / "todo-link-2").symlink_to("todo-link")
            self.assertEqual("0002", run(str(tmp / "todo-link-2"), "next-id",
                                         "--dir", str(cwd / "todos")).strip())

            journal_skill = package / "skills/org-journal"
            metadata = run("bb", str(journal_skill / "new-entry.bb"), "--mkdir", "portable")
            self.assertIn(':agent "pi"', metadata)
            self.assertIn(':branch "none"', metadata)
            journal = home / "org/agent-journal"
            day = next(p for p in journal.glob("*/*/*") if p.is_dir())
            (day / "0000-portable.org").write_text(
                "#+TITLE: Portable proof\n#+DATE: 2026-11-15 12:00\n"
                ":LLM_PROJECT: portable\n:LLM_AGENT: pi\n:LLM_CATEGORY: chore\n")
            self.assertIn("0000-portable.org", run("bb", str(journal_skill / "new-entry.bb"), "portable"))
            run("emacs", "--batch", "-Q", "-l", str(journal_skill / "update-index.el"))
            self.assertIn("Portable proof", (journal / "index.org").read_text())

            source = cwd / "pipeline.py"
            source.write_text("def double(x: int) -> int:\n    return x * 2\n\n"
                              "def caller(x: int) -> int:\n    return double(x)\n")
            callers = run("python3", str(package / "skills/callgraph/scripts/py_callers.py"),
                          "--root", str(cwd), "double")
            self.assertIn("in caller()", callers)
            flow = run("python3", str(package / "skills/dataflow/scripts/py_typeflow.py"),
                       "--root", str(cwd), "double")
            self.assertIn("purity: pure", flow)
            self.assertIn("int", flow)
            self.assertFalse((home / ".pi").exists())
            self.assertFalse((home / ".agents").exists())
            self.assertFalse((home / ".claude").exists())


if __name__ == "__main__":
    unittest.main()
