import os
import tempfile
from pathlib import Path
from unittest import TestCase

from deerflow.sandbox import LocalSandbox, LocalSandboxProvider


class LocalSandboxTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.sandbox = LocalSandbox(id="test-sandbox", root=self.root)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_write_and_read_text_file_inside_sandbox_root(self):
        path = self.root / "notes" / "todo.txt"

        self.sandbox.write_file(str(path), "first")
        self.sandbox.write_file(str(path), "\nsecond", append=True)

        self.assertEqual(self.sandbox.read_file(str(path)), "first\nsecond")

    def test_update_file_writes_binary_content(self):
        path = self.root / "image.bin"

        self.sandbox.update_file(str(path), b"\x00\x01\x02")

        self.assertEqual(path.read_bytes(), b"\x00\x01\x02")

    def test_rejects_paths_outside_sandbox_root(self):
        outside_path = self.root.parent / "outside.txt"

        with self.assertRaises(PermissionError):
            self.sandbox.write_file(str(outside_path), "nope")

        with self.assertRaises(PermissionError):
            self.sandbox.read_file(str(outside_path))

    def test_rejects_symlink_escape(self):
        target = self.root.parent / "secret.txt"
        target.write_text("secret", encoding="utf-8")
        link = self.root / "secret-link.txt"
        link.symlink_to(target)

        with self.assertRaises(PermissionError):
            self.sandbox.read_file(str(link))

    def test_execute_command_runs_from_root_and_returns_stdout(self):
        (self.root / "hello.txt").write_text("hello", encoding="utf-8")

        output = self.sandbox.execute_command("pwd && cat hello.txt")

        self.assertIn(str(self.root), output)
        self.assertIn("hello", output)

    def test_execute_command_includes_stderr_and_exit_code(self):
        output = self.sandbox.execute_command("printf 'bad' >&2; exit 7")

        self.assertIn("Std Error:", output)
        self.assertIn("bad", output)
        self.assertIn("Exit Code: 7", output)

    def test_list_dir_respects_max_depth(self):
        (self.root / "a" / "b").mkdir(parents=True)
        (self.root / "a" / "b" / "deep.txt").write_text("deep", encoding="utf-8")
        (self.root / "a" / "top.txt").write_text("top", encoding="utf-8")

        entries = self.sandbox.list_dir(str(self.root), max_depth=1)

        self.assertIn("a/", entries)
        self.assertNotIn(os.path.join("a", "b", "deep.txt"), entries)

    def test_glob_finds_files_and_reports_truncation(self):
        (self.root / "src").mkdir()
        (self.root / "src" / "one.py").write_text("", encoding="utf-8")
        (self.root / "src" / "two.py").write_text("", encoding="utf-8")
        (self.root / "src" / "note.md").write_text("", encoding="utf-8")

        matches, truncated = self.sandbox.glob(str(self.root), "**/*.py", max_results=1)

        self.assertEqual(len(matches), 1)
        self.assertTrue(matches[0].endswith(".py"))
        self.assertTrue(truncated)

    def test_grep_supports_literal_case_insensitive_and_glob_filter(self):
        (self.root / "src").mkdir()
        (self.root / "src" / "one.py").write_text("Alpha\nbeta\n", encoding="utf-8")
        (self.root / "src" / "note.md").write_text("alpha\n", encoding="utf-8")

        matches, truncated = self.sandbox.grep(
            str(self.root),
            "alpha",
            glob="**/*.py",
            literal=True,
        )

        self.assertFalse(truncated)
        self.assertEqual(len(matches), 1)
        self.assertTrue(matches[0].path.endswith("one.py"))
        self.assertEqual(matches[0].line_number, 1)
        self.assertEqual(matches[0].line, "Alpha")

    def test_grep_skips_binary_files(self):
        (self.root / "binary.bin").write_bytes(b"\x00alpha")

        matches, truncated = self.sandbox.grep(str(self.root), "alpha")

        self.assertEqual(matches, [])
        self.assertFalse(truncated)


class LocalSandboxProviderTests(TestCase):
    def test_provider_creates_thread_scoped_sandboxes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            provider = LocalSandboxProvider(root=temp_dir)

            first_id = provider.acquire("thread-a")
            second_id = provider.acquire("thread-a")
            sandbox = provider.get(first_id)

            self.assertEqual(first_id, second_id)
            self.assertIsNotNone(sandbox)
            self.assertTrue(Path(sandbox.root).is_dir())

            provider.release(first_id)

            self.assertIsNone(provider.get(first_id))
