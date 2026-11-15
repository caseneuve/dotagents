"""Resource-only packaging and portable helper regression tests (isolated HOME)."""
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
    def test_manifest_is_an_explicit_independent_allowlist(self):
        manifest = json.loads((ROOT / "package.json").read_text())
        pi = manifest["pi"]
        self.assertEqual([], pi["extensions"])
        self.assertEqual([], pi["themes"])
        self.assertEqual({f"shared/skills/{s}" for s in SKILLS}, set(pi["skills"]))
        self.assertEqual({f"pi/prompts/{p}.md" for p in PROMPTS}, set(pi["prompts"]))
        for skill in pi["skills"]:
            self.assertTrue((ROOT / skill / "SKILL.md").is_file())
        for key in ("dependencies", "devDependencies", "scripts"):
            self.assertNotIn(key, manifest)

    def test_helpers_work_from_non_git_copy_and_unrelated_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            home, cwd = tmp / "home", tmp / "caller"
            home.mkdir()
            cwd.mkdir()
            env = {"HOME": str(home), "PATH": os.environ["PATH"],
                   "ORG_JOURNAL_AGENT": "pi"}
            for skill in ("add-todo", "org-journal"):
                shutil.copytree(ROOT / "shared/skills" / skill, tmp / skill)
            # A relative symlink chain exercises the same resolution as bootstrap.
            (tmp / "todo-link").symlink_to("add-todo/ag-todo")
            (tmp / "ag-todo").symlink_to("todo-link")

            def run(*args, extra_env=None):
                result = subprocess.run(args, cwd=cwd, env={**env, **(extra_env or {})},
                                        text=True, capture_output=True)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                return result.stdout

            todo = str(tmp / "ag-todo")
            self.assertIn("id=0001", run(todo, "new", "--type", "chore", "--slug", "portable"))
            run(todo, "status", "0001", "done")
            self.assertIn("0001", run(todo, "list", "--status", "done"))
            self.assertEqual("0002", run(todo, "next-id").strip())
            self.assertIn("status: done", (cwd / "todos/0001-portable.md").read_text())
            # Explicit project works outside Git; no bootstrap or Pi directories.
            helper = str(tmp / "org-journal/new-entry.bb")
            metadata = run("bb", helper, "--mkdir", "portable")
            self.assertIn(':agent "pi"', metadata)
            journal = home / "org/agent-journal"
            day = next(p for p in journal.glob("*/*/*") if p.is_dir())
            (day / "0000-portable.org").write_text(
                "#+TITLE: Portable proof\n#+DATE: 2026-11-15 12:00\n"
                ":LLM_PROJECT: portable\n:LLM_AGENT: pi\n:LLM_CATEGORY: chore\n")
            self.assertIn("0000-portable.org", run("bb", helper, "portable"))
            run("emacs", "--batch", "-Q", "-l", str(tmp / "org-journal/update-index.el"))
            self.assertIn("Portable proof", (journal / "index.org").read_text())
            # Existing path-based runtime defaults remain intact.
            for runtime, agent in ((".claude", "claude"), (".agents", "codex")):
                dest = home / runtime / "skills/org-journal"
                dest.parent.mkdir(parents=True)
                dest.symlink_to(tmp / "org-journal", target_is_directory=True)
                result = subprocess.run(["bb", str(dest / "new-entry.bb"), "portable"],
                                        cwd=cwd, env={"HOME": str(home), "PATH": env["PATH"]},
                                        check=True, text=True, capture_output=True)
                self.assertIn(f':agent "{agent}"', result.stdout)
            self.assertFalse((home / ".pi").exists())


if __name__ == "__main__":
    unittest.main()
