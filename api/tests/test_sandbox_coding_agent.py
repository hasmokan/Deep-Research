import asyncio
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch


class _FakeToolCallingModel:
    def __init__(self):
        self.calls = 0

    def bind_tools(self, tools):
        self.bound_tools = tools
        return self

    async def ainvoke(self, messages, config=None):
        self.calls += 1
        if self.calls == 1:
            return SimpleNamespace(
                content="",
                tool_calls=[
                    {
                        "id": "call-write",
                        "name": "write_file",
                        "args": {
                            "path": "solution.py",
                            "content": "print('ok')\n",
                        },
                    },
                    {
                        "id": "call-bash",
                        "name": "bash",
                        "args": {
                            "command": "python solution.py",
                        },
                    },
                ],
            )
        return SimpleNamespace(content="The sandbox printed ok.", tool_calls=[])


class SandboxCodingAgentTests(IsolatedAsyncioTestCase):
    async def test_stream_answer_coding_node_executes_sandbox_tool_calls(self):
        from agents.nodes import conversation_router

        fake_model = _FakeToolCallingModel()

        with patch.object(conversation_router, "ChatOpenAI", return_value=fake_model):
            events = [
                event
                async for event in conversation_router.stream_answer_coding_node(
                    {"query": "create and run a python file", "run_id": "run-sandbox-test"}
                )
            ]

        trace_events = [event for event in events if event["type"] == "trace"]
        final_events = [event for event in events if event["type"] == "final"]
        delta_events = [event for event in events if event["type"] == "answer_delta"]

        self.assertEqual([event["kind"] for event in trace_events], [
            "tool_call",
            "tool_result",
            "tool_call",
            "tool_result",
        ])
        self.assertEqual(trace_events[0]["tool"], "write_file")
        self.assertEqual(trace_events[2]["tool"], "bash")
        self.assertTrue(trace_events[3]["result"]["ok"])
        self.assertIn("ok", trace_events[3]["result"]["content"])
        self.assertEqual(delta_events[-1]["delta"], "The sandbox printed ok.")
        self.assertEqual(final_events[0]["state"]["answer"], "The sandbox printed ok.")

    async def test_answer_coding_node_collects_tool_agent_final_answer(self):
        from agents.nodes import conversation_router

        fake_model = _FakeToolCallingModel()

        with patch.object(conversation_router, "ChatOpenAI", return_value=fake_model):
            result = await conversation_router.answer_coding_node({
                "query": "create and run a python file",
                "run_id": "run-sandbox-test-sync",
            })

        self.assertEqual(result["result_type"], "answer")
        self.assertEqual(result["answer"], "The sandbox printed ok.")
