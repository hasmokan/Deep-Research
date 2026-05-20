import tempfile
from pathlib import Path
from unittest import TestCase

from deerflow.sandbox import LocalSandboxProvider
from deerflow.sandbox.tools import SandboxToolRunner, sandbox_tool_specs


class SandboxToolRunnerTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.provider = LocalSandboxProvider(root=self.temp_dir.name)
        self.sandbox_id = self.provider.acquire("thread-tools")
        self.sandbox = self.provider.get(self.sandbox_id)
        self.runner = SandboxToolRunner(self.provider)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_tool_specs_expose_supported_tool_names(self):
        names = {spec["name"] for spec in sandbox_tool_specs()}

        self.assertEqual(
            names,
            {"bash", "read_file", "write_file", "list_dir", "glob", "grep"},
        )

    def test_write_and_read_file_tools(self):
        path = str(Path(self.sandbox.root) / "notes.txt")

        write_result = self.runner.run(
            self.sandbox_id,
            "write_file",
            {"path": path, "content": "hello"},
        )
        read_result = self.runner.run(
            self.sandbox_id,
            "read_file",
            {"path": path},
        )

        self.assertEqual(write_result, {"ok": True, "content": ""})
        self.assertEqual(read_result, {"ok": True, "content": "hello"})

    def test_bash_tool_returns_command_output(self):
        result = self.runner.run(
            self.sandbox_id,
            "bash",
            {"command": "printf sandbox"},
        )

        self.assertEqual(result, {"ok": True, "content": "sandbox"})

    def test_list_dir_glob_and_grep_tools_return_structured_content(self):
        src = Path(self.sandbox.root) / "src"
        src.mkdir()
        (src / "app.py").write_text("Alpha\n", encoding="utf-8")

        list_result = self.runner.run(self.sandbox_id, "list_dir", {"path": str(self.sandbox.root)})
        glob_result = self.runner.run(
            self.sandbox_id,
            "glob",
            {"path": str(self.sandbox.root), "pattern": "**/*.py"},
        )
        grep_result = self.runner.run(
            self.sandbox_id,
            "grep",
            {"path": str(self.sandbox.root), "pattern": "alpha", "literal": True},
        )

        self.assertTrue(list_result["ok"])
        self.assertIn("src/", list_result["entries"])
        self.assertTrue(glob_result["ok"])
        self.assertEqual(glob_result["truncated"], False)
        self.assertEqual(len(glob_result["matches"]), 1)
        self.assertTrue(grep_result["ok"])
        self.assertEqual(grep_result["matches"][0]["line"], "Alpha")
        self.assertEqual(grep_result["matches"][0]["line_number"], 1)

    def test_unknown_tool_returns_error_result(self):
        result = self.runner.run(self.sandbox_id, "unknown", {})

        self.assertFalse(result["ok"])
        self.assertIn("Unknown sandbox tool", result["error"])

    def test_missing_sandbox_returns_error_result(self):
        result = self.runner.run("missing", "bash", {"command": "pwd"})

        self.assertFalse(result["ok"])
        self.assertIn("Sandbox not found", result["error"])

    def test_tool_errors_are_returned_without_throwing(self):
        result = self.runner.run(
            self.sandbox_id,
            "read_file",
            {"path": str(Path(self.temp_dir.name).parent / "outside.txt")},
        )

        self.assertFalse(result["ok"])
        self.assertIn("PermissionError", result["error"])
