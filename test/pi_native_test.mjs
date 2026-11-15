// Actual installed Pi resource loader; no session, model, credentials or API calls.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piDir = process.env.PI_PACKAGE_DIR;
assert.ok(piDir, "Set PI_PACKAGE_DIR to the installed Pi package directory");
const scratch = await mkdtemp(join(tmpdir(), "dotagents-pi-native-"));
const home = join(scratch, "home");
const cwd = join(scratch, "unrelated", "project");
const packageDir = join(scratch, "package");
await Promise.all([mkdir(home), mkdir(cwd, { recursive: true }), mkdir(packageDir)]);
// Set before importing Pi: both its HOME and ancestor-based project discovery are private.
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
process.chdir(cwd);
try {
  for (const name of ["package.json", "skills", "prompts"]) {
    await cp(join(root, name), join(packageDir, name), { recursive: true });
  }
  const { DefaultResourceLoader } = await import(pathToFileURL(join(piDir, "dist/core/resource-loader.js")));
  const { SettingsManager } = await import(pathToFileURL(join(piDir, "dist/core/settings-manager.js")));
  const { expandPromptTemplate } = await import(pathToFileURL(join(piDir, "dist/core/prompt-templates.js")));
  const version = JSON.parse(await readFile(join(piDir, "package.json"), "utf8")).version;

  async function load(source) {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: process.env.PI_CODING_AGENT_DIR,
      settingsManager: SettingsManager.inMemory({ packages: [source] }),
    });
    await loader.reload();
    const skills = loader.getSkills();
    const prompts = loader.getPrompts();
    const themes = loader.getThemes();
    const extensions = loader.getExtensions();
    for (const result of [skills, prompts, themes]) assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(extensions.errors, []);
    assert.deepEqual(extensions.warnings ?? [], []);
    assert.equal(extensions.extensions.length, 0);
    assert.equal(themes.themes.length, 0);
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
    for (const resource of [...skills.skills, ...prompts.prompts]) {
      assert.ok(resource.filePath.startsWith(`${packageDir}/`), resource.filePath);
    }
    return { skills: skills.skills, prompts: prompts.prompts };
  }

  const all = await load(packageDir);
  assert.deepEqual(all.skills.map((s) => s.name).sort(),
    ["add-todo", "callgraph", "dataflow", "org-journal", "to-skill"]);
  assert.deepEqual(all.prompts.map((p) => p.name).sort(),
    ["ans", "be-concise", "handoff", "speak-human", "style"]);
  for (const prompt of all.prompts) {
    const expanded = expandPromptTemplate(`/${prompt.name} native-proof`, all.prompts);
    assert.ok(expanded.length > 0);
    assert.notEqual(expanded, `/${prompt.name} native-proof`);
  }
  const filtered = await load({ source: packageDir,
    skills: ["skills/add-todo"], prompts: ["prompts/ans.md"] });
  assert.deepEqual(filtered.skills.map((s) => s.name), ["add-todo"]);
  assert.deepEqual(filtered.prompts.map((p) => p.name), ["ans"]);
  const none = await load({ source: packageDir, skills: [], prompts: [] });
  assert.deepEqual(none, { skills: [], prompts: [] });
  console.log(JSON.stringify({ result: "PASS", pi: version,
    scope: "native non-Git local package; isolated HOME/project; no session/auth/provider calls",
    skills: all.skills.map((s) => ({ name: s.name, path: s.filePath })),
    prompts: all.prompts.map((p) => ({ name: p.name, path: p.filePath })),
    filtered: "add-todo + ans", disabled: "0 + 0", extensions: 0, themes: 0 }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
