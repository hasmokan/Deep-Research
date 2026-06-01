"""Context compression helpers."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from langchain_core.messages import ToolMessage


class ContextCompressionTests(TestCase):
    def test_persist_large_output_writes_full_output_and_returns_marker(self):
        from agents.context_compression import persist_large_output

        with TemporaryDirectory() as temp_dir:
            marker = persist_large_output(
                "call/with unsafe chars",
                "abcdef" * 20,
                output_dir=Path(temp_dir),
                threshold=20,
                preview_chars=12,
            )

            self.assertIn("<persisted-output>", marker)
            self.assertIn("Full output saved to:", marker)
            self.assertIn("Preview:\nabcdefabcdef", marker)
            self.assertNotIn(("abcdef" * 20)[20:], marker)

            saved_path = Path(marker.split("Full output saved to: ", 1)[1].splitlines()[0])
            self.assertEqual(saved_path.read_text(encoding="utf-8"), "abcdef" * 20)
            self.assertTrue(saved_path.name.startswith("call-with-unsafe-chars"))

    def test_micro_compact_tool_messages_keeps_recent_tool_results(self):
        from agents.context_compression import micro_compact_tool_messages

        messages = [
            ToolMessage(content="tool result 1", tool_call_id="call-1", name="web_search"),
            ToolMessage(content="tool result 2", tool_call_id="call-2", name="web_search"),
            ToolMessage(content="tool result 3", tool_call_id="call-3", name="web_search"),
            ToolMessage(content="tool result 4", tool_call_id="call-4", name="web_search"),
        ]

        compacted = micro_compact_tool_messages(messages, keep_recent=2)

        self.assertEqual(compacted[0].content, "[Earlier tool result omitted for brevity]")
        self.assertEqual(compacted[1].content, "[Earlier tool result omitted for brevity]")
        self.assertEqual(compacted[2].content, "tool result 3")
        self.assertEqual(compacted[3].content, "tool result 4")
        self.assertEqual(compacted[0].tool_call_id, "call-1")
        self.assertEqual(messages[0].content, "tool result 1")

    def test_compact_conversation_history_preserves_summary_and_recent_messages(self):
        from agents.context_compression import compact_conversation_history

        history = [
            {"role": "user", "content": "Initial goal: build s06 context compression."},
            {"role": "assistant", "content": "Very old raw output " + "x" * 200},
            {"role": "user", "content": "We touched api/agents/conversation_context.py and api/agents/react_agent.py."},
            {"role": "assistant", "content": "Decision: keep memory separate from active context compression."},
            {"role": "user", "content": "Next, implement the helper tests."},
        ]

        compacted, state = compact_conversation_history(
            history,
            max_messages=2,
            max_context_chars=140,
        )

        self.assertTrue(state.has_compacted)
        self.assertIn("Context continuity summary", state.last_summary)
        self.assertIn("Initial goal: build s06 context compression", state.last_summary)
        self.assertIn("api/agents/conversation_context.py", state.last_summary)
        self.assertIn("api/agents/react_agent.py", state.last_summary)
        self.assertEqual([message["content"] for message in compacted], [
            "Decision: keep memory separate from active context compression.",
            "Next, implement the helper tests.",
        ])
